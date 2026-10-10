// Интеграции: GitHub, Vercel, VK, YouTube и почта (Gmail, Mail.ru, Яндекс) — по токену/ключу или паролю приложения.
// Секреты лежат только в ядре (integrations.json, права 600), наружу отдаётся лишь «подключено, аккаунт такой-то».
// Работает и на телефоне (Node 18 без ICU): кодировки писем cp1251/koi8-r декодируем своими таблицами.
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";

const MAILS = {
  gmail: { title: "Gmail", imap: "imap.gmail.com", smtp: "smtp.gmail.com", how: "Google-аккаунт → Безопасность → двухэтапная проверка → «Пароли приложений» → создать. Почта Gmail → Настройки → «Пересылка и POP/IMAP» → включить IMAP.", link: "https://myaccount.google.com/apppasswords" },
  mailru: { title: "Почта Mail.ru", imap: "imap.mail.ru", smtp: "smtp.mail.ru", how: "Mail.ru → Настройки → Безопасность → «Пароли для внешних приложений» → создать (доступ: IMAP/SMTP).", link: "https://account.mail.ru/user/2-step-auth/passwords" },
  yandex: { title: "Яндекс Почта", imap: "imap.yandex.ru", smtp: "smtp.yandex.ru", how: "Яндекс ID → Безопасность → «Пароли приложений» → Почта. В почте: Настройки → Почтовые программы → разрешить IMAP.", link: "https://id.yandex.ru/security/app-passwords" },
};
export const CATALOG = [
  { id: "github", title: "GitHub", fields: [["token", "Токен (ghp_… или github_pat_…)", true]], how: "github.com → Settings → Developer settings → Personal access tokens → Generate (права: repo, workflow).", link: "https://github.com/settings/tokens" },
  { id: "vercel", title: "Vercel", fields: [["token", "Токен", true], ["teamId", "ID команды (если проекты в команде)", false]], how: "vercel.com → Account Settings → Tokens → Create.", link: "https://vercel.com/account/tokens" },
  { id: "vk", title: "ВКонтакте", fields: [["token", "Ключ доступа (сообщества или пользователя)", true]], how: "Сообщество → Управление → Работа с API → Ключи доступа → Создать ключ (стена, сообщения, фото).", link: "https://dev.vk.com/ru/api/access-token/getting-started" },
  { id: "youtube", title: "YouTube", fields: [["apiKey", "API-ключ (YouTube Data API v3)", true]], how: "console.cloud.google.com → APIs & Services → включить YouTube Data API v3 → Credentials → API key. Ключ даёт поиск и статистику; публикация видео — позже через вход Google.", link: "https://console.cloud.google.com/apis/library/youtube.googleapis.com" },
  ...Object.entries(MAILS).map(([id, m]) => ({ id, title: m.title, mail: true, fields: [["email", "Адрес почты", false], ["password", "Пароль приложения (не обычный пароль)", true]], how: m.how, link: m.link })),
];
const byId = (id) => CATALOG.find((c) => c.id === id);
const LIMIT = 30000;
const clip = (s) => (s.length > LIMIT ? s.slice(0, LIMIT) + "…[обрезано]" : s);

export class Integrations {
  constructor(file, { fetchImpl = fetch, connect = tls.connect, readyEvent = "secureConnect", workspace = "" } = {}) { this.file = file; this.fx = fetchImpl; this.connect = connect; this.readyEvent = readyEvent; this.workspace = workspace; this.mcpSessions = new Map(); this.data = {}; try { this.data = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch {} }
  save() { const t = this.file + ".tmp"; fs.writeFileSync(t, JSON.stringify(this.data, null, 1), { mode: 0o600 }); fs.renameSync(t, this.file); }
  get(id) { return this.data[id] || null; }
  mcpList() { return (this.data.mcp || []).map(({ token, ...m }) => ({ ...m, hasToken: !!token })); }
  public() { return CATALOG.map((c) => ({ id: c.id, title: c.title, mail: !!c.mail, how: c.how, link: c.link, fields: c.fields.map(([k, label, secret]) => ({ key: k, label, secret, value: secret ? undefined : this.data[c.id]?.[k] || "" })), connected: !!this.data[c.id], account: this.data[c.id]?.account || "", at: this.data[c.id]?.at || "" })); }
  async connectOne(id, fields) {
    const c = byId(id); if (!c) throw Object.assign(new Error("нет такой интеграции"), { status: 400 });
    const old = this.data[id] || {}; const v = {};
    for (const [k, , secret] of c.fields) { const x = String(fields?.[k] ?? "").trim().slice(0, 500); v[k] = x || (secret ? old[k] || "" : ""); }
    if (c.fields.some(([k, , s], i) => (s || c.mail || i === 0) && !v[k])) throw Object.assign(new Error("заполните поля"), { status: 400 });
    if (c.mail && !/^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(v.email)) throw Object.assign(new Error("адрес почты выглядит неправильно"), { status: 400 });
    if (Object.values(v).some((x) => /[\r\n\0]/.test(x))) throw Object.assign(new Error("переносы строк в полях недопустимы"), { status: 400 });
    const account = await this.check(id, v);
    this.data[id] = { ...v, account, at: new Date().toISOString() }; this.save();
    return { ok: true, account };
  }
  remove(id) { delete this.data[id]; this.save(); }
  /** Проверка доступа: возвращает имя аккаунта или бросает понятную ошибку. */
  async check(id, v = this.data[id]) {
    if (!v) throw new Error("не подключено");
    if (id === "github") { const j = await this.http("GET", "https://api.github.com/user", { headers: gh(v) }); return j.login; }
    if (id === "vercel") { const j = await this.http("GET", "https://api.vercel.com/v2/user", { headers: bearer(v.token) }); return j.user?.username || j.user?.email || "vercel"; }
    if (id === "vk") {
      const u = await this.vk(v, "users.get", {}).catch(() => null); if (Array.isArray(u) && u[0]) return `${u[0].first_name} ${u[0].last_name}`.trim();
      const g = await this.vk(v, "groups.getById", {}); const gr = Array.isArray(g) ? g[0] : g?.groups?.[0]; return gr ? "сообщество " + gr.name : "ВК";
    }
    if (id === "youtube") { await this.yt(v, "search", { part: "snippet", q: "svetlana", maxResults: 1, type: "video" }); return "YouTube Data API"; }
    if (MAILS[id]) { await this.imap(id, v, async (s) => { await s.cmd("SELECT INBOX"); }); return v.email; }
    throw new Error("неизвестно");
  }
  need(id) { const v = this.data[id]; if (!v) throw new Error(`${byId(id)?.title || id} не подключён — Светлана → вкладка «Интеграции»`); return v; }

  async http(method, url, { headers = {}, body, raw } = {}) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 45000);
    try {
      const r = await this.fx(url, { method, headers: { "User-Agent": "Svetlana", Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ac.signal });
      const text = (await r.text()).slice(0, 2_000_000);
      let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { text }; }
      if (!r.ok) throw Object.assign(new Error(`${r.status}: ${String(j.message || j.error?.message || j.error || text).slice(0, 300)}`), { http: r.status });
      return raw ? { status: r.status, j } : j;
    } catch (e) { if (e.name === "AbortError") throw new Error("сервис не ответил за 45 с"); throw e; } finally { clearTimeout(t); }
  }
  async vk(v, method, params) {
    const q = new URLSearchParams({ ...flat(params), access_token: v.token, v: "5.199" });
    const r = await this.fx("https://api.vk.com/method/" + method, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: q.toString() });
    const j = await r.json(); if (j.error) throw new Error(`ВК: ${j.error.error_msg || j.error.error_code}`); return j.response;
  }
  async yt(v, resource, params) { return this.http("GET", `https://www.googleapis.com/youtube/v3/${resource}?` + new URLSearchParams({ ...flat(params), key: v.apiKey })); }

  // ---------- почта: IMAP (чтение) и SMTP (отправка) по TLS ----------
  async imap(id, v, fn) {
    const s = await session(this.connect, this.readyEvent, MAILS[id].imap, 993);
    try {
      await s.greet();
      const r = await s.cmd(`LOGIN ${q(v.email)} ${q(v.password)}`);
      if (!r.ok) throw new Error("почта не пустила: проверьте адрес и пароль приложения (обычный пароль не подойдёт), и что IMAP включён");
      return await fn(s);
    } finally { s.close(); }
  }
  async smtp(id, v, { to, subject, text }) {
    const s = await session(this.connect, this.readyEvent, MAILS[id].smtp, 465);
    try {
      const exp = async (line, code) => { const r = await s.say(line); if (!String(r).startsWith(String(code))) throw new Error(`SMTP: ${String(r).slice(0, 200)}`); return r; };
      await exp(null, 220); await exp("EHLO svetlana", 250);
      await exp("AUTH PLAIN " + Buffer.from(`\0${v.email}\0${v.password}`).toString("base64"), 235);
      await exp(`MAIL FROM:<${v.email}>`, 250);
      for (const r of to) await exp(`RCPT TO:<${r}>`, 250);
      await exp("DATA", 354);
      const msg = [`From: ${v.email}`, `To: ${to.join(", ")}`, `Subject: ${encWord(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@svetlana>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", Buffer.from(text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n")].join("\r\n");
      await exp(msg + "\r\n.", 250); await s.say("QUIT").catch(() => {});
    } finally { s.close(); }
  }
}

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const gh = (v) => ({ ...bearer(v.token), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
const flat = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, x]) => x !== undefined && x !== null).map(([k, x]) => [k, typeof x === "object" ? JSON.stringify(x) : String(x)]));
const q = (s) => '"' + String(s).replace(/[\\"]/g, "\\$&").replace(/[\r\n]/g, "") + '"';
const encWord = (s) => { s = String(s).replace(/[\r\n]+/g, " "); return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s).toString("base64") + "?="; };

/** Простой построчный сеанс: IMAP-команды с тегами (учитываем литералы {N}) и SMTP-ответы. */
function session(connect, readyEvent, host, port) {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port, servername: host, timeout: 30000 });
    let buf = Buffer.alloc(0), wait = null, n = 0, done = false;
    const fail = (e) => { if (wait) { const w = wait; wait = null; w.reject(e); } else if (!done) reject(e); };
    sock.setTimeout?.(30000, () => { fail(new Error(`${host}: нет ответа`)); sock.destroy(); });
    sock.on("error", (e) => fail(new Error(`${host}: ${e.message}`)));
    const pump = () => { if (wait) { const r = wait.test(buf); if (r !== null) { const w = wait; wait = null; w.resolve(r); } } };
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (buf.length > 30_000_000) { fail(new Error("слишком большой ответ")); sock.destroy(); } pump(); });
    const until = (test) => new Promise((res, rej) => { wait = { test, resolve: res, reject: rej }; pump(); });
    sock.once(readyEvent, () => { done = true; resolve(api); });
    const api = {
      close: () => sock.destroy(),
      async greet() { return until(() => { const i = buf.indexOf("\r\n"); if (i < 0) return null; const l = buf.subarray(0, i).toString(); buf = buf.subarray(i + 2); return l; }); },
      cmd(c) {
        const tag = "A" + ++n; sock.write(`${tag} ${c}\r\n`);
        return until(() => {
          let p = 0;
          while (true) {
            const i = buf.indexOf("\r\n", p); if (i < 0) return null;
            const line = buf.subarray(p, i).toString("latin1");
            const m = /\{(\d+)\}$/.exec(line);
            if (m) { const end = i + 2 + Number(m[1]); if (buf.length < end) return null; p = end; continue; }
            if (line.startsWith(tag + " ")) { const out = buf.subarray(0, i + 2); buf = buf.subarray(i + 2); return { ok: /^\S+ OK/i.test(line), line, raw: out }; }
            p = i + 2;
          }
        });
      },
      say(line) {
        if (line !== null) sock.write(line + "\r\n");
        return until(() => { // многострочный ответ SMTP: 250-… / 250 …
          let p = 0; while (true) { const i = buf.indexOf("\r\n", p); if (i < 0) return null; const l = buf.subarray(p, i).toString(); p = i + 2; if (/^\d{3} /.test(l) || !/^\d{3}-/.test(l)) { const out = buf.subarray(0, p).toString(); buf = buf.subarray(p); return out.trim().split("\r\n").pop(); } }
        });
      },
    };
  });
}

// ---------- разбор писем ----------
const T1251 = "\u0402\u0403\u201a\u0453\u201e\u2026\u2020\u2021\u20ac\u2030\u0409\u2039\u040a\u040c\u040b\u040f\u0452\u2018\u2019\u201c\u201d\u2022\u2013\u2014\ufffd\u2122\u0459\u203a\u045a\u045c\u045b\u045f\u00a0\u040e\u045e\u0408\u00a4\u0490\u00a6\u00a7\u0401\u00a9\u0404\u00ab\u00ac\u00ad\u00ae\u0407\u00b0\u00b1\u0406\u0456\u0491\u00b5\u00b6\u00b7\u0451\u2116\u0454\u00bb\u0458\u0405\u0455\u0457\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041a\u041b\u041c\u041d\u041e\u041f\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042a\u042b\u042c\u042d\u042e\u042f\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u044f", TKOI = "\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c\u2580\u2584\u2588\u258c\u2590\u2591\u2592\u2593\u2320\u25a0\u2219\u221a\u2248\u2264\u2265\u00a0\u2321\u00b0\u00b2\u00b7\u00f7\u2550\u2551\u2552\u0451\u2553\u2554\u2555\u2556\u2557\u2558\u2559\u255a\u255b\u255c\u255d\u255e\u255f\u2560\u2561\u0401\u2562\u2563\u2564\u2565\u2566\u2567\u2568\u2569\u256a\u256b\u256c\u00a9\u044e\u0430\u0431\u0446\u0434\u0435\u0444\u0433\u0445\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f\u044f\u0440\u0441\u0442\u0443\u0436\u0432\u044c\u044b\u0437\u0448\u044d\u0449\u0447\u044a\u042e\u0410\u0411\u0426\u0414\u0415\u0424\u0413\u0425\u0418\u0419\u041a\u041b\u041c\u041d\u041e\u041f\u042f\u0420\u0421\u0422\u0423\u0416\u0412\u042c\u042b\u0417\u0428\u042d\u0429\u0427\u042a";
function decodeBytes(b, cs = "utf-8") {
  cs = String(cs).toLowerCase().replace(/["']/g, "");
  const tab = /1251/.test(cs) ? T1251 : /koi8/.test(cs) ? TKOI : null;
  if (tab) { let s = ""; for (const x of b) s += x < 128 ? String.fromCharCode(x) : tab[x - 128]; return s; }
  if (/8859-1|latin1|ascii/.test(cs)) return Buffer.from(b).toString("latin1");
  return Buffer.from(b).toString("utf8");
}
const qp = (s) => { const out = []; const t = s.replace(/=\r?\n/g, ""); for (let i = 0; i < t.length; i++) { if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.substr(i + 1, 2))) { out.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; } else out.push(t.charCodeAt(i) & 255); } return Buffer.from(out); };
export function decodeWords(s) {
  s = String(s || ""); if (/[\x80-\xff]/.test(s) && !/[^\x00-\xff]/.test(s)) s = Buffer.from(s, "latin1").toString("utf8"); // заголовок без кодирования, сразу в UTF-8
  return s.replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs, e, d) => decodeBytes(e.toLowerCase() === "b" ? Buffer.from(d, "base64") : qp(d.replace(/_/g, " ")), cs));
}
function headers(raw) {
  const h = {}; const lines = raw.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  for (const l of lines) { const i = l.indexOf(":"); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = l.slice(i + 1).trim(); } }
  return h;
}
const param = (v, k) => (new RegExp(`${k}\\s*=\\s*"?([^";]+)"?`, "i").exec(v || "") || [])[1];
/** Письмо (сырые байты) → { from, to, subject, date, text, attachments }. */
export function parseMail(buf) {
  const s = buf.toString("latin1"); const cut = s.search(/\r?\n\r?\n/);
  const h = headers(cut < 0 ? s : s.slice(0, cut)); const body = cut < 0 ? "" : s.slice(cut).replace(/^\r?\n\r?\n/, "");
  const att = []; let plain = "", html = "";
  (function walk(hh, b, depth) {
    const ct = hh["content-type"] || "text/plain"; const bd = param(ct, "boundary");
    if (/^multipart\//i.test(ct) && bd && depth < 6) {
      for (const part of b.split("--" + bd).slice(1)) { if (part.startsWith("--")) break; const c = part.search(/\r?\n\r?\n/); if (c < 0) continue; walk(headers(part.slice(0, c)), part.slice(c).replace(/^\r?\n\r?\n/, ""), depth + 1); }
      return;
    }
    const enc = (hh["content-transfer-encoding"] || "").toLowerCase();
    const bytes = enc === "base64" ? Buffer.from(b.replace(/\s+/g, ""), "base64") : enc === "quoted-printable" ? qp(b) : Buffer.from(b, "latin1");
    const name = decodeWords(param(hh["content-disposition"], "filename") || param(ct, "name") || "");
    if (name || /attachment/i.test(hh["content-disposition"] || "")) { att.push({ name: name || "файл", size: bytes.length, type: ct.split(";")[0] }); return; }
    const txt = decodeBytes(bytes, param(ct, "charset") || "utf-8");
    if (/text\/html/i.test(ct)) html += txt; else if (/text\//i.test(ct)) plain += txt;
  })(h, body, 0);
  const text = plain.trim() || html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { from: decodeWords(h.from), to: decodeWords(h.to), subject: decodeWords(h.subject), date: h.date || "", text: clip(text), attachments: att };
}

// ---------- инструменты для Светланы ----------
const API_PATH = { type: "string", minLength: 1, maxLength: 500, pattern: "^/[A-Za-z0-9_.~%/?=&,:+@!$*()-]*$" };
const safePath = (p) => { if (!/^\/[A-Za-z0-9_.~%/?=&,:+@!$*()-]*$/.test(p) || p.includes("..") || p.startsWith("//")) throw new Error("путь API: только вида /repos/владелец/репо/…"); return p; };
const mailIds = Object.keys(MAILS);
const ACC = { type: "string", enum: mailIds, description: "почта: gmail | mailru | yandex" };
const pickMail = (I, a) => { const id = a.account || mailIds.find((m) => I.get(m)); if (!id) throw new Error("почта не подключена — Светлана → вкладка «Интеграции»"); return id; };
/** Большие ответы API обрезаем: модели хватит начала, а память телефона не резиновая. */
const cap = (d) => { const t = JSON.stringify(d ?? null); return t.length <= LIMIT ? d : { truncated: true, text: clip(t) }; };
const ok = (data, summary) => ({ data: cap(data), summary, untrusted: true });
const vercelUrl = (v, p) => { const u = "https://api.vercel.com" + safePath(p); return v.teamId ? u + (u.includes("?") ? "&" : "?") + "teamId=" + encodeURIComponent(v.teamId) : u; };
/** Значения переменных окружения (ключи, пароли) модели не показываем — только имена. */
const redactEnv = (d) => JSON.parse(JSON.stringify(d ?? null, (k, x) => (k === "value" && typeof x === "string" ? "•••" : k === "decrypted" ? undefined : x)));
const VK_READ = /^[a-z]+\.(get|search|is|check|resolve)[A-Za-z]*$/;

export function integrationTools(I) {
  const run = (f) => async (_c, a) => { try { return await f(a); } catch (e) { return { ok: false, error: e.message }; } };
  return [
    { name: "github_read", domain: "github", risk: "read", taints: true, description: "GitHub (вкладка «Интеграции»): прочитать через REST API — GET path, напр. /user/repos, /repos/{owner}/{repo}/issues, /repos/{owner}/{repo}/contents/{path}, /repos/{owner}/{repo}/actions/runs.",
      parameters: { type: "object", properties: { path: API_PATH }, required: ["path"], additionalProperties: false },
      execute: run(async (a) => ok(await I.http("GET", "https://api.github.com" + safePath(a.path), { headers: gh(I.need("github")) }), "GitHub ответил")) },
    { name: "github_write", domain: "github", risk: "external", taints: true, description: "GitHub: изменить — POST/PATCH/PUT/DELETE path с JSON-телом (создать issue, PR, файл, комментарий, запустить workflow). Каждое действие подтверждает владелец.",
      parameters: { type: "object", properties: { method: { type: "string", enum: ["POST", "PATCH", "PUT", "DELETE"] }, path: API_PATH, body: { type: "object" } }, required: ["method", "path"], additionalProperties: false },
      execute: run(async (a) => ok(await I.http(a.method, "https://api.github.com" + safePath(a.path), { headers: gh(I.need("github")), body: a.body }), `GitHub: ${a.method} выполнен`)) },
    { name: "vercel_read", domain: "vercel", risk: "read", taints: true, description: "Vercel: прочитать (GET) — /v9/projects, /v6/deployments?projectId=…, /v13/deployments/{id}, /v2/deployments/{id}/events (логи сборки).",
      parameters: { type: "object", properties: { path: API_PATH }, required: ["path"], additionalProperties: false },
      execute: run(async (a) => { const v = I.need("vercel"); return ok(redactEnv(await I.http("GET", vercelUrl(v, a.path), { headers: bearer(v.token) })), "Vercel ответил"); }) },
    { name: "vercel_write", domain: "vercel", risk: "external", taints: true, description: "Vercel: изменить (POST/PATCH/DELETE) — новый деплой /v13/deployments, переменные /v10/projects/{id}/env, домены. Подтверждает владелец.",
      parameters: { type: "object", properties: { method: { type: "string", enum: ["POST", "PATCH", "DELETE"] }, path: API_PATH, body: { type: "object" } }, required: ["method", "path"], additionalProperties: false },
      execute: run(async (a) => { const v = I.need("vercel"); return ok(await I.http(a.method, vercelUrl(v, a.path), { headers: bearer(v.token), body: a.body }), `Vercel: ${a.method} выполнен`); }) },
    { name: "vk_read", domain: "vk", risk: "read", taints: true, description: "ВКонтакте: метод API для чтения (wall.get, groups.getById, messages.getConversations, stats.get, users.get…) с параметрами.",
      parameters: { type: "object", properties: { method: { type: "string", maxLength: 60, pattern: "^[a-z]+\\.[A-Za-z]+$" }, params: { type: "object" } }, required: ["method"], additionalProperties: false },
      execute: run(async (a) => { if (!VK_READ.test(a.method)) throw new Error("это не чтение — используйте vk_write"); return ok(await I.vk(I.need("vk"), a.method, a.params), `ВК: ${a.method}`); }) },
    { name: "vk_write", domain: "vk", risk: "external", taints: true, description: "ВКонтакте: действие (wall.post — пост, messages.send — сообщение, wall.createComment…). Подтверждает владелец.",
      parameters: { type: "object", properties: { method: { type: "string", maxLength: 60, pattern: "^[a-z]+\\.[A-Za-z]+$" }, params: { type: "object" } }, required: ["method"], additionalProperties: false },
      execute: run(async (a) => ok(await I.vk(I.need("vk"), a.method, a.params), `ВК: ${a.method} выполнен`)) },
    { name: "youtube_read", domain: "youtube", risk: "read", taints: true, description: "YouTube: поиск и статистика (resource: search | videos | channels | playlists | playlistItems | commentThreads; params как в YouTube Data API v3, part обязателен).",
      parameters: { type: "object", properties: { resource: { type: "string", enum: ["search", "videos", "channels", "playlists", "playlistItems", "commentThreads"] }, params: { type: "object" } }, required: ["resource"], additionalProperties: false },
      execute: run(async (a) => ok(await I.yt(I.need("youtube"), a.resource, { part: "snippet", maxResults: 10, ...(a.params || {}) }), `YouTube: ${a.resource}`)) },
    { name: "mail_list", domain: "mail", risk: "read", taints: true, description: "Почта (Gmail, Mail.ru, Яндекс): последние письма во «Входящих» — от кого, тема, дата, uid. Можно только непрочитанные или поиск по отправителю/теме.",
      parameters: { type: "object", properties: { account: ACC, unread: { type: "boolean" }, from: { type: "string", maxLength: 200 }, subject: { type: "string", maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
      execute: run(async (a) => { const id = pickMail(I, a); const list = await I.imap(id, I.need(id), (s) => listMail(s, a)); return ok(list, `${MAILS[id].title}: писем ${list.length}`); }) },
    { name: "mail_read", domain: "mail", risk: "read", taints: true, description: "Почта: прочитать письмо по uid (из mail_list) — текст и список вложений. Письмо остаётся непрочитанным.",
      parameters: { type: "object", properties: { account: ACC, uid: { type: "integer", minimum: 1 } }, required: ["uid"], additionalProperties: false },
      execute: run(async (a) => { const id = pickMail(I, a); const m = await I.imap(id, I.need(id), (s) => readMail(s, a.uid)); return ok(m, `письмо «${m.subject}»`); }) },
    { name: "mail_send", domain: "mail", risk: "external", taints: false, description: "Почта: отправить письмо (кому — до 20 адресов, тема, текст) с подключённого ящика. Подтверждает владелец.",
      parameters: { type: "object", properties: { account: ACC, to: { type: "array", items: { type: "string", maxLength: 200, pattern: "^[^\\s@<>,]+@[^\\s@<>,]+$" }, maxItems: 20 }, subject: { type: "string", maxLength: 300 }, text: { type: "string", maxLength: 100000 } }, required: ["to", "subject", "text"], additionalProperties: false },
      execute: run(async (a) => { if (!a.to.length) throw new Error("нужен хотя бы один адрес"); const id = pickMail(I, a); await I.smtp(id, I.need(id), a); return { data: { to: a.to }, summary: `отправлено: ${a.to.join(", ")}` }; }) },
  ];
}

async function listMail(s, a) {
  const sel = await s.cmd("EXAMINE INBOX"); if (!sel.ok) throw new Error("не открылась папка «Входящие»");
  const crit = [a.unread ? "UNSEEN" : "ALL", a.from ? `FROM ${q(a.from)}` : "", a.subject ? `SUBJECT ${q(a.subject)}` : ""].filter(Boolean).join(" ");
  const r = await s.cmd(/[^\x00-\x7f]/.test(crit) ? `UID SEARCH CHARSET UTF-8 ${crit}` : `UID SEARCH ${crit}`);
  const ids = ((/\* SEARCH([\d ]*)/i.exec(r.raw.toString("latin1")) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number).slice(-(a.limit || 15));
  if (!ids.length) return [];
  const f = await s.cmd(`UID FETCH ${ids.join(",")} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
  return splitFetch(f.raw).map(({ meta, lit }) => { const h = headers(lit.toString("latin1")); return { uid: Number((/UID (\d+)/.exec(meta) || [])[1]), unread: !/\\Seen/.test(meta), from: decodeWords(h.from), subject: decodeWords(h.subject), date: h.date || "", size: Number((/RFC822\.SIZE (\d+)/.exec(meta) || [])[1]) }; }).filter((m) => m.uid).reverse();
}
async function readMail(s, uid) {
  await s.cmd("EXAMINE INBOX");
  const f = await s.cmd(`UID FETCH ${uid} (UID BODY.PEEK[])`);
  const one = splitFetch(f.raw)[0]; if (!one) throw new Error("письмо не найдено");
  return { uid, ...parseMail(one.lit.subarray(0, 25_000_000)) };
}
/** «* N FETCH (… {len}\r\n<байты> …)» → [{meta, lit}] */
function splitFetch(raw) {
  const out = []; let p = 0; const s = raw.toString("latin1");
  while (true) {
    const i = s.indexOf("* ", p); if (i < 0) break; const lb = s.indexOf("{", i); const nl = s.indexOf("\r\n", i);
    if (lb < 0 || nl < 0 || lb > nl) { p = nl < 0 ? s.length : nl + 2; continue; }
    const len = Number(s.slice(lb + 1, s.indexOf("}", lb))); const start = nl + 2;
    const rest = s.slice(start + len, s.indexOf("\r\n", start + len) + 2);
    out.push({ meta: s.slice(i, lb) + rest, lit: raw.subarray(start, start + len) }); p = start + len;
  }
  return out;
}

/** [status, body] или null — /api/integrations… (после проверки входа). */
export async function integrationsApi(app, req, p, url, readJson) {
  const I = app.integrations; if (!I || !p.startsWith("/api/integrations")) return null;
  if (p === "/api/integrations" && req.method === "GET") return [200, I.public()];
  if (p === "/api/integrations/mcp" && req.method === "GET") return [200, I.mcpList()];
  if (p === "/api/integrations/mcp" && req.method === "POST") { const b = await readJson(req); try { return [200, { ok: true, server: await I.mcpAdd(b) }]; } catch (e) { return [200, { ok: false, error: e.message }]; } }
  if (p === "/api/integrations/mcp" && req.method === "DELETE") { I.mcpRemove(String(url.searchParams.get("id") || "")); return [200, { ok: true }]; }
  if (p === "/api/integrations" && req.method === "POST") { const b = await readJson(req); try { return [200, await I.connectOne(String(b.id || ""), b.fields || {})]; } catch (e) { return [e.status || 200, { ok: false, error: e.message }]; } }
  if (p === "/api/integrations/test" && req.method === "POST") { const b = await readJson(req); try { return [200, { ok: true, account: await I.check(String(b.id || "")) }]; } catch (e) { return [200, { ok: false, error: e.message }]; } }
  if (p === "/api/integrations" && req.method === "DELETE") { I.remove(String(url.searchParams.get("id") || "")); return [200, { ok: true }]; }
  return null;
}
export function createIntegrations(cfg, opts = {}) { return new Integrations(path.join(cfg.dataDir, "integrations.json"), { workspace: cfg.workspace, ...opts }); }

// ---------- MCP: любые серверы инструментов (как коннекторы у Claude/ChatGPT) ----------
// Транспорт «Streamable HTTP» (JSON-RPC 2.0 через POST; ответ — JSON или поток SSE). Вход — заголовок Authorization: Bearer <токен>.
const MCP_VER = "2025-06-18";
Integrations.prototype.mcpRpc = async function (srv, method, params, { notify = false } = {}) {
  const sess = this.mcpSessions.get(srv.id);
  const id = notify ? undefined : Math.floor(Math.random() * 1e9);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 120000);
  try {
    const r = await this.fx(srv.url, { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": MCP_VER, ...(srv.token ? { Authorization: `Bearer ${srv.token}` } : {}), ...(sess ? { "Mcp-Session-Id": sess } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }) });
    const sid = r.headers?.get?.("mcp-session-id"); if (sid) this.mcpSessions.set(srv.id, sid);
    if (notify) return null;
    if (r.status === 401 || r.status === 403) throw new Error(`MCP «${srv.name}»: нет доступа (${r.status}) — проверьте токен`);
    if (r.status === 404 && sess) { this.mcpSessions.delete(srv.id); throw Object.assign(new Error("сеанс MCP истёк"), { retry: true }); }
    const text = (await r.text()).slice(0, 5_000_000);
    if (!r.ok) throw new Error(`MCP «${srv.name}»: ${r.status} ${text.slice(0, 200)}`);
    let msg = null;
    if (/text\/event-stream/.test(r.headers?.get?.("content-type") || "")) {
      for (const ev of text.split(/\r?\n\r?\n/)) { const d = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"); if (!d) continue; try { const j = JSON.parse(d); if (j.id === id) { msg = j; break; } } catch {} }
    } else { try { msg = JSON.parse(text); } catch {} if (Array.isArray(msg)) msg = msg.find((m) => m.id === id) || null; }
    if (!msg) throw new Error(`MCP «${srv.name}»: непонятный ответ`);
    if (msg.error) throw new Error(`MCP «${srv.name}»: ${msg.error.message || msg.error.code}`);
    return msg.result;
  } catch (e) { if (e.name === "AbortError") throw new Error(`MCP «${srv.name}» не ответил за 2 минуты`); throw e; } finally { clearTimeout(t); }
};
Integrations.prototype.mcpOpen = async function (srv) {
  if (this.mcpSessions.has(srv.id + ":ok")) return;
  const init = await this.mcpRpc(srv, "initialize", { protocolVersion: MCP_VER, capabilities: {}, clientInfo: { name: "svetlana", version: "2.1" } });
  await this.mcpRpc(srv, "notifications/initialized", undefined, { notify: true }).catch(() => {});
  this.mcpSessions.set(srv.id + ":ok", "1"); return init;
};
Integrations.prototype.mcp = async function (srv, method, params) {
  for (let i = 0; i < 2; i++) {
    try { await this.mcpOpen(srv); return await this.mcpRpc(srv, method, params); }
    catch (e) { if (!e.retry || i) throw e; this.mcpSessions.delete(srv.id + ":ok"); }
  }
};
Integrations.prototype.mcpTools = async function (srv) {
  const out = []; let cursor;
  for (let i = 0; i < 10; i++) { const r = await this.mcp(srv, "tools/list", cursor ? { cursor } : {}); out.push(...(r?.tools || [])); cursor = r?.nextCursor; if (!cursor) break; }
  return out;
};
Integrations.prototype.mcpAdd = async function ({ name, url, token }) {
  const u = new URL(String(url || "").trim()); if (!/^https?:$/.test(u.protocol)) throw new Error("адрес MCP: http(s)://…");
  if (u.username || u.password) throw new Error("ключ в адресе не пишите — для него есть поле «Токен»");
  const list = this.data.mcp || [];
  const nm = String(name || u.hostname).trim().slice(0, 40) || u.hostname;
  const base = nm.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "mcp";
  const old = list.find((m) => m.url === u.href);
  let id = old?.id || base; for (let i = 2; !old && list.some((m) => m.id === id); i++) id = base + "_" + i;
  const srv = { id, name: nm, url: u.href, token: String(token || "").trim() || old?.token || "" };
  this.mcpSessions.delete(id); this.mcpSessions.delete(id + ":ok");
  const tools = await this.mcpTools(srv);
  const row = { ...srv, tools: tools.length, at: new Date().toISOString() };
  this.data.mcp = [...list.filter((m) => m.id !== id), row]; this.save();
  const { token: _t, ...pub } = row; return { ...pub, hasToken: !!row.token, sample: tools.slice(0, 8).map((t) => t.name) };
};
Integrations.prototype.mcpRemove = function (id) { this.data.mcp = (this.data.mcp || []).filter((m) => m.id !== id); this.mcpSessions.delete(id); this.mcpSessions.delete(id + ":ok"); this.save(); };
Integrations.prototype.mcpServer = function (id) {
  const all = this.data.mcp || []; if (!all.length) throw new Error("MCP-серверы не подключены — Светлана → «Интеграции» → MCP");
  const s = all.find((m) => m.id === id) || (all.length === 1 && !id ? all[0] : null); if (!s) throw new Error(`нет MCP-сервера «${id}». Есть: ${all.map((m) => m.id).join(", ")}`); return s;
};
const mcpText = (r) => { const parts = (r?.content || []).map((c) => (c.type === "text" ? c.text : c.type === "resource" ? c.resource?.text || c.resource?.uri : `[${c.type}]`)); return { text: clip(parts.join("\n")), structured: r?.structuredContent, isError: !!r?.isError }; };

// ---------- GitHub: пуш файлов одним коммитом, Vercel: деплой папки проекта ----------
function workspaceFiles(root, dir, { max = 800, maxBytes = 40_000_000 } = {}) {
  if (!root) throw new Error("рабочая папка проектов не задана");
  const base = path.resolve(root); const start = path.resolve(base, dir || ".");
  if (start !== base && !start.startsWith(base + path.sep)) throw new Error("папка вне рабочей папки проектов");
  const real = fs.realpathSync(base); let rs; try { rs = fs.realpathSync(start); } catch { throw new Error("нет такой папки"); }
  if (rs !== real && !rs.startsWith(real + path.sep)) throw new Error("папка вне рабочей папки проектов");
  const out = []; let bytes = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue; // ссылки наружу не идём
      if (/^(\.git|node_modules|\.vercel|\.next|dist-cache)$/.test(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (e.isFile()) { const st = fs.statSync(f); bytes += st.size; if (out.length >= max || bytes > maxBytes) throw new Error(`слишком много файлов (до ${max} и ${maxBytes / 1e6} МБ)`); out.push({ rel: path.relative(start, f).split(path.sep).join("/"), abs: f }); }
    }
  })(rs);
  return out.map((f) => ({ ...f, rel: path.relative(rs, f.abs).split(path.sep).join("/") }));
}
Integrations.prototype.githubPush = async function ({ repo, branch, message, files = [], dir, base }) {
  const v = this.need("github"); const H = { headers: gh(v) }; const A = "https://api.github.com/repos/" + repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repo: владелец/название");
  const list = [...files.map((f) => ({ path: f.path, content: Buffer.from(f.content, "utf8") })), ...(dir !== undefined ? workspaceFiles(this.workspace, dir).map((f) => ({ path: (f.rel), content: fs.readFileSync(f.abs) })) : [])];
  if (!list.length) throw new Error("нечего отправлять: files или dir");
  for (const f of list) if (!/^[^/][^\0]*$/.test(f.path) || f.path.split("/").includes("..")) throw new Error("плохой путь файла " + f.path);
  const repoInfo = await this.http("GET", A, H); const br = branch || repoInfo.default_branch;
  let head = await this.http("GET", `${A}/git/ref/heads/${encodeURIComponent(br)}`, H).catch((e) => (e.http === 404 ? null : Promise.reject(e)));
  let created = false;
  if (!head) { const from = await this.http("GET", `${A}/git/ref/heads/${encodeURIComponent(base || repoInfo.default_branch)}`, H); head = await this.http("POST", `${A}/git/refs`, { ...H, body: { ref: "refs/heads/" + br, sha: from.object.sha } }); created = true; }
  const parent = await this.http("GET", `${A}/git/commits/${head.object.sha}`, H);
  const tree = [];
  for (const f of list) { const b = await this.http("POST", `${A}/git/blobs`, { ...H, body: { content: f.content.toString("base64"), encoding: "base64" } }); tree.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha }); }
  const t = await this.http("POST", `${A}/git/trees`, { ...H, body: { base_tree: parent.tree.sha, tree } });
  const c = await this.http("POST", `${A}/git/commits`, { ...H, body: { message, tree: t.sha, parents: [parent.sha] } });
  await this.http("PATCH", `${A}/git/refs/heads/${encodeURIComponent(br)}`, { ...H, body: { sha: c.sha } });
  return { branch: br, createdBranch: created, commit: c.sha, files: list.length, url: c.html_url || `https://github.com/${repo}/commit/${c.sha}` };
};
Integrations.prototype.vercelDeploy = async function ({ name, dir, repo, ref, target = "preview" }) {
  const v = this.need("vercel"); if (!repo && dir === undefined) throw new Error("нужна папка проекта (dir) или репозиторий (repo)"); const body = { name, ...(target === "production" ? { target: "production" } : {}) };
  if (repo) { const info = await this.http("GET", "https://api.github.com/repos/" + repo, { headers: this.get("github") ? gh(this.get("github")) : {} }).catch(() => null); body.gitSource = { type: "github", repo: repo.split("/")[1], org: repo.split("/")[0], ref: ref || info?.default_branch || "main", ...(info?.id ? { repoId: info.id } : {}) }; }
  else { const fl = workspaceFiles(this.workspace, dir || "."); if (!fl.length) throw new Error("папка пустая"); body.files = fl.map((f) => ({ file: f.rel, data: fs.readFileSync(f.abs).toString("base64"), encoding: "base64" })); body.projectSettings = { framework: null }; }
  const d = await this.http("POST", vercelUrl(v, "/v13/deployments?skipAutoDetectionConfirmation=1"), { headers: bearer(v.token), body });
  return { id: d.id, url: d.url ? "https://" + d.url : "", state: d.readyState || d.status, inspector: d.inspectorUrl };
};

export function moreTools(I) {
  const run = (f) => async (_c, a) => { try { return await f(a); } catch (e) { return { ok: false, error: e.message }; } };
  const repoP = { type: "string", maxLength: 140, pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", description: "владелец/репозиторий" };
  return [
    { name: "github_push", domain: "github", risk: "external", taints: false, description: "GitHub: запушить файлы одним коммитом в ветку (нет ветки — создаст от base или основной). files — содержимое прямо здесь, или dir — папка проекта из рабочей папки (code_*), целиком.",
      parameters: { type: "object", properties: { repo: repoP, branch: { type: "string", maxLength: 100, pattern: "^[A-Za-z0-9._/-]+$" }, base: { type: "string", maxLength: 100, pattern: "^[A-Za-z0-9._/-]+$" }, message: { type: "string", minLength: 1, maxLength: 500 }, files: { type: "array", maxItems: 200, items: { type: "object", properties: { path: { type: "string", minLength: 1, maxLength: 300 }, content: { type: "string", maxLength: 2000000 } }, required: ["path", "content"], additionalProperties: false } }, dir: { type: "string", maxLength: 300 } }, required: ["repo", "message"], additionalProperties: false },
      execute: run(async (a) => { const r = await I.githubPush(a); return { data: r, summary: `GitHub: ${r.files} файл(ов) → ${a.repo}@${r.branch}`, verification: r.url }; }) },
    { name: "github_run", domain: "github", risk: "external", taints: false, description: "GitHub Actions: запустить workflow (файл .yml или id) на ветке с inputs. Статус потом — github_read /repos/{repo}/actions/runs.",
      parameters: { type: "object", properties: { repo: repoP, workflow: { type: "string", maxLength: 120, pattern: "^[A-Za-z0-9_.-]+$" }, ref: { type: "string", maxLength: 100 }, inputs: { type: "object" } }, required: ["repo", "workflow"], additionalProperties: false },
      execute: run(async (a) => { const v = I.need("github"); const ref = a.ref || (await I.http("GET", "https://api.github.com/repos/" + a.repo, { headers: gh(v) })).default_branch; await I.http("POST", `https://api.github.com/repos/${a.repo}/actions/workflows/${encodeURIComponent(a.workflow)}/dispatches`, { headers: gh(v), body: { ref, inputs: a.inputs || {} } }); return { data: { repo: a.repo, workflow: a.workflow, ref }, summary: `запущен ${a.workflow} на ${ref}`, verification: `https://github.com/${a.repo}/actions` }; }) },
    { name: "vercel_deploy", domain: "vercel", risk: "external", taints: false, description: "Vercel: задеплоить — папку проекта из рабочей папки (dir) или репозиторий GitHub (repo + ref). target: preview (по умолчанию) или production. Статус — vercel_read /v13/deployments/{id}.",
      parameters: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9._-]+$" }, dir: { type: "string", maxLength: 300 }, repo: repoP, ref: { type: "string", maxLength: 100 }, target: { type: "string", enum: ["preview", "production"] } }, required: ["name"], additionalProperties: false },
      execute: run(async (a) => { const r = await I.vercelDeploy(a); return { data: r, summary: `Vercel: деплой ${r.state || "запущен"} ${r.url}`, verification: r.inspector || r.url }; }) },
    { name: "mcp_tools", domain: "mcp", risk: "read", taints: true, description: "MCP-серверы (вкладка «Интеграции» → MCP): какие инструменты есть у подключённых серверов (server — id; пусто — все).",
      parameters: { type: "object", properties: { server: { type: "string", maxLength: 40 } }, additionalProperties: false },
      execute: run(async (a) => { const list = a.server ? [I.mcpServer(a.server)] : I.data.mcp || []; if (!list.length) throw new Error("MCP-серверы не подключены"); const out = []; for (const s of list) { const t = await I.mcpTools(s); out.push({ server: s.id, name: s.name, tools: t.map((x) => ({ name: x.name, description: String(x.description || "").slice(0, 300), inputSchema: x.inputSchema })) }); } return ok(out, `MCP: ${out.map((o) => `${o.server} (${o.tools.length})`).join(", ")}`); }) },
    { name: "mcp_call", domain: "mcp", risk: "external", taints: true, description: "MCP: вызвать любой инструмент подключённого сервера (имя и аргументы — из mcp_tools). Подтверждает владелец.",
      parameters: { type: "object", properties: { server: { type: "string", maxLength: 40 }, name: { type: "string", minLength: 1, maxLength: 128 }, args: { type: "object" } }, required: ["name"], additionalProperties: false },
      execute: run(async (a) => { const s = I.mcpServer(a.server); const r = mcpText(await I.mcp(s, "tools/call", { name: a.name, arguments: a.args || {} })); return { ok: !r.isError, data: r, summary: `${s.name}: ${a.name}${r.isError ? " — ошибка" : ""}`, untrusted: true }; }) },
  ];
}
