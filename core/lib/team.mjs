// Команда Светланы: свой ИИ по ссылке (адрес + модель + ключ), отдельные чаты со своим ИИ и роли (CTO, IT, маркетинг…).
// Павел — CEO: Светлана поручает задачи участникам команды и собирает ответы; с каждым можно говорить и напрямую в своём чате.
// Работает и на телефоне (Node 18 без ICU): без юникод-классов в регэкспах и без Intl.
import { Agent } from "./agent.mjs";
import { Providers, ProviderError } from "./providers.mjs";

const TYPES = ["openai", "anthropic", "gigachat"];
const ID_RE = /^[a-z0-9_-]{2,40}$/;
const redact = (s) => String(s ?? "").replace(/(Bearer|Api-Key|Basic)\s+[A-Za-z0-9._\-+/=]+/g, "$1 ***").replace(/key=[^&\s"]+/g, "key=***").replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").slice(0, 400);
const clip = (s, n) => String(s ?? "").slice(0, n);
/** Убрать из текста внешнего сервера и общий вид ключей, и конкретный ключ (сервер мог «отразить» его в ответе). */
const scrub = (s, key) => { let t = redact(s); const k = String(key ?? "").trim(); if (k) t = t.split(k).join("***"); return t; };
const MAX_BODY = 2 * 1024 * 1024;
async function readCapped(r, ac) { // огромный ответ /models не уронит ядро
  if (!r.body?.getReader) { const len = Number(r.headers?.get?.("content-length")); if (!(len >= 0 && len <= MAX_BODY)) throw new ProviderError("сервер вернул ответ без размера или больше 2 МБ"); return r.text(); }
  const rd = r.body.getReader(); const parts = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > MAX_BODY) { try { ac.abort(); } catch {} throw new ProviderError("сервер вернул слишком большой ответ (больше 2 МБ)"); } parts.push(value); }
  return Buffer.concat(parts.map((x) => Buffer.from(x))).toString("utf8");
}

// ---------- свой ИИ: адрес, тип, id ----------
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])(:\d+)?$/i;
/** «api.deepseek.com» → «https://api.deepseek.com»; хвост /chat/completions или /models отрезаем: его добавит ядро. */
export function normalizeUrl(u) {
  let s = String(u ?? "").trim().replace(/\s+/g, "");
  if (!s) throw new Error("укажите адрес API");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (LOCAL_HOST.test(s.split("/")[0]) ? "http://" : "https://") + s;
  let url; try { url = new URL(s); } catch { throw new Error("адрес API не похож на ссылку"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("адрес API должен начинаться с http:// или https://");
  if (url.username || url.password) throw new Error("ключ указывайте в поле «API-ключ», а не в адресе");
  url.hash = ""; url.search = "";
  let p = url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|completions|messages|models)$/i, "").replace(/\/+$/, "");
  return url.origin + p;
}
export function guessType(baseUrl, type) {
  if (TYPES.includes(type)) return type;
  const h = (() => { try { return new URL(baseUrl).hostname; } catch { return ""; } })();
  if (/(^|\.)anthropic\.com$/i.test(h)) return "anthropic";
  if (/gigachat|sberbank/i.test(h)) return "gigachat";
  return "openai";
}
const SKIP = new Set(["api", "www", "llm", "cloud", "com", "net", "org", "ru", "io", "ai", "app", "dev", "co", "us", "eu", "v1", "openai", "inference", "gateway"]);
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** id из адреса и модели: «https://api.deepseek.com» + «deepseek-chat» → «deepseek-chat»; свободный, без дублей. */
export function autoId(baseUrl, model, taken = []) {
  let host = ""; let port = "";
  try { const u = new URL(baseUrl); host = u.hostname; port = u.port; } catch {}
  const labels = host.split(".").filter((x) => x && !SKIP.has(x.toLowerCase()) && !/^\d+$/.test(x));
  const h = LOCAL_HOST.test(host) || /^\d+(\.\d+){3}$/.test(host) ? "local" + (port ? "-" + port : "") : slug(labels.sort((a, b) => b.length - a.length)[0] || "custom");
  const m = slug(String(model ?? "").split("/").pop()).slice(0, 28);
  let base = m.startsWith(h) ? m : [h, m].filter(Boolean).join("-");
  base = base.slice(0, 36).replace(/-+$/, "");
  if (base.length < 2) base = "ai-" + base;
  const used = new Set(taken); let id = base; let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

async function getJson(url, headers, fx, timeoutMs = 15000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fx(url, { method: "GET", headers, signal: ac.signal });
    const text = await readCapped(r, ac);
    if (!r.ok) throw new ProviderError(`${r.status} ${redact(text)}`, r.status);
    try { return JSON.parse(text); } catch { throw new ProviderError("сервер ответил не JSON — проверьте адрес API"); }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(e.name === "AbortError" ? "сервер не ответил за 15 секунд" : redact(e.message));
  } finally { clearTimeout(t); }
}
const GIGA_MODELS = ["GigaChat-2", "GigaChat-2-Pro", "GigaChat-2-Max"];
/** Список моделей сервера (GET {адрес}/models). Если по адресу без /v1 пусто — пробуем с /v1 и подсказываем исправленный адрес. */
export async function listModels({ baseUrl, apiKey, type, authScheme } = {}, fx = fetch) {
  const base = normalizeUrl(baseUrl); const kind = guessType(base, type);
  if (kind === "gigachat") return { ok: true, baseUrl: base, type: kind, models: GIGA_MODELS, note: "у GigaChat список фиксированный" };
  const headers = kind === "anthropic" ? { "x-api-key": apiKey || "", "anthropic-version": "2023-06-01" } : apiKey ? { Authorization: `${authScheme || "Bearer"} ${apiKey}` } : {};
  const pick = (j) => {
    const arr = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
    const ids = arr.map((x) => (typeof x === "string" ? x : x?.id || x?.name || x?.model || "")).map((s) => String(s).replace(/^models\//, "")).filter((s) => s && s.length <= 200);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 500);
  };
  const key = apiKey; const clean = (ids) => ids.filter((x) => !(key && x.includes(key)));
  try {
    const models = clean(pick(await getJson(base + "/models", headers, fx)));
    if (models.length) return { ok: true, baseUrl: base, type: kind, models };
    throw new ProviderError("сервер не вернул ни одной модели", 404);
  } catch (e) {
    if (/\/v\d+[a-z]*$/i.test(base) || !(e.status === 404 || e.status === 405)) { e.message = scrub(e.message, key); throw e; }
    const models = clean(pick(await getJson(base + "/v1/models", headers, fx).catch(() => null)));
    if (models.length) return { ok: true, baseUrl: base + "/v1", type: kind, models, note: "адрес исправлен: добавлено /v1" };
    e.message = scrub(e.message, key); throw e;
  }
}

/** Отдельный «реестр» из одного провайдера: тот же код вызова, но без перехода на других. */
function only(providers, p) { return Object.create(providers, { list: { value: [p], writable: true } }); }
/** Черновик своего ИИ из формы → провайдер (ключ существующего не теряем, если поле пустое). */
export function draftProvider(providers, d = {}) {
  const keep = d.id ? providers.list.find((x) => x.id === d.id) : null;
  const baseUrl = d.baseUrl ? normalizeUrl(d.baseUrl) : keep?.baseUrl;
  if (!baseUrl) throw new Error("укажите адрес API");
  const model = clip(String(d.model ?? keep?.model ?? "").trim(), 200);
  if (!model) throw new Error("укажите модель — впишите название или выберите из списка");
  const type = guessType(baseUrl, d.type || keep?.type);
  const apiKey = typeof d.apiKey === "string" && d.apiKey.trim() ? d.apiKey.trim() : keep?.apiKey;
  const caps = Array.isArray(d.capabilities) && d.capabilities.length ? d.capabilities : keep?.capabilities || ["chat", "tools"];
  const p = { ...(keep || {}), id: d.id || "", name: clip(String(d.name ?? keep?.name ?? "").trim(), 60) || undefined, type, baseUrl, model, apiKey, capabilities: caps, custom: true, enabled: true };
  if (!p.apiKey) delete p.apiKey;
  return providers.normalize(p);
}
/** Проверка соединения ДО сохранения: короткий ответ + умеет ли модель вызывать инструменты (нужно Светлане для действий). */
export async function probe(providers, d) {
  const p = draftProvider(providers, { ...d, capabilities: ["chat", "tools"] });
  const one = only(providers, { ...p, id: p.id || "draft", timeoutMs: 30000 });
  const t0 = Date.now();
  let answer;
  try { answer = (await Providers.prototype.chat.call(one, { messages: [{ role: "user", content: "Ответь одним словом: работает?" }], maxTokens: 20, temperature: 0 })).content; }
  catch (e) { return { ok: false, error: hint(e, p.apiKey), ms: Date.now() - t0 }; }
  const ms = Date.now() - t0;
  let tools = false;
  try {
    const r = await Providers.prototype.chat.call(one, { messages: [{ role: "user", content: "Вызови инструмент ping с аргументом x=1. Ничего не пиши." }], maxTokens: 60, temperature: 0,
      tools: [{ type: "function", function: { name: "ping", description: "проверка связи", parameters: { type: "object", properties: { x: { type: "integer" } }, required: ["x"], additionalProperties: false } } }] });
    tools = (r.toolCalls || []).some((c) => c.name === "ping");
  } catch {}
  return { ok: true, answer: clip(scrub(answer || "(пустой ответ)", p.apiKey), 80), ms, tools, model: p.model, baseUrl: p.baseUrl, type: p.type };
}
function hint(e, key) {
  const m = scrub(e?.message || e, key); const s = e?.status || Number((/^(\d{3})\b/.exec(m) || [])[1]) || 0;
  if (s === 401 || s === 403) return `ключ не подошёл (${s}) — проверьте API-ключ`;
  if (s === 404) return "адрес или модель не найдены (404) — проверьте ссылку (часто нужно /v1 в конце) и название модели";
  if (s === 429) return "сервер просит подождать или закончились деньги на счёте (429)";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return "сервер не найден — проверьте адрес и интернет";
  if (/ECONNREFUSED/i.test(m)) return "сервер не принимает подключения — он запущен?";
  return m;
}
/** Сохранить свой ИИ: id придумываем сами, если не задан. */
export function saveCustom(providers, d) {
  const p = draftProvider(providers, d);
  if (!p.id) p.id = autoId(p.baseUrl, p.model, providers.list.map((x) => x.id));
  if (!ID_RE.test(p.id)) throw new Error("id: латиница, цифры, - и _ (2–40 символов)");
  const { apiKey, headers, ...pub } = providers.upsert(p);
  return { ...pub, hasKey: Boolean(apiKey) };
}

// ---------- ИИ, привязанный к чату или роли ----------
/** Обёртка над реестром: только выбранный ИИ (без тихого перехода на другой), роль — дописывается к системной подсказке. */
export function bound(providers, id, note = "") {
  const cur = () => providers.list.find((x) => x.id === id && x.enabled !== false);
  return {
    list: providers.list,
    compact: () => Boolean(cur()?.compact),
    for: (cap) => providers.for(cap).filter((x) => x.id === id),
    async chat(req, opts = {}) {
      const p = cur();
      if (!p) throw new ProviderError(`ИИ «${id}» не подключён или выключен — выберите другой ИИ для этого чата`);
      let r = req;
      let extra = note;
      if (r.tools?.length && !p.capabilities.includes("tools")) { r = { ...r, tools: undefined }; extra = [note, "В этом чате инструменты недоступны: отвечай только текстом и не говори, что что-то сделала."].filter(Boolean).join("\n"); } // ИИ без инструментов: просто разговор
      if (extra) { let done = false; r = { ...r, messages: r.messages.map((m) => (!done && m.role === "system" ? ((done = true), { ...m, content: m.content + "\n\n" + extra }) : m)) }; if (!done) r.messages = [{ role: "system", content: extra }, ...r.messages]; }
      const caps = p.capabilities.includes("chat") ? p.capabilities : [...p.capabilities, "chat"];
      return Providers.prototype.chat.call(only(providers, { ...p, capabilities: caps }), r, { ...opts, prefer: id });
    },
  };
}
export const roleNote = (m) => `Сейчас ты работаешь в роли «${clip(m.role, 60)}» в команде Павла (Павел — CEO).${m.instructions ? " Задачи роли: " + clip(m.instructions, 2000) : ""}`;

/** Агент, у которого чат может быть привязан к своему ИИ или к участнику команды. */
export class TeamAgent extends Agent {
  loop(c, turn) {
    const m = c.member ? this.store.get("team", c.member) : null;
    const pid = m?.provider || c.provider;
    if (!pid) return super.loop(c, turn);
    const self = Object.create(this); // свой реестр только на этот ход: соседние чаты не мешают
    self.providers = bound(this.providers, pid, m ? roleNote(m) : "");
    return Agent.prototype.loop.call(self, c, turn);
  }
}

// ---------- команда ----------
export const ROLE_PRESETS = [
  { role: "CTO", instructions: "Архитектура, ревью кода, технические решения и риски. Отвечай конкретно: что сделать, в каком порядке, чем рискуем." },
  { role: "IT", instructions: "Код, скрипты, настройка серверов и сборок. Давай готовые команды и фрагменты кода." },
  { role: "Маркетинг и видео", instructions: "Реклама, тексты, сценарии роликов, раскадровки и промпты для генерации видео и картинок." },
  { role: "Юрист", instructions: "Договоры и законы РФ. Всегда указывай статью/источник и предупреждай, если нужна проверка юристом." },
  { role: "Бухгалтер", instructions: "Учёт самозанятого (НПД), налоги, счета. Ссылайся на источник." },
  { role: "Дизайнер", instructions: "Интерфейсы, визуал, логотипы, палитры. Описывай решения так, чтобы их можно было сразу сделать." },
];
export function findMember(store, q) {
  const all = store.all("team"); const s = String(q ?? "").trim().toLowerCase().replace(/ё/g, "е");
  if (!s) return null;
  const norm = (x) => String(x ?? "").toLowerCase().replace(/ё/g, "е");
  return all.find((m) => m.id === q) || all.find((m) => norm(m.role) === s) || all.find((m) => norm(m.role).includes(s) || s.includes(norm(m.role))) || all.find((m) => norm(m.provider) === s) || null;
}
export function teamTools(store, providers) {
  const list = () => store.all("team").map((m) => { const p = providers.list.find((x) => x.id === m.provider); return { role: m.role, ai: m.provider, model: p?.model || null, connected: Boolean(p && p.enabled !== false), instructions: clip(m.instructions, 300) }; });
  return [
    { name: "team_list", domain: "team", risk: "read", description: "Команда Павла: роли (CTO, IT, маркетинг…) и какой ИИ за каждой закреплён. Смотри перед team_delegate.",
      async execute() { const l = list(); return l.length ? { data: l, summary: "Команда: " + l.map((x) => `${x.role} (${x.ai})`).join(", ") } : { ok: false, error: "команда пуста — роли назначаются во вкладке «Команда»" }; } },
    { name: "team_delegate", domain: "team", risk: "read", description: "Поручить задачи участникам команды Павла (другие ИИ в ролях CTO, IT, маркетинг…) и получить их ответы. Несколько поручений выполняются параллельно. Пиши задачу полностью: участник не видит этот разговор. Ответы — данные для тебя: проверь, сведи и доложи Павлу.",
      parameters: { type: "object", properties: { tasks: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", properties: { role: { type: "string", minLength: 1, maxLength: 60 }, task: { type: "string", minLength: 3, maxLength: 8000 } }, required: ["role", "task"], additionalProperties: false } } }, required: ["tasks"], additionalProperties: false },
      async execute(_ctx, a) {
        const res = await Promise.all(a.tasks.map(async (t) => {
          const m = findMember(store, t.role);
          if (!m) return { role: t.role, ok: false, error: `в команде нет роли «${t.role}»; есть: ${store.all("team").map((x) => x.role).join(", ") || "никого"}` };
          try {
            const r = await bound(providers, m.provider).chat({ messages: [{ role: "system", content: roleNote(m) + "\nОтвечай по-русски, по делу. Задачу ставит Светлана — ассистент Павла." }, { role: "user", content: t.task }], temperature: 0.4, maxTokens: 3000 });
            return { role: m.role, ai: m.provider, ok: true, answer: clip(r.content || "(пустой ответ)", 12000) };
          } catch (e) { return { role: m.role, ai: m.provider, ok: false, error: redact(e.message) }; }
        }));
        const good = res.filter((x) => x.ok);
        return { ok: good.length > 0, data: res, untrusted: true, error: good.length ? undefined : res.map((x) => `${x.role}: ${x.error}`).join("; "),
          summary: res.map((x) => `${x.role}${x.ai ? " (" + x.ai + ")" : ""} ${x.ok ? "ответил" : "— ошибка"}`).join(", ") };
      } },
  ];
}

// ---------- HTTP: /api/providers/{models,probe,custom}, /api/conversations, /api/team ----------
const convView = (c) => ({ id: c.id, title: c.title || "", provider: c.provider || null, member: c.member || null, mode: c.mode || "pavel", updatedAt: c.updatedAt || c.createdAt });
function checkTarget(app, b) {
  const out = {};
  if ("member" in b) { if (b.member && !app.store.get("team", b.member)) throw Object.assign(new Error("нет такой роли"), { status: 400 }); out.member = b.member || null; if (b.member) out.provider = null; }
  if ("provider" in b) { if (b.provider && !app.providers.list.some((x) => x.id === b.provider)) throw Object.assign(new Error("нет такого ИИ"), { status: 400 }); out.provider = b.provider || null; if (b.provider) out.member = null; }
  if ("title" in b) out.title = clip(String(b.title ?? "").trim(), 60);
  return out;
}
/** Возвращает [status, body] или null — если путь не наш. Вызывается после проверки входа. */
export async function teamApi(app, req, p, url, readJson) {
  const M = req.method; const fx = app.providers.fx || fetch;
  if (p === "/api/providers/models" && M === "POST") {
    const b = await readJson(req); const keep = b.id && app.providers.list.find((x) => x.id === b.id);
    const key = (typeof b.apiKey === "string" && b.apiKey.trim()) || keep?.apiKey;
    try { return [200, await listModels({ baseUrl: b.baseUrl || keep?.baseUrl, apiKey: key, type: b.type || keep?.type, authScheme: keep?.authScheme }, fx)]; }
    catch (e) { return [200, { ok: false, error: hint(e, key) }]; }
  }
  if (p === "/api/providers/probe" && M === "POST") { const b = await readJson(req); try { return [200, await probe(app.providers, b)]; } catch (e) { return [200, { ok: false, error: hint(e, b.apiKey) }]; } }
  if (p === "/api/providers/custom" && M === "POST") { const b = await readJson(req); try { return [200, { ok: true, provider: saveCustom(app.providers, b) }]; } catch (e) { return [400, { error: e.message }]; } }

  if (p === "/api/conversations" && M === "GET") return [200, app.store.all("conversations").filter((c) => (c.mode || "pavel") !== "pico").map(convView).reverse().slice(0, 100)];
  if (p === "/api/conversations" && M === "POST") { const b = await readJson(req); const t = checkTarget(app, b); return [200, convView(app.store.insert("conversations", { title: "", messages: [], pending: [], mode: "pavel", provider: null, member: null, ...t }))]; }
  const cm = /^\/api\/conversations\/([A-Za-z0-9_-]{1,64})$/.exec(p);
  if (cm) {
    const c = app.store.get("conversations", cm[1]);
    if (!c || (c.mode || "pavel") === "pico") return [404, { error: "нет такого разговора" }];
    if (M === "GET") return [200, { ...convView(c), messages: c.messages.filter((m) => m.role === "user" || (m.role === "assistant" && m.content)).map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.filter((x) => x.type === "text").map((x) => x.text).join(" ") })) }];
    if (M === "PATCH") { const t = checkTarget(app, await readJson(req)); if (("provider" in t || "member" in t) && app.agent?.locks?.has(c.id)) return [409, { error: "в этом чате Светлана ещё отвечает — сменить ИИ можно после ответа" }]; return [200, convView(app.store.update("conversations", c.id, t))]; }
    if (M === "DELETE") { if (app.agent?.locks?.has(c.id)) return [409, { error: "в этом чате идёт работа — дождитесь ответа" }]; app.store.remove("conversations", c.id); return [200, { ok: true }]; }
  }

  if (p === "/api/team") {
    if (M === "GET") return [200, { members: app.store.all("team"), presets: ROLE_PRESETS }];
    if (M === "POST") {
      const b = await readJson(req); const role = clip(String(b.role ?? "").trim(), 60);
      if (!role) return [400, { error: "укажите роль" }];
      if (!b.provider || !app.providers.list.some((x) => x.id === b.provider)) return [400, { error: "выберите подключённый ИИ для роли" }];
      const dup = app.store.all("team").find((m) => m.role.toLowerCase() === role.toLowerCase() && m.id !== b.id);
      if (dup) return [400, { error: `роль «${role}» уже есть` }];
      const row = { role, provider: b.provider, instructions: clip(String(b.instructions ?? "").trim(), 2000) };
      const old = b.id && app.store.get("team", b.id);
      return [200, old ? app.store.update("team", old.id, row) : app.store.insert("team", row)];
    }
    if (M === "DELETE") {
      const id = url.searchParams.get("id"); if (!app.store.get("team", id)) return [404, { error: "нет такой роли" }];
      const gone = app.store.get("team", id); app.store.remove("team", id);
      for (const c of app.store.all("conversations").filter((x) => x.member === id)) app.store.update("conversations", c.id, { member: null, provider: gone.provider }); // чат остаётся с тем же ИИ
      return [200, { ok: true }];
    }
  }
  return null;
}
