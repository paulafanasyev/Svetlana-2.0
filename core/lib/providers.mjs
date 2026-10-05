// Внешние и свои ИИ-провайдеры. Внутренний формат сообщений — OpenAI (role/content/tool_calls/tool_call_id).
// Типы: openai (любой OpenAI-совместимый: vLLM с Qwen3-VL в РФ, YandexGPT, OpenAI, DeepSeek, OpenRouter, Groq, Mistral,
// Gemini /openai, Ollama /v1, LM Studio), anthropic, gigachat (OAuth Сбера). Ключи — только на сервере.
import fs from "node:fs";
import crypto from "node:crypto";
import { safeGet } from "./netguard.mjs";

export const CAPS = ["chat", "tools", "vision", "image", "video", "tts", "stt"];
const KNOWN = {
  openai: { baseUrl: "https://api.openai.com/v1" }, deepseek: { baseUrl: "https://api.deepseek.com/v1" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1" }, groq: { baseUrl: "https://api.groq.com/openai/v1" },
  mistral: { baseUrl: "https://api.mistral.ai/v1" }, gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  yandex: { baseUrl: "https://llm.api.cloud.yandex.net/v1" }, ollama: { baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1" }, vllm: { baseUrl: "http://127.0.0.1:8000/v1" },
};

export class ProviderError extends Error { constructor(msg, status = 0) { super(msg); this.status = status; this.fatal = status >= 400 && status < 500 && status !== 429; } }

const redact = (s) => String(s).replace(/(Bearer|Api-Key|Basic)\s+[A-Za-z0-9._\-+/=]+/g, "$1 ***").replace(/key=[^&\s"]+/g, "key=***").slice(0, 400);

async function http(url, { method = "POST", headers = {}, body, timeoutMs = 120000, raw = false, fetchImpl = fetch } = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method, headers, body, signal: ac.signal });
    if (!res.ok) throw new ProviderError(`${res.status} ${redact(await res.text().catch(() => ""))}`, res.status);
    return raw ? res : await res.json();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(e.name === "AbortError" ? "таймаут провайдера" : redact(e.message));
  } finally { clearTimeout(t); }
}

function parseArgs(a) {
  if (a && typeof a === "object") return a;
  try { const v = JSON.parse(a || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** Текстовый запасной путь: сервер без парсера вернул <tool_call>{…}</tool_call> (Qwen/Hermes). */
export function textToolCalls(content) {
  const out = []; const re = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g; let m, i = 0;
  while ((m = re.exec(content || ""))) { const o = parseArgs(m[1]); if (o && typeof o.name === "string") out.push({ id: `call_t${i++}`, name: o.name, arguments: parseArgs(o.arguments) ?? null }); }
  return out;
}
const strip = (s) => (s || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();

// ---------- адаптеры ----------
async function openaiChat(p, { messages, tools, temperature = 0.3, maxTokens = 2048 }, fx) {
  const body = { model: p.model, messages, temperature, max_tokens: maxTokens, ...(p.extraBody || {}) };
  if (tools?.length) { body.tools = tools; body.tool_choice = "auto"; }
  const auth = p.apiKey ? { Authorization: `${p.authScheme || "Bearer"} ${p.apiKey}` } : {};
  const j = await http(p.baseUrl.replace(/\/$/, "") + "/chat/completions", { headers: { "Content-Type": "application/json", ...auth, ...(p.headers || {}) }, body: JSON.stringify(body), timeoutMs: p.timeoutMs, fetchImpl: fx });
  const msg = j.choices?.[0]?.message || {};
  let calls = (msg.tool_calls || []).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function?.name, arguments: parseArgs(c.function?.arguments) }));
  if (!calls.length) calls = textToolCalls(msg.content);
  return { content: strip(typeof msg.content === "string" ? msg.content : ""), toolCalls: calls, usage: j.usage, finish: j.choices?.[0]?.finish_reason };
}

function toAnthropic(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out = [];
  const img = (x) => {
    const m = /^data:(.+?);base64,(.*)$/.exec(x.image_url.url);
    return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : { type: "image", source: { type: "url", url: x.image_url.url } };
  };
  const part = (c) => (typeof c === "string" ? [{ type: "text", text: c }] : (c || []).map((x) => (x.type === "image_url" ? img(x) : { type: "text", text: x.text })));
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") { const blk = { type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content) }; const last = out[out.length - 1]; if (last?.role === "user" && last.content.every((b) => b.type === "tool_result")) last.content.push(blk); else out.push({ role: "user", content: [blk] }); continue; }
    if (m.role === "assistant" && m.tool_calls?.length) { out.push({ role: "assistant", content: [...(m.content ? [{ type: "text", text: m.content }] : []), ...m.tool_calls.map((c) => ({ type: "tool_use", id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) || {} }))] }); continue; }
    out.push({ role: m.role, content: part(m.content) });
  }
  return { system, messages: out };
}
async function anthropicChat(p, { messages, tools, temperature = 0.3, maxTokens = 2048 }, fx) {
  const { system, messages: msgs } = toAnthropic(messages);
  const body = { model: p.model, max_tokens: maxTokens, temperature, system: system || undefined, messages: msgs };
  if (tools?.length) body.tools = tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
  const j = await http((p.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "") + "/messages", { headers: { "Content-Type": "application/json", "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body), timeoutMs: p.timeoutMs, fetchImpl: fx });
  const content = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const toolCalls = (j.content || []).filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, arguments: b.input && typeof b.input === "object" ? b.input : null }));
  return { content, toolCalls, usage: j.usage, finish: j.stop_reason };
}

const gigaTokens = new Map();
async function gigachatToken(p, fx) {
  const c = gigaTokens.get(p.id);
  if (c && c.exp - 60_000 > Date.now()) return c.token;
  const j = await http(p.oauthUrl || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth", { headers: { Authorization: `Basic ${p.apiKey}`, RqUID: crypto.randomUUID(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: `scope=${p.scope || "GIGACHAT_API_PERS"}`, timeoutMs: 30000, fetchImpl: fx });
  gigaTokens.set(p.id, { token: j.access_token, exp: Number(j.expires_at) || Date.now() + 25 * 60_000 });
  return j.access_token;
}
async function gigachatChat(p, { messages, tools, temperature = 0.3, maxTokens = 2048 }, fx) {
  // GigaChat: functions/function_call вместо tools/tool_calls; результат функции — role "function".
  const msgs = messages.map((m) => m.role === "tool" ? { role: "function", name: m.name || "tool", content: String(m.content) }
    : m.role === "assistant" && m.tool_calls?.length ? { role: "assistant", content: m.content || "", function_call: { name: m.tool_calls[0].function.name, arguments: parseArgs(m.tool_calls[0].function.arguments) || {} } }
      : { role: m.role, content: typeof m.content === "string" ? m.content : (m.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n") });
  const body = { model: p.model || "GigaChat-2-Max", messages: msgs, temperature, max_tokens: maxTokens };
  if (tools?.length) { body.functions = tools.map((t) => t.function); body.function_call = "auto"; }
  const token = await gigachatToken(p, fx);
  const j = await http((p.baseUrl || "https://gigachat.devices.sberbank.ru/api/v1").replace(/\/$/, "") + "/chat/completions", { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), timeoutMs: p.timeoutMs, fetchImpl: fx });
  const msg = j.choices?.[0]?.message || {};
  const toolCalls = msg.function_call ? [{ id: "call_g0", name: msg.function_call.name, arguments: parseArgs(msg.function_call.arguments) }] : [];
  return { content: strip(msg.content), toolCalls, usage: j.usage, finish: j.choices?.[0]?.finish_reason };
}

const CHAT = { openai: openaiChat, anthropic: anthropicChat, gigachat: gigachatChat };

// ---------- реестр ----------
export class Providers {
  constructor(file, fetchImpl = fetch) { this.file = file; this.fx = fetchImpl; this.list = []; this.load(); }
  load() {
    let fromFile = [];
    if (this.file && fs.existsSync(this.file)) fromFile = JSON.parse(fs.readFileSync(this.file, "utf8"));
    let fromEnv = [];
    if (process.env.SVETLANA_PROVIDERS) fromEnv = JSON.parse(process.env.SVETLANA_PROVIDERS);
    this.list = [...fromEnv, ...fromFile].map((p) => this.normalize(p));
  }
  normalize(p) {
    const preset = KNOWN[p.preset || p.id] || {};
    const type = p.type || (p.preset === "anthropic" ? "anthropic" : p.preset === "gigachat" ? "gigachat" : "openai");
    if (!CHAT[type]) throw new Error(`неизвестный тип провайдера ${type}`);
    const caps = (p.capabilities || ["chat", "tools"]).filter((c) => CAPS.includes(c));
    return { enabled: true, timeoutMs: 120000, ...preset, ...p, type, capabilities: caps };
  }
  save() {
    if (!this.file) return;
    const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(this.list.filter((p) => !p.fromEnv), null, 1), { mode: 0o600 }); fs.renameSync(tmp, this.file);
  }
  upsert(p) { const n = this.normalize(p); const i = this.list.findIndex((x) => x.id === n.id); if (i >= 0) this.list[i] = { ...this.list[i], ...n }; else this.list.push(n); this.save(); return n; }
  remove(id) { this.list = this.list.filter((p) => p.id !== id); this.save(); }
  /** Публичный вид — без ключей. */
  public() { return this.list.map(({ apiKey, headers, ...p }) => ({ ...p, hasKey: Boolean(apiKey) })); }
  for(cap, preferId) {
    const ok = this.list.filter((p) => p.enabled && p.capabilities.includes(cap));
    return preferId ? [...ok.filter((p) => p.id === preferId), ...ok.filter((p) => p.id !== preferId)] : ok;
  }
  /** Вызов модели с переходом на следующего провайдера при сбое сети/5xx. Инструменты при этом не выполняются повторно. */
  async chat(req, { need = "chat", prefer } = {}) {
    const hasImage = req.messages.some((m) => Array.isArray(m.content) && m.content.some((x) => x.type === "image_url"));
    const chain = this.for(hasImage ? "vision" : need, prefer).filter((p) => !req.tools?.length || p.capabilities.includes("tools"));
    if (!chain.length) throw new ProviderError(hasImage ? "нет провайдера с зрением (capability vision)" : "не настроен ни один провайдер ИИ");
    const errors = [];
    for (const p of chain) {
      try { const r = await CHAT[p.type](p, req, this.fx); return { ...r, provider: p.id, model: p.model }; }
      catch (e) { errors.push(`${p.id}: ${e.message}`); if (e.fatal && chain.length === 1) break; }
    }
    throw new ProviderError("все провайдеры недоступны — " + errors.join(" | "));
  }
  async image(prompt, { size = "1024x1024" } = {}) {
    const p = this.for("image")[0]; if (!p) throw new ProviderError("не подключён провайдер генерации изображений (capability image)");
    const j = await http(p.baseUrl.replace(/\/$/, "") + "/images/generations", { headers: { "Content-Type": "application/json", ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) }, body: JSON.stringify({ model: p.imageModel || p.model, prompt, size, n: 1, response_format: "b64_json" }), timeoutMs: 300000, fetchImpl: this.fx });
    const d = j.data?.[0]; if (!d) throw new ProviderError("провайдер не вернул изображение");
    if (d.b64_json) return { bytes: Buffer.from(d.b64_json, "base64"), mime: "image/png", provider: p.id };
    const r = await safeGet(d.url, { maxBytes: 30_000_000, timeoutMs: 60000 }); if (r.status >= 400) throw new ProviderError("не удалось скачать изображение"); return { bytes: r.body, mime: String(r.headers["content-type"] || "image/png"), provider: p.id };
  }
  /** Видео: асинхронная задача у провайдера (videoEndpoint: POST → {id}, GET /{id} → {status,url}). */
  async video(prompt, { seconds = 5, pollMs = 5000, maxWaitMs = 15 * 60_000 } = {}) {
    const p = this.for("video")[0]; if (!p?.videoEndpoint) throw new ProviderError("не подключён провайдер видео (capability video + videoEndpoint)");
    const h = { "Content-Type": "application/json", ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) };
    const job = await http(p.videoEndpoint, { headers: h, body: JSON.stringify({ model: p.videoModel || p.model, prompt, duration: seconds }), fetchImpl: this.fx });
    const id = job.id || job.task_id; if (!id) throw new ProviderError("провайдер видео не вернул id задачи");
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      const s = await http(`${p.videoEndpoint.replace(/\/$/, "")}/${encodeURIComponent(id)}`, { method: "GET", headers: h, fetchImpl: this.fx });
      const st = String(s.status || s.state || "").toLowerCase();
      if (["succeeded", "completed", "success", "done"].includes(st)) {
        const url = s.url || s.video_url || s.output?.[0] || s.result?.url; if (!url) throw new ProviderError("задача завершена без ссылки на видео");
        const r = await safeGet(url, { maxBytes: 300_000_000, timeoutMs: 300000 }); if (r.status >= 400) throw new ProviderError("не удалось скачать видео");
        return { bytes: r.body, mime: String(r.headers["content-type"] || "video/mp4"), provider: p.id };
      }
      if (["failed", "error", "cancelled"].includes(st)) throw new ProviderError(`видео не сгенерировано: ${redact(s.error || st)}`);
    }
    throw new ProviderError("видео не готово за отведённое время");
  }
  async tts(text, { voice } = {}) {
    const p = this.for("tts")[0]; if (!p) return null; // клиент озвучит голосом браузера
    if (p.ttsType === "yandex") {
      const body = new URLSearchParams({ text: text.slice(0, 4900), lang: "ru-RU", voice: voice || p.voice || "alena", format: "mp3", ...(p.folderId ? { folderId: p.folderId } : {}) });
      const r = await http("https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize", { headers: { Authorization: `Api-Key ${p.apiKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), raw: true, fetchImpl: this.fx });
      return { bytes: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" };
    }
    const r = await http(p.baseUrl.replace(/\/$/, "") + "/audio/speech", { headers: { "Content-Type": "application/json", ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) }, body: JSON.stringify({ model: p.ttsModel || "tts-1", input: text.slice(0, 4000), voice: voice || p.voice || "alloy", response_format: "mp3" }), raw: true, fetchImpl: this.fx });
    return { bytes: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" };
  }
  async stt(bytes, mime) {
    const p = this.for("stt")[0]; if (!p) throw new ProviderError("распознавание речи на сервере не подключено — используется распознавание в браузере");
    const fd = new FormData(); fd.set("file", new Blob([bytes], { type: mime }), "voice.webm"); fd.set("model", p.sttModel || "whisper-1"); fd.set("language", "ru");
    const j = await http(p.baseUrl.replace(/\/$/, "") + "/audio/transcriptions", { headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}, body: fd, fetchImpl: this.fx });
    return String(j.text || "");
  }
}
export { toAnthropic, redact };
