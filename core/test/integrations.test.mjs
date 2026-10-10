// Интеграции: GitHub (чтение, пуш, запуск workflow), Vercel (деплой папки), почта IMAP/SMTP, MCP-серверы, вкладка API.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createApp } from "../lib/app.mjs";
import { createServer } from "../server.mjs";
import { parseMail, decodeWords } from "../lib/integrations.mjs";
import { pickTools } from "../lib/toolpick.mjs";
import { tmp, cfgFor } from "./helpers.mjs";

const J = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
/** Поддельный интернет: (method, url, body, headers) → Response. Все запросы пишутся в seen. */
const web = (fn, seen = []) => async (url, init = {}) => { let body = init.body; try { body = body ? JSON.parse(body) : body; } catch {} seen.push({ url: String(url), method: init.method || "GET", body, headers: init.headers || {} }); return fn(init.method || "GET", String(url), body, init.headers || {}); };
async function boot(fx, extra = {}) {
  const d = tmp(); const app = createApp(cfgFor(d), { fetchImpl: fx, ...extra });
  const srv = createServer(app); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "test-admin-token-123456" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const req = async (method, p, b) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.json(); };
  const raw = async (method, p, data) => (await fetch(base + p, { method, headers: { "content-type": "application/octet-stream", cookie }, body: data })).json();
  return { app, dir: d, raw, get: (p) => req("GET", p), post: (p, b) => req("POST", p, b), del: (p) => req("DELETE", p), tool: (n, a) => app.registry.get(n).execute({}, a), close: () => srv.close() };
}

test("интеграции: подключение GitHub проверяет токен, ключ наружу не отдаётся, файл с ключами закрыт", async () => {
  const s = await boot(web((m, u, b, h) => u === "https://api.github.com/user" ? (h.Authorization === "Bearer ghp_good" ? J({ login: "paulafanasyev" }) : J({ message: "Bad credentials" }, 401)) : J({}, 404)));
  try {
    const all = await s.get("/api/integrations");
    assert.deepEqual(all.map((x) => x.id), ["github", "vercel", "vk", "youtube", "gmail", "mailru", "yandex"]);
    const bad = await s.post("/api/integrations", { id: "github", fields: { token: "ghp_bad" } });
    assert.equal(bad.ok, false); assert.match(bad.error, /401/);
    const r = await s.post("/api/integrations", { id: "github", fields: { token: "ghp_good" } });
    assert.equal(r.ok, true); assert.equal(r.account, "paulafanasyev");
    const pub = JSON.stringify(await s.get("/api/integrations")); assert.ok(!pub.includes("ghp_good"), "токен не уходит в браузер");
    const f = path.join(s.dir, "integrations.json"); if (process.platform !== "win32") assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.equal((await s.post("/api/integrations/test", { id: "github" })).ok, true);
    assert.equal((await s.post("/api/integrations", { id: "github", fields: { token: "" } })).ok, true, "пустое поле = оставить сохранённый ключ");
    const none = await s.tool("vercel_read", { path: "/v9/projects" }); assert.equal(none.ok, false); assert.match(none.error, /Интеграции/);
    assert.equal(s.app.registry.get("github_write").risk, "external", "изменения в GitHub — только с подтверждением");
    assert.equal((await s.tool("github_read", { path: "/../user" })).ok, false);
  } finally { s.close(); }
});

test("GitHub: пуш папки проекта одним коммитом в новую ветку и запуск workflow", async () => {
  const seen = [];
  const s = await boot(web((m, u, b) => {
    const A = "https://api.github.com/repos/paul/site";
    if (u === "https://api.github.com/user") return J({ login: "paul" });
    if (u === A) return J({ default_branch: "main", id: 7 });
    if (u === A + "/git/ref/heads/feat") return J({ message: "Not Found" }, 404);
    if (u === A + "/git/ref/heads/main") return J({ object: { sha: "c0" } });
    if (u === A + "/git/refs" && m === "POST") return J({ object: { sha: b.sha } });
    if (u === A + "/git/commits/c0") return J({ sha: "c0", tree: { sha: "t0" } });
    if (u === A + "/git/blobs") return J({ sha: "b" + Buffer.from(b.content, "base64").length });
    if (u === A + "/git/trees") return J({ sha: "t1" });
    if (u === A + "/git/commits" && m === "POST") return J({ sha: "c1", html_url: "https://github.com/paul/site/commit/c1" });
    if (u === A + "/git/refs/heads/feat" && m === "PATCH") return J({});
    if (u.endsWith("/actions/workflows/deploy.yml/dispatches")) return new Response(null, { status: 204 });
    return J({ message: "?" + u }, 404);
  }, seen));
  try {
    await s.post("/api/integrations", { id: "github", fields: { token: "ghp_x" } });
    const ws = s.app.cfg.workspace; fs.mkdirSync(path.join(ws, "site/css"), { recursive: true }); fs.mkdirSync(path.join(ws, "site/node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(ws, "site/index.html"), "<h1>Привет</h1>"); fs.writeFileSync(path.join(ws, "site/css/a.css"), "h1{}"); fs.writeFileSync(path.join(ws, "site/node_modules/x/i.js"), "x");
    const r = await s.tool("github_push", { repo: "paul/site", branch: "feat", message: "сайт", dir: "site" });
    assert.equal(r.ok, undefined, r.error); assert.equal(r.data.files, 2, "node_modules не пушится"); assert.equal(r.data.createdBranch, true);
    const tree = seen.find((x) => x.url.endsWith("/git/trees")).body; assert.equal(tree.base_tree, "t0"); assert.deepEqual(tree.tree.map((t) => t.path).sort(), ["css/a.css", "index.html"]);
    assert.deepEqual(seen.find((x) => x.url.endsWith("/git/commits") && x.method === "POST").body.parents, ["c0"]);
    assert.equal((await s.tool("github_push", { repo: "paul/site", message: "x", dir: "../.." })).ok, false, "вне рабочей папки — нельзя");
    fs.symlinkSync("/etc", path.join(ws, "link")); assert.match((await s.tool("github_push", { repo: "paul/site", message: "x", dir: "link" })).error, /вне рабочей/, "ссылка наружу — нельзя");
    const run = await s.tool("github_run", { repo: "paul/site", workflow: "deploy.yml", inputs: { env: "prod" } });
    assert.equal(run.data.ref, "main"); assert.deepEqual(seen.at(-1).body, { ref: "main", inputs: { env: "prod" } });
  } finally { s.close(); }
});

test("Vercel: деплой папки проекта (файлы base64) и из репозитория GitHub, команда добавляется к адресу", async () => {
  const seen = [];
  const s = await boot(web((m, u) => u.startsWith("https://api.vercel.com/v2/user") ? J({ user: { username: "paul" } }) : u.startsWith("https://api.vercel.com/v13/deployments") ? J({ id: "dpl_1", url: "site-abc.vercel.app", readyState: "QUEUED", inspectorUrl: "https://vercel.com/i" }) : u === "https://api.github.com/repos/paul/site" ? J({ default_branch: "main", id: 7 }) : J({}, 404), seen));
  try {
    assert.equal((await s.post("/api/integrations", { id: "vercel", fields: { token: "vc", teamId: "team_1" } })).account, "paul");
    fs.mkdirSync(path.join(s.app.cfg.workspace, "site"), { recursive: true }); fs.writeFileSync(path.join(s.app.cfg.workspace, "site/index.html"), "<b>ok</b>");
    const r = await s.tool("vercel_deploy", { name: "site", dir: "site", target: "production" });
    assert.equal(r.data.url, "https://site-abc.vercel.app");
    const call = seen.find((x) => x.url.includes("/v13/deployments")); assert.match(call.url, /teamId=team_1/);
    assert.equal(call.body.target, "production"); assert.deepEqual(call.body.files, [{ file: "index.html", data: Buffer.from("<b>ok</b>").toString("base64"), encoding: "base64" }]);
    await s.tool("vercel_deploy", { name: "site", repo: "paul/site" });
    assert.deepEqual(seen.at(-1).body.gitSource, { type: "github", repo: "site", org: "paul", ref: "main", repoId: 7 });
  } finally { s.close(); }
});

/** Поддельный IMAP/SMTP-сервер: обработчик строк → ответ. */
function fakeServer(onLine, greet) {
  return new Promise((resolve) => {
    const srv = net.createServer((c) => { c.write(greet); let buf = ""; let data = false, msg = "";
      c.on("data", (d) => { buf += d.toString("latin1"); let i; while ((i = buf.indexOf("\r\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (l === ".") { data = false; c.write(onLine("<DATA>", msg) || ""); msg = ""; } else msg += l + "\r\n"; continue; }
        const out = onLine(l); if (out === "<DATA>") { data = true; c.write("354 go\r\n"); } else if (out) c.write(Buffer.from(out, "latin1")); } }); });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

test("почта: письма из «Входящих» (cp1251, quoted-printable, вложение), чтение письма и отправка через SMTP", async () => {
  const subj = "=?windows-1251?B?" + Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]).toString("base64") + "?="; // «Привет» в cp1251
  const head = `From: =?UTF-8?B?${Buffer.from("Мария").toString("base64")}?= <m@x.ru>\r\nSubject: ${subj}\r\nDate: Sat, 10 Oct 2026 10:00:00 +0700\r\n\r\n`;
  const full = Buffer.from(`From: m@x.ru\r\nSubject: ${subj}\r\nContent-Type: multipart/mixed; boundary="XX"\r\n\r\n--XX\r\nContent-Type: text/plain; charset=windows-1251\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=C4=EE=E3=EE=E2=EE=F0 =E3=EE=F2=EE=E2\r\n--XX\r\nContent-Type: application/pdf; name="act.pdf"\r\nContent-Disposition: attachment; filename="act.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0x\r\n--XX--\r\n`);
  const lines = [];
  const imap = await fakeServer((l) => { lines.push(l); const [tag, cmd, a2] = l.split(" ");
    if (cmd === "LOGIN") return l.includes('"good"') ? `${tag} OK\r\n` : `${tag} NO bad\r\n`;
    if (cmd === "EXAMINE" || cmd === "SELECT") return `* 2 EXISTS\r\n${tag} OK\r\n`;
    if (cmd === "UID" && a2 === "SEARCH") return `* SEARCH 41 42\r\n${tag} OK\r\n`;
    if (cmd === "UID" && a2 === "FETCH" && l.includes("HEADER.FIELDS")) return `* 1 FETCH (UID 41 FLAGS (\\Seen) RFC822.SIZE 900 BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${head.length}}\r\n${head})\r\n* 2 FETCH (UID 42 FLAGS () RFC822.SIZE 100 BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${head.length}}\r\n${head})\r\n${tag} OK\r\n`;
    if (cmd === "UID" && a2 === "FETCH") return `* 2 FETCH (UID 42 BODY[] {${full.length}}\r\n${full.toString("latin1")})\r\n${tag} OK\r\n`;
    return `${tag} BAD\r\n`;
  }, "* OK IMAP ready\r\n");
  let sent = "";
  const smtp = await fakeServer((l, msg) => { if (l === "<DATA>") { sent = msg; return "250 queued\r\n"; } if (l.startsWith("EHLO")) return "250-hi\r\n250 AUTH PLAIN\r\n"; if (l.startsWith("AUTH PLAIN")) return Buffer.from(l.slice(11), "base64").toString().endsWith("\0good") ? "235 ok\r\n" : "535 no\r\n"; if (l === "DATA") return "<DATA>"; if (l === "QUIT") return "221 bye\r\n"; return "250 ok\r\n"; }, "220 smtp ready\r\n");
  const port = (h) => (/^imap/.test(h) ? imap : smtp).address().port;
  const s = await boot(web(() => J({}, 404)), { mailConnect: { connect: (o) => net.connect(port(o.host), "127.0.0.1"), readyEvent: "connect" } });
  try {
    assert.equal((await s.post("/api/integrations", { id: "mailru", fields: { email: "p@mail.ru>\r\nRCPT TO:<x@y.z", password: "good" } })).ok, false, "переносы строк в адресе — нельзя");
    const bad = await s.post("/api/integrations", { id: "mailru", fields: { email: "p@mail.ru", password: "nope" } }); assert.equal(bad.ok, false); assert.match(bad.error, /пароль приложения/);
    assert.equal((await s.post("/api/integrations", { id: "mailru", fields: { email: "p@mail.ru", password: "good" } })).account, "p@mail.ru");
    const l = await s.tool("mail_list", { unread: true, limit: 5 });
    assert.deepEqual(l.data.map((m) => [m.uid, m.unread, m.from, m.subject]), [[42, true, "Мария <m@x.ru>", "Привет"], [41, false, "Мария <m@x.ru>", "Привет"]]);
    assert.ok(lines.some((x) => / UID SEARCH UNSEEN$/.test(x)));
    const m = await s.tool("mail_read", { uid: 42 });
    assert.equal(m.data.text, "Договор готов"); assert.deepEqual(m.data.attachments, [{ name: "act.pdf", size: 6, type: "application/pdf" }]);
    assert.ok(!lines.some((x) => /BODY\[\]|STORE/.test(x)), "письмо остаётся непрочитанным (BODY.PEEK)");
    const r = await s.tool("mail_send", { to: ["boss@x.ru"], subject: "Отчёт", text: "Всё готово" });
    assert.equal(r.ok, undefined, r.error); assert.match(sent, /Subject: =\?UTF-8\?B\?/); assert.equal(Buffer.from(sent.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString(), "Всё готово");
    assert.equal(s.app.registry.get("mail_send").risk, "external");
  } finally { s.close(); imap.close(); smtp.close(); }
});

test("MCP: подключение сервера (сеанс, SSE-ответ), список инструментов, вызов — только с подтверждением владельца", async () => {
  let sid = 0;
  const s = await boot(web((m, u, b, h) => {
    if (!u.startsWith("https://mcp.example.com/")) return J({}, 404);
    if (h.Authorization !== "Bearer mt") return new Response("no", { status: 401 });
    if (b.method === "initialize") return J({ jsonrpc: "2.0", id: b.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "x" } } }, 200, { "mcp-session-id": "S" + ++sid });
    if (b.id === undefined) return new Response(null, { status: 202 });
    if (h["Mcp-Session-Id"] !== "S" + sid) return new Response("bad session", { status: 400 });
    if (b.method === "tools/list") return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "list_issues", description: "issues", annotations: { readOnlyHint: true }, inputSchema: { type: "object" } }, { name: "create_issue", inputSchema: { type: "object" } }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    if (b.method === "tools/call") return J({ jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: "сделано: " + b.params.name }] } });
    return J({ jsonrpc: "2.0", id: b.id, error: { code: -32601, message: "нет метода" } });
  }));
  try {
    const bad = await s.post("/api/integrations/mcp", { name: "GitHub MCP", url: "https://mcp.example.com/mcp", token: "wrong" }); assert.equal(bad.ok, false); assert.match(bad.error, /токен/);
    const r = await s.post("/api/integrations/mcp", { name: "GitHub MCP", url: "https://mcp.example.com/mcp", token: "mt" });
    assert.equal(r.ok, true, r.error); assert.equal(r.server.id, "github_mcp"); assert.equal(r.server.tools, 2);
    assert.ok(!JSON.stringify(await s.get("/api/integrations/mcp")).includes('"mt"'), "токен не уходит в браузер");
    const t = await s.tool("mcp_tools", {}); assert.deepEqual(t.data[0].tools.map((x) => x.name), ["list_issues", "create_issue"]);
    assert.equal(s.app.registry.get("mcp_call").risk, "external");
    assert.equal((await s.tool("mcp_call", { server: "github_mcp", name: "create_issue", args: { title: "x" } })).data.text, "сделано: create_issue");
    await s.del("/api/integrations/mcp?id=github_mcp"); assert.equal((await s.tool("mcp_tools", {})).ok, false);
  } finally { s.close(); }
});

test("разбор почты и подбор инструментов для модели на телефоне", () => {
  assert.equal(decodeWords("=?koi8-r?B?" + Buffer.from([0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4]).toString("base64") + "?="), "Привет");
  assert.equal(decodeWords("=?utf-8?Q?=D0=9F=D1=80=D0=B8_=D0=B2=D0=B5=D1=82?="), "При вет");
  const m = parseMail(Buffer.from("Subject: hi\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Привет</p><style>x{}</style><br>мир"));
  assert.equal(m.text, "Привет\nмир");
  const tools = ["github_push", "vercel_deploy", "mail_list", "vk_write", "mcp_call", "web_fetch", "memory_save"].map((name) => ({ name }));
  assert.ok(pickTools(tools, "запушь сайт на гитхаб").includes("github_push"));
  assert.ok(pickTools(tools, "задеплой на версель").includes("vercel_deploy"));
  assert.ok(pickTools(tools, "что нового в почте").includes("mail_list"));
  assert.ok(pickTools(tools, "сделай пост в вк").includes("vk_write"));
  assert.ok(!pickTools(tools, "поставь напоминание").includes("vk_write"));
});

test("файлы чата: своя папка у каждого чата, имя без путей, повтор не затирает, чужой чат — 404", async () => {
  const s = await boot(web(() => J({}, 404)));
  try {
    const c = await s.post("/api/conversations", {});
    const send = async (id, name, data) => { const r = await s.raw("POST", `/api/chats/${id}/files?name=${encodeURIComponent(name)}`, data); return r; };
    const r1 = await send(c.id, "../../etc/отчёт.txt", "привет");
    assert.equal(r1.ok, true); assert.equal(r1.name, "отчёт.txt"); assert.equal(r1.path, `chats/${c.id}/отчёт.txt`);
    assert.equal(fs.readFileSync(path.join(s.app.cfg.workspace, r1.path), "utf8"), "привет");
    assert.equal((await send(c.id, "отчёт.txt", "2")).name, "отчёт (2).txt");
    assert.deepEqual((await s.get(`/api/chats/${c.id}/files`)).files.map((f) => f.name).sort(), ["отчёт (2).txt", "отчёт.txt"]);
    assert.equal((await send("nope", "a.txt", "x")).error, "нет такого чата");
    const code = await s.app.registry.get("code_read").execute({}, { path: r1.path }); assert.match(JSON.stringify(code), /привет/, "Светлана читает файл чата обычным code_read");
  } finally { s.close(); }
});
