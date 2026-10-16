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
//! «gigachat» — GigaChat от Сбера (бесплатный тариф для физлиц). В хранилище лежит «Ключ авторизации» из Studio;
//! по нему нативная часть получает временный токен (30 минут, храним 25 и только в памяти) и с ним
//! делает запрос. Серверы GigaChat подписаны корневым сертификатом Минцифры: он добавлен
//! ТОЛЬКО в отдельный клиент для двух фиксированных адресов GigaChat, остальные запросы ему не доверяют.
//!
//! «anymodel» (anymodel.org) и «opencode» (OpenCode Zen) — шлюзы к многим моделям с одним ключом,
//! OpenAI-совместимый /chat/completions на фиксированном адресе.
//!
//! Защита от чужого скрипта на странице:
//! - любое изменение или удаление ключа подтверждается в НАТИВНОМ окне Windows;
//! - запросы в облако идут только по разрешению из такого же окна. Разрешение привязано к
//!   провайдеру, модели И случайному ID разговора, который выдаёт только эта нативная часть
//!   (128 бит, подобрать или вычислить из текста нельзя), действует не дольше 15 минут и
//!   не больше 30 запросов. Другой разговор = новый вопрос; смена или удаление ключа отзывает
//!   все разрешения; невыданный или устаревший ID = отказ;
//! - только известные провайдеры и строгая рекурсивная схема тела запроса;
//! - лимит частоты запросов, новых разговоров и изменений ключей;
//! - размер запроса проверяется ДО разбора схемы, ответ читается по частям и обрывается на лимите
//!   (сервер не может забить память огромным ответом).

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
const PROVIDERS: [&str; 11] = ["openai", "groq", "openrouter", "deepseek", "mistral", "anthropic", "google", "svetlana", "gigachat", "anymodel", "opencode"];
/// Единая Светлана на своём сервере (мир-самозанятых.рф), профиль полного режима Svetlana 2.0.
const SVETLANA_CORE: &str = "https://xn----8sba1acxdkgqms3b9euc.xn--p1ai/api/v1/assistant/svetlana2/chat";
const SVETLANA_MODEL: &str = "svetlana2";
const SVETLANA_MAX_HISTORY: usize = 10;
/// AnyModel и OpenCode Zen: фиксированные OpenAI-совместимые адреса.
const ANYMODEL_CHAT: &str = "https://anymodel.org/v1/chat/completions";
const OPENCODE_CHAT: &str = "https://opencode.ai/zen/v1/chat/completions";
/// GigaChat: вход по ключу авторизации и запрос (официальные адреса из документации developers.sber.ru).
const GIGACHAT_OAUTH: &str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const GIGACHAT_CHAT: &str = "https://api.giga.chat/v1/chat/completions";
const GIGACHAT_SCOPE: &str = "GIGACHAT_API_PERS";
const GIGACHAT_TOKEN_TTL: Duration = Duration::from_secs(25 * 60);
const MAX_TOKEN_RESPONSE: usize = 64 * 1024;
const GIGACHAT_BAD_KEY: &str = "GigaChat не принял ключ: вставьте «Ключ авторизации» из проекта GigaChat API в Studio (developers.sber.ru/studio)";
const GIGACHAT_NO_TOKENS: &str = "GigaChat: закончились токены на счёте (проверьте лимит в Studio или выберите другую модель)";
/// Корневой сертификат Минцифры (Russian Trusted Root CA, до 2032 года) — только для клиента GigaChat.
const RUSSIAN_TRUSTED_ROOT_CA: &str = include_str!("../certs/russian_trusted_root_ca.pem");
const CHAT_PER_MINUTE: usize = 30;
const SECRET_WRITES_PER_MINUTE: usize = 10;
const CONSENT_TTL: Duration = Duration::from_secs(15 * 60);
const CONSENT_MAX_USES: u32 = 30;
const CONVERSATION_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_CONVERSATIONS: usize = 32;
const CONVERSATIONS_PER_MINUTE: usize = 10;
const CONVERSATION_UNKNOWN: &str = "CONVERSATION_UNKNOWN: разговор не выдан приложением или устарел";
const TOO_BIG_RESPONSE: &str = "Ответ слишком большой";

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

/// Временный токен GigaChat (только в памяти), привязан к отпечатку ключа, с которым получен.
struct GigaToken {
    key_hash: [u8; 32],
    token: String,
    at: Instant,
}

static CHAT_CALLS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static SECRET_WRITES: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static NEW_CONVERSATIONS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static CONSENTS: Mutex<Vec<Consent>> = Mutex::new(Vec::new());
static ISSUED: Mutex<VecDeque<Issued>> = Mutex::new(VecDeque::new());
static GIGA_TOKEN: Mutex<Option<GigaToken>> = Mutex::new(None);
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

/// Добавить кусок ответа, не превышая лимит (иначе — ошибка и чтение обрывается).
fn push_limited(buf: &mut Vec<u8>, chunk: &[u8], max: usize) -> Result<(), String> {
    if buf.len().saturating_add(chunk.len()) > max {
        return Err(TOO_BIG_RESPONSE.into());
    }
    buf.extend_from_slice(chunk);
    Ok(())
}

/// Прочитать ответ по частям и оборвать на лимите: без Content-Length сервер мог бы слать сколько угодно.
async fn read_limited(mut response: reqwest::Response, max: usize) -> Result<(reqwest::StatusCode, String), String> {
    let status = response.status();
    if response.content_length().map_or(false, |n| n > max as u64) {
        return Err(TOO_BIG_RESPONSE.into());
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.without_url().to_string())? {
        push_limited(&mut bytes, &chunk, max)?;
    }
    Ok((status, String::from_utf8_lossy(&bytes).into_owned()))
}

fn http_result(status: reqwest::StatusCode, text: String) -> Result<String, String> {
    if !status.is_success() {
        let short: String = text.chars().take(500).collect();
        return Err(format!("HTTP {}: {}", status.as_u16(), short));
    }
    Ok(text)
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

// ---------- GigaChat: ключ авторизации → временный токен → запрос ----------

/// «Ключ авторизации» из Studio — строка base64 (без пробелов и слова Basic).
fn valid_gigachat_key(k: &str) -> bool {
    (16..=1024).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

fn key_hash(key: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&Sha256::digest(key.as_bytes()));
    out
}

/// Уникальный номер запроса для GigaChat (RqUID) в виде UUID v4.
fn rq_uid() -> String {
    let h = random_id();
    let variant = ["8", "9", "a", "b"][(u8::from_str_radix(&h[16..17], 16).unwrap_or(0) & 3) as usize];
    format!("{}-{}-4{}-{}{}-{}", &h[0..8], &h[8..12], &h[13..16], variant, &h[17..20], &h[20..32])
}

fn cached_giga_token(slot: &Option<GigaToken>, hash: &[u8; 32], now: Instant) -> Option<String> {
    slot.as_ref()
        .filter(|t| &t.key_hash == hash && now.duration_since(t.at) < GIGACHAT_TOKEN_TTL)
        .map(|t| t.token.clone())
}

fn giga_cached(hash: &[u8; 32]) -> Option<String> {
    let slot = GIGA_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    cached_giga_token(&slot, hash, Instant::now())
}

fn giga_store(hash: [u8; 32], token: String) {
    *GIGA_TOKEN.lock().unwrap_or_else(|e| e.into_inner()) = Some(GigaToken { key_hash: hash, token, at: Instant::now() });
}

fn forget_giga_token() {
    *GIGA_TOKEN.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Токен из ответа входа: только печатные ASCII-символы и разумная длина (он уйдёт в заголовок).
fn parse_giga_token(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    let t = v.get("access_token")?.as_str()?;
    if t.is_empty() || t.len() > 8192 || !t.bytes().all(|b| b.is_ascii_graphic()) {
        return None;
    }
    Some(t.to_string())
}

/// Отдельный клиент: системные корневые сертификаты + сертификат Минцифры, без редиректов.
fn gigachat_client() -> Result<reqwest::Client, String> {
    let ca = reqwest::Certificate::from_pem(RUSSIAN_TRUSTED_ROOT_CA.as_bytes()).map_err(|e| e.to_string())?;
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .add_root_certificate(ca)
        .build()
        .map_err(|e| e.to_string())
}

async fn gigachat_token(client: &reqwest::Client, key: &str) -> Result<String, String> {
    let hash = key_hash(key);
    if let Some(t) = giga_cached(&hash) {
        return Ok(t);
    }
    let response = client
        .post(GIGACHAT_OAUTH)
        .header("Authorization", format!("Basic {key}"))
        .header("RqUID", rq_uid())
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .body(format!("scope={GIGACHAT_SCOPE}"))
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let (status, text) = read_limited(response, MAX_TOKEN_RESPONSE).await?;
    match status.as_u16() {
        400 | 401 | 403 => return Err(GIGACHAT_BAD_KEY.into()),
        s if !status.is_success() => return Err(format!("GigaChat: вход не удался, HTTP {s}")),
        _ => {}
    }
    let token = parse_giga_token(&text).ok_or("GigaChat: в ответе нет токена")?;
    giga_store(hash, token.clone());
    Ok(token)
}

/// Запрос к GigaChat. Если токен устарел раньше срока (401) — один повтор с новым токеном.
async fn gigachat_chat(key: &str, body_text: String) -> Result<String, String> {
    if !valid_gigachat_key(key) {
        return Err(GIGACHAT_BAD_KEY.into());
    }
    let client = gigachat_client()?;
    for attempt in 0..2 {
        let token = gigachat_token(&client, key).await?;
        let response = client
            .post(GIGACHAT_CHAT)
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .body(body_text.clone())
            .send()
            .await
            .map_err(|e| e.without_url().to_string())?;
        let (status, text) = read_limited(response, MAX_RESPONSE).await?;
        match status.as_u16() {
            401 if attempt == 0 => {
                forget_giga_token();
                continue;
            }
            401 => return Err(GIGACHAT_BAD_KEY.into()),
            402 => return Err(GIGACHAT_NO_TOKENS.into()),
            _ => return http_result(status, text),
        }
    }
    Err(GIGACHAT_BAD_KEY.into())
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
        if provider == "gigachat" && !valid_gigachat_key(v) {
            return Err(GIGACHAT_BAD_KEY.into());
        }
    } else if !has_secret(&e)? {
        return Ok(());
    }
    if !rate_ok(&SECRET_WRITES, SECRET_WRITES_PER_MINUTE) {
        return Err("Слишком частое изменение ключей, подождите минуту".into());
    }
    revoke_consents(provider);
    if provider == "gigachat" {
        forget_giga_token();
    }
    let question = if value.is_some() {
        format!("Сохранить новый API-ключ для «{provider}» в хранилище Windows?")
    } else {
        format!("Удалить API-ключ «{provider}» из хранилища Windows?")
    };
    if !confirm(&app, question).await {
        return Err("Отменено пользователем".into());
    }
    let result = match value {
        Some(v) => e.set_password(&v).map_err(|err| err.to_string()),
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        },
    };
    if provider == "gigachat" {
        forget_giga_token();
    }
    result
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
            // GigaChat не принимает температуру 0.
            let t_min = if provider == "gigachat" { 0.01 } else { 0.0 };
            check_number(obj, "temperature", t_min, 2.0)?;
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
    // Размер — до разбора схемы: огромное тело не должно проходить рекурсивную проверку и подсчёт символов.
    let body_text = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    if body_text.len() > MAX_BODY {
        return Err("Запрос слишком большой".into());
    }
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
    if provider_id == "gigachat" {
        return gigachat_chat(&key, body_text).await;
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
        "anymodel" => client.post(ANYMODEL_CHAT).bearer_auth(&key),
        "opencode" => client.post(OPENCODE_CHAT).bearer_auth(&key),
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
    let (status, text) = read_limited(response, MAX_RESPONSE).await?;
    http_result(status, text)
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
        assert_eq!(provider_of_secret("ai.gigachat"), Some("gigachat"));
        assert_eq!(provider_of_secret("ai.anymodel"), Some("anymodel"));
        assert_eq!(provider_of_secret("ai.opencode"), Some("opencode"));
        assert_eq!(provider_of_secret("ai.evil"), None);
        assert_eq!(provider_of_secret("ai.custom"), None);
        assert_eq!(provider_of_secret("stt.apikey"), None);
    }

    #[test]
    fn gateway_addresses_are_fixed_https() {
        assert_eq!(ANYMODEL_CHAT, "https://anymodel.org/v1/chat/completions");
        assert_eq!(OPENCODE_CHAT, "https://opencode.ai/zen/v1/chat/completions");
        let ok = json!({"model": "kimi-k2.5", "messages": [{"role": "user", "content": "hi"}], "temperature": 0.7, "max_tokens": 100});
        assert!(validate_body("opencode", "kimi-k2.5", &ok).is_ok());
        let any = json!({"model": "claude-sonnet-4.5", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "hi"}]});
        assert!(validate_body("anymodel", "claude-sonnet-4.5", &any).is_ok());
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
    fn response_reading_stops_at_the_limit() {
        let mut buf = Vec::new();
        assert!(push_limited(&mut buf, &[1, 2, 3], 5).is_ok());
        assert!(push_limited(&mut buf, &[4, 5], 5).is_ok());
        assert_eq!(buf.len(), 5);
        assert_eq!(push_limited(&mut buf, &[6], 5), Err(TOO_BIG_RESPONSE.to_string()));
        assert_eq!(buf.len(), 5);
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
    fn gigachat_body_key_and_token_rules() {
        let ok = json!({"model": "GigaChat-2", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "привет"}], "temperature": 0.7, "max_tokens": 100});
        assert!(validate_body("gigachat", "GigaChat-2", &ok).is_ok());
        let zero = json!({"model": "GigaChat-2", "messages": [{"role": "user", "content": "x"}], "temperature": 0});
        assert!(validate_body("gigachat", "GigaChat-2", &zero).is_err());
        assert!(valid_gigachat_key("MDE5YWJjZGUtZjAxMi00NTY3OmFiY2RlZg=="));
        assert!(!valid_gigachat_key("Basic MDE5YWJjZGUtZjAxMi00NTY3"));
        assert!(!valid_gigachat_key("short"));
        assert!(!valid_gigachat_key("MDE5YWJjZGUtZjAx\r\nX-Evil: 1"));
        let id = rq_uid();
        assert_eq!(id.len(), 36);
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), vec![8, 4, 4, 4, 12]);
        assert!(parts[2].starts_with('4'));
        assert!(matches!(parts[3].chars().next(), Some('8' | '9' | 'a' | 'b')));
        assert_ne!(rq_uid(), rq_uid());
        assert_eq!(parse_giga_token(r#"{"access_token":"eyJ.abc","expires_at":1}"#), Some("eyJ.abc".to_string()));
        assert_eq!(parse_giga_token(r#"{"access_token":"a b"}"#), None);
        assert_eq!(parse_giga_token("not json"), None);
        assert!(reqwest::Certificate::from_pem(RUSSIAN_TRUSTED_ROOT_CA.as_bytes()).is_ok());
    }

    #[test]
    fn gigachat_token_is_bound_to_the_key_and_expires() {
        let start = Instant::now();
        let slot = Some(GigaToken { key_hash: key_hash("key-one-aaaaaaaaaaaa"), token: "t1".into(), at: start });
        assert_eq!(cached_giga_token(&slot, &key_hash("key-one-aaaaaaaaaaaa"), start), Some("t1".to_string()));
        assert_eq!(cached_giga_token(&slot, &key_hash("key-two-bbbbbbbbbbbb"), start), None);
        assert_eq!(cached_giga_token(&slot, &key_hash("key-one-aaaaaaaaaaaa"), start + GIGACHAT_TOKEN_TTL), None);
        assert_eq!(cached_giga_token(&None, &key_hash("key-one-aaaaaaaaaaaa"), start), None);
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
