//! Ключи облачных ИИ в настольной версии Светланы.
//!
//! Ключ хранится в Диспетчере учётных данных Windows (keyring) и никогда не возвращается в
//! JavaScript: у фронтенда есть только «сохранить», «есть ли ключ» и «сделать запрос».
//! Запрос идёт только на фиксированный официальный адрес выбранного сервиса, без редиректов,
//! с ограничением размера и времени.
//!
//! Защита от чужого скрипта на странице:
//! - любое изменение или удаление ключа подтверждается в НАТИВНОМ окне Windows;
//! - запросы в облако идут только по разрешению из такого же окна. Разрешение привязано к
//!   провайдеру, модели И разговору (первому сообщению пользователя в запросе — оно показано
//!   в окне), действует не дольше 15 минут и не больше 30 запросов. Другой разговор = новый вопрос;
//!   смена или удаление ключа отзывает все разрешения;
//! - только известные провайдеры и строгая рекурсивная схема тела запроса;
//! - лимит частоты запросов и изменений ключей.

use serde_json::{Map, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const SERVICE: &str = "com.svetlana.desktop";
const MAX_SECRET: usize = 4096;
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;
const MAX_MESSAGES: usize = 200;
const MAX_TEXT: usize = 200_000;
const PROVIDERS: [&str; 7] = ["openai", "groq", "openrouter", "deepseek", "mistral", "anthropic", "google"];
const CHAT_PER_MINUTE: usize = 30;
const SECRET_WRITES_PER_MINUTE: usize = 10;
const CONSENT_TTL: Duration = Duration::from_secs(15 * 60);
const CONSENT_MAX_USES: u32 = 30;

/// Разрешение из нативного окна.
struct Consent {
    provider: String,
    model: String,
    conversation: u64,
    at: Instant,
    uses: u32,
}

static CHAT_CALLS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static SECRET_WRITES: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static CONSENTS: Mutex<Vec<Consent>> = Mutex::new(Vec::new());

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

/// Разговор запроса: отпечаток и начало первого сообщения пользователя (для окна подтверждения).
fn conversation_of(provider: &str, body: &Value) -> (u64, String) {
    let list_key = if provider == "google" { "contents" } else { "messages" };
    let first = body
        .get(list_key)
        .and_then(|v| v.as_array())
        .and_then(|l| l.iter().find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user")));
    let text = first
        .and_then(|m| {
            if provider == "google" {
                m.get("parts").and_then(|p| p.as_array()).and_then(|p| p.first()).and_then(|p| p.get("text")).and_then(|t| t.as_str())
            } else {
                m.get("content").and_then(|c| c.as_str())
            }
        })
        .unwrap_or("");
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    let preview: String = text.chars().filter(|c| !c.is_control()).take(80).collect();
    (h.finish(), preview)
}

/// Есть ли свежее и не исчерпанное разрешение для этого провайдера, модели и разговора.
fn has_consent(list: &mut Vec<Consent>, provider: &str, model: &str, conversation: u64, now: Instant) -> bool {
    list.retain(|c| now.duration_since(c.at) <= CONSENT_TTL && c.uses < CONSENT_MAX_USES);
    match list.iter_mut().find(|c| c.provider == provider && c.model == model && c.conversation == conversation) {
        Some(c) => {
            c.uses += 1;
            true
        }
        None => false,
    }
}

fn revoke_consents(provider: &str) {
    CONSENTS.lock().unwrap_or_else(|e| e.into_inner()).retain(|c| c.provider != provider);
}

async fn confirm(app: &AppHandle, text: String) -> bool {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(text)
            .title("Светлана — подтверждение")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show()
    })
    .await
    .unwrap_or(false)
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

fn has_secret(e: &keyring::Entry) -> Result<bool, String> {
    match e.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub async fn secret_set(app: AppHandle, name: String, value: Option<String>) -> Result<(), String> {
    let provider = provider_of_secret(&name).ok_or("Недопустимое имя ключа")?;
    let e = entry(&name)?;
    let value = value.filter(|v| !v.is_empty());
    if let Some(v) = &value {
        if v.len() > MAX_SECRET || v.chars().any(|c| c.is_control()) {
            return Err("Некорректный ключ".into());
        }
    } else if !has_secret(&e)? {
        return Ok(());
    }
    if !rate_ok(&SECRET_WRITES, SECRET_WRITES_PER_MINUTE) {
        return Err("Слишком частое изменение ключей, подождите минуту".into());
    }
    revoke_consents(provider);
    let question = if value.is_some() {
        format!("Сохранить новый API-ключ для «{provider}» в хранилище Windows?")
    } else {
        format!("Удалить API-ключ «{provider}» из хранилища Windows?")
    };
    if !confirm(&app, question).await {
        return Err("Отменено пользователем".into());
    }
    match value {
        Some(v) => e.set_password(&v).map_err(|err| err.to_string()),
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        },
    }
}

#[tauri::command]
pub fn secret_has(name: String) -> Result<bool, String> {
    has_secret(&entry(&name)?)
}

fn valid_model(provider: &str, m: &str) -> bool {
    if m.is_empty() || m.len() > 100 {
        return false;
    }
    if provider == "google" {
        return !m.contains("..") && m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-');
    }
    m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-' || b == b'/' || b == b':')
}

fn is_text(v: Option<&Value>) -> bool {
    v.and_then(|x| x.as_str()).map_or(false, |s| s.chars().count() <= MAX_TEXT)
}

fn only_keys(o: &Map<String, Value>, allowed: &[&str]) -> Result<(), String> {
    match o.keys().find(|k| !allowed.contains(&k.as_str())) {
        Some(extra) => Err(format!("Поле «{extra}» не разрешено")),
        None => Ok(()),
    }
}

fn check_number(o: &Map<String, Value>, key: &str, min: f64, max: f64) -> Result<(), String> {
    match o.get(key) {
        None | Some(Value::Null) => Ok(()),
        Some(v) => match v.as_f64() {
            Some(n) if n >= min && n <= max => Ok(()),
            _ => Err(format!("Некорректное значение «{key}»")),
        },
    }
}

fn check_parts(v: Option<&Value>) -> Result<(), String> {
    let parts = v.and_then(|p| p.as_array()).ok_or("Нет частей сообщения")?;
    if parts.is_empty() || parts.len() > 20 {
        return Err("Некорректное число частей сообщения".into());
    }
    for p in parts {
        let po = p.as_object().ok_or("Часть сообщения должна быть объектом")?;
        only_keys(po, &["text"])?;
        if !is_text(po.get("text")) {
            return Err("Часть сообщения должна быть текстом".into());
        }
    }
    Ok(())
}

fn check_message(provider: &str, m: &Value) -> Result<(), String> {
    let o = m.as_object().ok_or("Сообщение должно быть объектом")?;
    if provider == "google" {
        only_keys(o, &["role", "parts"])?;
        match o.get("role").and_then(|r| r.as_str()) {
            Some("user") | Some("model") => {}
            _ => return Err("Недопустимая роль сообщения".into()),
        }
        return check_parts(o.get("parts"));
    }
    only_keys(o, &["role", "content"])?;
    let roles: &[&str] = if provider == "anthropic" { &["user", "assistant"] } else { &["system", "user", "assistant"] };
    match o.get("role").and_then(|r| r.as_str()) {
        Some(r) if roles.contains(&r) => {}
        _ => return Err("Недопустимая роль сообщения".into()),
    }
    if !is_text(o.get("content")) {
        return Err("Содержимое сообщения должно быть текстом".into());
    }
    Ok(())
}

fn validate_body(provider: &str, model: &str, body: &Value) -> Result<(), String> {
    let obj = body.as_object().ok_or("Тело запроса должно быть объектом")?;
    if !valid_model(provider, model) {
        return Err("Недопустимое имя модели".into());
    }
    let list_key = if provider == "google" { "contents" } else { "messages" };
    match provider {
        "google" => {
            only_keys(obj, &["contents", "systemInstruction", "generationConfig"])?;
            if let Some(si) = obj.get("systemInstruction").filter(|v| !v.is_null()) {
                let so = si.as_object().ok_or("Некорректная системная инструкция")?;
                only_keys(so, &["parts"])?;
                check_parts(so.get("parts"))?;
            }
            if let Some(gc) = obj.get("generationConfig").filter(|v| !v.is_null()) {
                let go = gc.as_object().ok_or("Некорректные параметры генерации")?;
                only_keys(go, &["temperature", "maxOutputTokens"])?;
                check_number(go, "temperature", 0.0, 2.0)?;
                check_number(go, "maxOutputTokens", 1.0, 65536.0)?;
            }
        }
        _ => {
            let allowed: &[&str] = if provider == "anthropic" {
                &["model", "max_tokens", "system", "messages", "temperature"]
            } else {
                &["model", "messages", "temperature", "max_tokens"]
            };
            only_keys(obj, allowed)?;
            if obj.get("model").and_then(|m| m.as_str()) != Some(model) {
                return Err("Модель в запросе не совпадает с выбранной".into());
            }
            if let Some(s) = obj.get("system").filter(|v| !v.is_null()) {
                if !is_text(Some(s)) {
                    return Err("Системная инструкция должна быть текстом".into());
                }
            }
            check_number(obj, "temperature", 0.0, 2.0)?;
            check_number(obj, "max_tokens", 1.0, 65536.0)?;
        }
    }
    let list = obj.get(list_key).and_then(|v| v.as_array()).ok_or("Некорректный список сообщений")?;
    if list.is_empty() || list.len() > MAX_MESSAGES {
        return Err("Некорректный список сообщений".into());
    }
    for m in list {
        check_message(provider, m)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_cloud_chat(app: AppHandle, provider: String, model: String, body: Value) -> Result<String, String> {
    let provider_id = PROVIDERS.iter().copied().find(|p| *p == provider).ok_or("Этот облачный сервис не поддерживается")?;
    validate_body(provider_id, &model, &body)?;
    if !rate_ok(&CHAT_CALLS, CHAT_PER_MINUTE) {
        return Err("Слишком много запросов к облачному ИИ, подождите минуту".into());
    }
    let (conversation, preview) = conversation_of(provider_id, &body);
    let allowed = has_consent(&mut CONSENTS.lock().unwrap_or_else(|e| e.into_inner()), provider_id, &model, conversation, Instant::now());
    if !allowed {
        let question = format!(
            "Разрешить Светлане отправить переписку в облачный ИИ «{provider_id}», модель {model}?\nРазговор: «{preview}»\nРазрешение действует только для этого разговора: 15 минут и не больше {CONSENT_MAX_USES} запросов."
        );
        if !confirm(&app, question).await {
            return Err("Отменено пользователем".into());
        }
        CONSENTS.lock().unwrap_or_else(|e| e.into_inner()).push(Consent {
            provider: provider_id.to_string(),
            model: model.clone(),
            conversation,
            at: Instant::now(),
            uses: 1,
        });
    }
    let key = match entry(&format!("ai.{provider_id}"))?.get_password() {
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
    let request = match provider_id {
        "openai" => client.post("https://api.openai.com/v1/chat/completions").bearer_auth(&key),
        "groq" => client.post("https://api.groq.com/openai/v1/chat/completions").bearer_auth(&key),
        "openrouter" => client.post("https://openrouter.ai/api/v1/chat/completions").bearer_auth(&key),
        "deepseek" => client.post("https://api.deepseek.com/v1/chat/completions").bearer_auth(&key),
        "mistral" => client.post("https://api.mistral.ai/v1/chat/completions").bearer_auth(&key),
        "anthropic" => client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key.as_str())
            .header("anthropic-version", "2023-06-01"),
        "google" => client
            .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
            .header("x-goog-api-key", key.as_str()),
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

    fn consent(p: &str, m: &str, conv: u64, at: Instant) -> Consent {
        Consent { provider: p.to_string(), model: m.to_string(), conversation: conv, at, uses: 1 }
    }

    #[test]
    fn only_known_provider_secrets() {
        assert_eq!(provider_of_secret("ai.openai"), Some("openai"));
        assert_eq!(provider_of_secret("ai.evil"), None);
        assert_eq!(provider_of_secret("stt.apikey"), None);
    }

    #[test]
    fn consent_is_bound_to_provider_model_conversation_and_expires() {
        let start = Instant::now();
        let mut list = vec![consent("openai", "gpt-4o", 7, start)];
        assert!(has_consent(&mut list, "openai", "gpt-4o", 7, start));
        assert!(!has_consent(&mut list, "openai", "gpt-4o", 8, start));
        assert!(!has_consent(&mut list, "openai", "gpt-4o-mini", 7, start));
        assert!(!has_consent(&mut list, "groq", "gpt-4o", 7, start));
        assert!(!has_consent(&mut list, "openai", "gpt-4o", 7, start + CONSENT_TTL + Duration::from_secs(1)));
        assert!(list.is_empty());
    }

    #[test]
    fn consent_runs_out_after_max_uses() {
        let start = Instant::now();
        let mut list = vec![consent("openai", "gpt-4o", 1, start)];
        for _ in 1..CONSENT_MAX_USES {
            assert!(has_consent(&mut list, "openai", "gpt-4o", 1, start));
        }
        assert!(!has_consent(&mut list, "openai", "gpt-4o", 1, start));
    }

    #[test]
    fn conversation_is_the_first_user_message() {
        let a = json!({"model": "m", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "привет"}, {"role": "user", "content": "ещё"}]});
        let b = json!({"model": "m", "messages": [{"role": "system", "content": "other"}, {"role": "user", "content": "привет"}]});
        let c = json!({"model": "m", "messages": [{"role": "user", "content": "другой"}]});
        let (ha, pa) = conversation_of("openai", &a);
        assert_eq!(pa, "привет");
        assert_eq!(ha, conversation_of("openai", &b).0);
        assert_ne!(ha, conversation_of("openai", &c).0);
        let g = json!({"contents": [{"role": "user", "parts": [{"text": "привет"}]}]});
        assert_eq!(conversation_of("google", &g).1, "привет");
    }

    #[test]
    fn body_schema_is_strict_and_recursive() {
        let ok = json!({"model": "m", "messages": [{"role": "user", "content": "hi"}], "temperature": 0.7, "max_tokens": 100});
        assert!(validate_body("openai", "m", &ok).is_ok());
        assert!(validate_body("openai", "m", &json!({"model": "m", "messages": [{"role": "user", "content": "x"}], "tools": []})).is_err());
        assert!(validate_body("openai", "m", &json!({"model": "other", "messages": [{"role": "user", "content": "x"}]})).is_err());
        assert!(validate_body("openai", "m", &json!({"model": "m", "messages": []})).is_err());
        assert!(validate_body("openai", "m", &json!({"model": "m", "messages": [{"role": "tool", "content": "x"}]})).is_err());
        assert!(validate_body("openai", "m", &json!({"model": "m", "messages": [{"role": "user", "content": {"a": 1}}]})).is_err());
        assert!(validate_body("anthropic", "m", &json!({"model": "m", "messages": [{"role": "system", "content": "x"}]})).is_err());
        assert!(validate_body("openai", "m", &json!({"model": "m", "messages": [{"role": "user", "content": "x"}], "temperature": 9})).is_err());
        assert!(validate_body("openrouter", "meta-llama/llama-3:free", &json!({"model": "meta-llama/llama-3:free", "messages": [{"role": "user", "content": "x"}]})).is_ok());
        let g = json!({"contents": [{"role": "user", "parts": [{"text": "hi"}]}], "generationConfig": {"temperature": 0.5}});
        assert!(validate_body("google", "gemini-1.5-flash", &g).is_ok());
        let bad = json!({"contents": [{"role": "user", "parts": [{"inlineData": {}}]}]});
        assert!(validate_body("google", "gemini-1.5-flash", &bad).is_err());
        assert!(validate_body("google", "../evil", &g).is_err());
        assert!(validate_body("google", "x:streamGenerateContent", &g).is_err());
    }

    #[test]
    fn rate_limit_blocks_bursts() {
        let m: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
        for _ in 0..3 {
            assert!(rate_ok(&m, 3));
        }
        assert!(!rate_ok(&m, 3));
    }
}
