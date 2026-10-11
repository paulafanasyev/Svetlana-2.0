//! Ключи облачных ИИ в настольной версии Светланы.
//!
//! Ключ хранится в Диспетчере учётных данных Windows (keyring) и никогда не возвращается в
//! JavaScript: у фронтенда есть только «сохранить», «есть ли ключ» и «сделать запрос».
//! Запрос идёт только на фиксированный официальный адрес выбранного сервиса, без редиректов,
//! с ограничением размера и времени. Поэтому даже чужой скрипт на странице не может ни прочитать
//! ключ, ни отправить его на свой сервер.
//!
//! Защита от злоупотребления ключом: только известные провайдеры, строгая схема тела
//! запроса (никаких лишних полей вроде tools/stream/n), лимит частоты запросов и
//! изменений ключей — чтобы внедрённый скрипт не мог бесконтрольно тратить квоту.

use serde_json::Value;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const SERVICE: &str = "com.svetlana.desktop";
const MAX_SECRET: usize = 4096;
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;
const MAX_MESSAGES: usize = 200;
const PROVIDERS: [&str; 7] = ["openai", "groq", "openrouter", "deepseek", "mistral", "anthropic", "google"];
const CHAT_PER_MINUTE: usize = 30;
const SECRET_WRITES_PER_MINUTE: usize = 10;

static CHAT_CALLS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static SECRET_WRITES: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());

/// Скользящее окно: не больше `max` событий за минуту.
fn rate_ok(m: &Mutex<VecDeque<Instant>>, max: usize) -> bool {
    let mut q = m.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    while let Some(t) = q.front() {
        if now.duration_since(*t) > Duration::from_secs(60) {
            q.pop_front();
        } else {
            break;
        }
    }
    if q.len() >= max {
        return false;
    }
    q.push_back(now);
    true
}

fn provider_of_secret(name: &str) -> Option<&'static str> {
    let p = name.strip_prefix("ai.")?;
    PROVIDERS.iter().copied().find(|x| *x == p)
}

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if provider_of_secret(name).is_none() {
        return Err("Недопустимое имя ключа".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

/// Сохранить ключ (пустое значение удаляет). Только ai.<известный провайдер>, не чаще 10 раз в минуту.
#[tauri::command]
pub fn secret_set(name: String, value: Option<String>) -> Result<(), String> {
    let e = entry(&name)?;
    if !rate_ok(&SECRET_WRITES, SECRET_WRITES_PER_MINUTE) {
        return Err("Слишком частое изменение ключей, подождите минуту".into());
    }
    match value.filter(|v| !v.is_empty()) {
        Some(v) => {
            if v.len() > MAX_SECRET || v.chars().any(|c| c.is_control()) {
                return Err("Некорректный ключ".into());
            }
            e.set_password(&v).map_err(|err| err.to_string())
        }
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        },
    }
}

/// Есть ли ключ. Сам ключ наружу не выдаётся.
#[tauri::command]
pub fn secret_has(name: String) -> Result<bool, String> {
    let e = entry(&name)?;
    match e.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 100 && m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

/// Тело запроса должно состоять только из ожидаемых полей (чат без инструментов и потоков).
fn validate_body(provider: &str, body: &Value) -> Result<(), String> {
    let obj = body.as_object().ok_or("Тело запроса должно быть объектом")?;
    let (allowed, list_key): (&[&str], &str) = match provider {
        "anthropic" => (&["model", "max_tokens", "system", "messages", "temperature"], "messages"),
        "google" => (&["contents", "systemInstruction", "generationConfig"], "contents"),
        _ => (&["model", "messages", "temperature", "max_tokens"], "messages"),
    };
    if let Some(extra) = obj.keys().find(|k| !allowed.contains(&k.as_str())) {
        return Err(format!("Поле «{extra}» не разрешено"));
    }
    match obj.get(list_key).and_then(|v| v.as_array()) {
        Some(list) if !list.is_empty() && list.len() <= MAX_MESSAGES => Ok(()),
        _ => Err("Некорректный список сообщений".into()),
    }
}

/// Запрос к облачному ИИ: адрес фиксирован по провайдеру, ключ подставляется здесь.
#[tauri::command]
pub async fn ai_cloud_chat(provider: String, model: String, body: Value) -> Result<String, String> {
    validate_body(&provider, &body)?;
    if !rate_ok(&CHAT_CALLS, CHAT_PER_MINUTE) {
        return Err("Слишком много запросов к облачному ИИ, подождите минуту".into());
    }
    let key = match entry(&format!("ai.{provider}"))?.get_password() {
        Ok(k) => k,
        Err(keyring::Error::NoEntry) => return Err("API-ключ не задан".into()),
        Err(err) => return Err(err.to_string()),
    };
    let body_text = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    if body_text.len() > MAX_BODY {
        return Err("Запрос слишком большой".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let request = match provider.as_str() {
        "openai" => client.post("https://api.openai.com/v1/chat/completions").bearer_auth(&key),
        "groq" => client.post("https://api.groq.com/openai/v1/chat/completions").bearer_auth(&key),
        "openrouter" => client.post("https://openrouter.ai/api/v1/chat/completions").bearer_auth(&key),
        "deepseek" => client.post("https://api.deepseek.com/v1/chat/completions").bearer_auth(&key),
        "mistral" => client.post("https://api.mistral.ai/v1/chat/completions").bearer_auth(&key),
        "anthropic" => client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key.as_str())
            .header("anthropic-version", "2023-06-01"),
        "google" => {
            if !valid_model(&model) {
                return Err("Недопустимое имя модели".into());
            }
            client
                .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
                .header("x-goog-api-key", key.as_str())
        }
        _ => return Err("Этот облачный сервис не поддерживается".into()),
    };
    let response = request
        .header("Content-Type", "application/json")
        .body(body_text)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|e| e.without_url().to_string())?;
    if bytes.len() > MAX_RESPONSE {
        return Err("Ответ слишком большой".into());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !status.is_success() {
        let short: String = text.chars().take(500).collect();
        return Err(format!("HTTP {}: {}", status.as_u16(), short));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_known_provider_secrets() {
        assert_eq!(provider_of_secret("ai.openai"), Some("openai"));
        assert_eq!(provider_of_secret("ai.evil"), None);
        assert_eq!(provider_of_secret("stt.apikey"), None);
    }

    #[test]
    fn body_schema_is_strict() {
        assert!(validate_body("openai", &json!({"model": "m", "messages": [{"role": "user", "content": "hi"}]})).is_ok());
        assert!(validate_body("openai", &json!({"model": "m", "messages": [{}], "tools": []})).is_err());
        assert!(validate_body("openai", &json!({"model": "m", "messages": []})).is_err());
        assert!(validate_body("google", &json!({"contents": [{}], "generationConfig": {}})).is_ok());
    }

    #[test]
    fn rate_limit_blocks_bursts() {
        let m: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
        for _ in 0..3 { assert!(rate_ok(&m, 3)); }
        assert!(!rate_ok(&m, 3));
    }
}
