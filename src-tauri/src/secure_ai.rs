//! Ключи облачных ИИ в настольной версии Светланы.
//!
//! Ключ хранится в Диспетчере учётных данных Windows (keyring) и никогда не возвращается в
//! JavaScript: у фронтенда есть только «сохранить», «есть ли ключ» и «сделать запрос».
//! Запрос идёт только на фиксированный официальный адрес выбранного сервиса, без редиректов,
//! с ограничением размера и времени.
//!
//! «svetlana» — единая Светлана на своём сервере (мир-самозанятых.рф), полный режим Svetlana 2.0.
//! Ключ — ASSISTANT_KEY_SVETLANA2 с сервера, адрес фиксирован (SVETLANA_CORE), тело { message, history, system }.
//!
//! Защита от чужого скрипта на странице:
//! - любое изменение или удаление ключа подтверждается в НАТИВНОМ окне Windows;
//! - запросы в облако идут только по разрешению из такого же окна. Разрешение привязано к
//!   провайдеру, модели И случайному ID разговора, который выдаёт только эта нативная часть
//!   (128 бит, подобрать или вычислить из текста нельзя), действует не дольше 15 минут и
//!   не больше 30 запросов. Другой разговор = новый вопрос; смена или удаление ключа отзывает
//!   все разрешения; невыданный или устаревший ID = отказ;
//! - только известные провайдеры и строгая рекурсивная схема тела запроса;
//! - лимит частоты запросов, новых разговоров и изменений ключей.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::hash_map::RandomState;
use std::collections::VecDeque;
use std::hash::BuildHasher;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const SERVICE: &str = "com.svetlana.desktop";
const MAX_SECRET: usize = 4096;
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;
const MAX_MESSAGES: usize = 200;
const MAX_TEXT: usize = 200_000;
const PROVIDERS: [&str; 8] = ["openai", "groq", "openrouter", "deepseek", "mistral", "anthropic", "google", "svetlana"];
/// Единая Светлана на своём сервере (мир-самозанятых.рф), профиль полного режима Svetlana 2.0.
const SVETLANA_CORE: &str = "https://xn----8sba1acxdkgqms3b9euc.xn--p1ai/api/v1/assistant/svetlana2/chat";
const SVETLANA_MODEL: &str = "svetlana2";
const SVETLANA_MAX_HISTORY: usize = 10;
const CHAT_PER_MINUTE: usize = 30;
const SECRET_WRITES_PER_MINUTE: usize = 10;
const CONSENT_TTL: Duration = Duration::from_secs(15 * 60);
const CONSENT_MAX_USES: u32 = 30;
const CONVERSATION_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_CONVERSATIONS: usize = 32;
const CONVERSATIONS_PER_MINUTE: usize = 10;
const CONVERSATION_UNKNOWN: &str = "CONVERSATION_UNKNOWN: разговор не выдан приложением или устарел";

/// Разрешение из нативного окна.
struct Consent {
    provider: String,
    model: String,
    conversation: String,
    at: Instant,
    uses: u32,
}

/// Выданный нативной частью ID разговора.
struct Issued {
    id: String,
    at: Instant,
}

static CHAT_CALLS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static SECRET_WRITES: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static NEW_CONVERSATIONS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static CONSENTS: Mutex<Vec<Consent>> = Mutex::new(Vec::new());
static ISSUED: Mutex<VecDeque<Issued>> = Mutex::new(VecDeque::new());
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

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

/// 128-битный случайный ID: случайные ключи ОС (RandomState) + счётчик + время + pid, через SHA-256.
fn random_id() -> String {
    let mut h = Sha256::new();
    for i in 0u64..4 {
        h.update(RandomState::new().hash_one(i).to_le_bytes());
    }
    h.update(ID_COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    h.update(nanos.to_le_bytes());
    h.update(std::process::id().to_le_bytes());
    h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn issue_conversation(list: &mut VecDeque<Issued>, now: Instant) -> String {
    list.retain(|c| now.duration_since(c.at) <= CONVERSATION_TTL);
    while list.len() >= MAX_CONVERSATIONS {
        list.pop_front();
    }
    let id = random_id();
    list.push_back(Issued { id: id.clone(), at: now });
    id
}

fn is_issued(list: &mut VecDeque<Issued>, id: &str, now: Instant) -> bool {
    list.retain(|c| now.duration_since(c.at) <= CONVERSATION_TTL);
    id.len() == 32 && list.iter().any(|c| c.id == id)
}

/// Начало первого сообщения пользователя — только для окна подтверждения.
fn preview_of(provider: &str, body: &Value) -> String {
    if provider == "svetlana" {
        let text = body.get("message").and_then(|m| m.as_str()).unwrap_or("");
        return text.chars().filter(|c| !c.is_control()).take(80).collect();
    }
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
    text.chars().filter(|c| !c.is_control()).take(80).collect()
}

/// Есть ли свежее и не исчерпанное разрешение для этого провайдера, модели и разговора.
fn has_consent(list: &mut Vec<Consent>, provider: &str, model: &str, conversation: &str, now: Instant) -> bool {
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

/// Новый разговор: случайный ID, к которому будет привязано разрешение на облако.
#[tauri::command]
pub fn ai_new_conversation() -> Result<String, String> {
    if !rate_ok(&NEW_CONVERSATIONS, CONVERSATIONS_PER_MINUTE) {
        return Err("Слишком много новых разговоров, подождите минуту".into());
    }
    Ok(issue_conversation(&mut ISSUED.lock().unwrap_or_else(|e| e.into_inner()), Instant::now()))
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
    let roles: &[&str] = if provider == "anthropic" || provider == "svetlana" { &["user", "assistant"] } else { &["system", "user", "assistant"] };
    match o.get("role").and_then(|r| r.as_str()) {
        Some(r) if roles.contains(&r) => {}
        _ => return Err("Недопустимая роль сообщения".into()),
    }
    if !is_text(o.get("content")) {
        return Err("Содержимое сообщения должно быть текстом".into());
    }
    Ok(())
}

/// Тело запроса к единой Светлане: { message, history?, system? } и ничего больше.
fn validate_svetlana(model: &str, obj: &Map<String, Value>) -> Result<(), String> {
    if model != SVETLANA_MODEL {
        return Err("Недопустимое имя модели".into());
    }
    only_keys(obj, &["message", "history", "system"])?;
    match obj.get("message").and_then(|m| m.as_str()) {
        Some(s) if !s.trim().is_empty() && s.chars().count() <= MAX_TEXT => {}
        _ => return Err("Сообщение должно быть непустым текстом".into()),
    }
    if let Some(s) = obj.get("system").filter(|v| !v.is_null()) {
        if !is_text(Some(s)) {
            return Err("Системная инструкция должна быть текстом".into());
        }
    }
    if let Some(h) = obj.get("history").filter(|v| !v.is_null()) {
        let list = h.as_array().ok_or("Некорректная история разговора")?;
        if list.len() > SVETLANA_MAX_HISTORY {
            return Err("Слишком длинная история разговора".into());
        }
        for m in list {
            check_message("svetlana", m)?;
        }
    }
    Ok(())
}

fn validate_body(provider: &str, model: &str, body: &Value) -> Result<(), String> {
    let obj = body.as_object().ok_or("Тело запроса должно быть объектом")?;
    if provider == "svetlana" {
        return validate_svetlana(model, obj);
    }
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
pub async fn ai_cloud_chat(app: AppHandle, provider: String, model: String, conversation: String, body: Value) -> Result<String, String> {
    let provider_id = PROVIDERS.iter().copied().find(|p| *p == provider).ok_or("Этот облачный сервис не поддерживается")?;
    validate_body(provider_id, &model, &body)?;
    if !is_issued(&mut ISSUED.lock().unwrap_or_else(|e| e.into_inner()), &conversation, Instant::now()) {
        return Err(CONVERSATION_UNKNOWN.into());
    }
    if !rate_ok(&CHAT_CALLS, CHAT_PER_MINUTE) {
        return Err("Слишком много запросов к облачному ИИ, подождите минуту".into());
    }
    let allowed = has_consent(&mut CONSENTS.lock().unwrap_or_else(|e| e.into_inner()), provider_id, &model, &conversation, Instant::now());
    if !allowed {
        let preview = preview_of(provider_id, &body);
        let question = format!(
            "Разрешить Светлане отправить переписку в облачный ИИ «{provider_id}», модель {model}?\nРазговор: «{preview}»\nРазрешение действует только для этого разговора: 15 минут и не больше {CONSENT_MAX_USES} запросов."
        );
        if !confirm(&app, question).await {
            return Err("Отменено пользователем".into());
        }
        CONSENTS.lock().unwrap_or_else(|e| e.into_inner()).push(Consent {
            provider: provider_id.to_string(),
            model: model.clone(),
            conversation: conversation.clone(),
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
        "svetlana" => client.post(SVETLANA_CORE).bearer_auth(&key),
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

    fn consent(p: &str, m: &str, conv: &str, at: Instant) -> Consent {
        Consent { provider: p.to_string(), model: m.to_string(), conversation: conv.to_string(), at, uses: 1 }
    }

    #[test]
    fn only_known_provider_secrets() {
        assert_eq!(provider_of_secret("ai.openai"), Some("openai"));
        assert_eq!(provider_of_secret("ai.svetlana"), Some("svetlana"));
        assert_eq!(provider_of_secret("ai.evil"), None);
        assert_eq!(provider_of_secret("stt.apikey"), None);
    }

    #[test]
    fn consent_is_bound_to_provider_model_conversation_and_expires() {
        let start = Instant::now();
        let mut list = vec![consent("openai", "gpt-4o", "c7", start)];
        assert!(has_consent(&mut list, "openai", "gpt-4o", "c7", start));
        assert!(!has_consent(&mut list, "openai", "gpt-4o", "c8", start));
        assert!(!has_consent(&mut list, "openai", "gpt-4o-mini", "c7", start));
        assert!(!has_consent(&mut list, "groq", "gpt-4o", "c7", start));
        assert!(!has_consent(&mut list, "openai", "gpt-4o", "c7", start + CONSENT_TTL + Duration::from_secs(1)));
        assert!(list.is_empty());
    }

    #[test]
    fn consent_runs_out_after_max_uses() {
        let start = Instant::now();
        let mut list = vec![consent("openai", "gpt-4o", "c1", start)];
        for _ in 1..CONSENT_MAX_USES {
            assert!(has_consent(&mut list, "openai", "gpt-4o", "c1", start));
        }
        assert!(!has_consent(&mut list, "openai", "gpt-4o", "c1", start));
    }

    #[test]
    fn conversations_are_random_issued_and_bounded() {
        let start = Instant::now();
        let mut list = VecDeque::new();
        let a = issue_conversation(&mut list, start);
        let b = issue_conversation(&mut list, start);
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
        assert!(is_issued(&mut list, &a, start));
        assert!(!is_issued(&mut list, &"0".repeat(32), start));
        assert!(!is_issued(&mut list, "", start));
        for _ in 0..MAX_CONVERSATIONS {
            issue_conversation(&mut list, start);
        }
        assert!(list.len() <= MAX_CONVERSATIONS);
        assert!(!is_issued(&mut list, &a, start));
        let c = issue_conversation(&mut list, start);
        assert!(is_issued(&mut list, &c, start));
        assert!(!is_issued(&mut list, &c, start + CONVERSATION_TTL + Duration::from_secs(1)));
    }

    #[test]
    fn preview_is_the_first_user_message() {
        let a = json!({"model": "m", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "привет"}, {"role": "user", "content": "ещё"}]});
        assert_eq!(preview_of("openai", &a), "привет");
        let g = json!({"contents": [{"role": "user", "parts": [{"text": "привет"}]}]});
        assert_eq!(preview_of("google", &g), "привет");
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
    fn svetlana_core_body_is_strict() {
        let ok = json!({"message": "Проверь код", "history": [{"role": "user", "content": "привет"}, {"role": "assistant", "content": "да"}], "system": "инструменты"});
        assert!(validate_body("svetlana", "svetlana2", &ok).is_ok());
        assert!(validate_body("svetlana", "svetlana2", &json!({"message": "x"})).is_ok());
        assert!(validate_body("svetlana", "other", &ok).is_err());
        assert!(validate_body("svetlana", "svetlana2", &json!({"message": "  "})).is_err());
        assert!(validate_body("svetlana", "svetlana2", &json!({"message": "x", "url": "https://evil.example"})).is_err());
        assert!(validate_body("svetlana", "svetlana2", &json!({"message": "x", "history": [{"role": "system", "content": "x"}]})).is_err());
        let long: Vec<Value> = (0..11).map(|_| json!({"role": "user", "content": "x"})).collect();
        assert!(validate_body("svetlana", "svetlana2", &json!({"message": "x", "history": long})).is_err());
        assert_eq!(preview_of("svetlana", &ok), "Проверь код");
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
