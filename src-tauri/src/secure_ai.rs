//! Ключи облачных ИИ в настольной версии Светланы.
//!
//! Ключ хранится в Диспетчере учётных данных Windows (keyring) и никогда не возвращается в
//! JavaScript: у фронтенда есть только «сохранить», «есть ли ключ» и «сделать запрос».
//! Запрос идёт только на фиксированный официальный адрес выбранного сервиса, без редиректов,
//! с ограничением размера и времени. Поэтому даже чужой скрипт на странице не может ни прочитать
//! ключ, ни отправить его на свой сервер.

use serde_json::Value;
use std::time::Duration;

const SERVICE: &str = "com.svetlana.desktop";
const MAX_SECRET: usize = 4096;
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_' || b == b'-')
}

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !valid_name(name) {
        return Err("Недопустимое имя ключа".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

/// Сохранить ключ (пустое значение удаляет).
#[tauri::command]
pub fn secret_set(name: String, value: Option<String>) -> Result<(), String> {
    let e = entry(&name)?;
    match value.filter(|v| !v.is_empty()) {
        Some(v) => {
            if v.len() > MAX_SECRET {
                return Err("Ключ слишком длинный".into());
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

/// Запрос к облачному ИИ: адрес фиксирован по провайдеру, ключ подставляется здесь.
#[tauri::command]
pub async fn ai_cloud_chat(provider: String, model: String, body: Value) -> Result<String, String> {
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
