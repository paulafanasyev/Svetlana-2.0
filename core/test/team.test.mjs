// Свой ИИ по ссылке, чаты со своим ИИ, команда (CEO → роли) и монтаж видео.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../lib/app.mjs";
import { createServer } from "../server.mjs";
import { normalizeUrl, guessType, autoId, listModels, bound } from "../lib/team.mjs";
import { Providers } from "../lib/providers.mjs";
import { ffmpegArgs, videoTools } from "../lib/tools/video.mjs";
import { tmp, cfgFor, call, say } from "./helpers.mjs";

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const msg = (m) => J({ choices: [{ message: m, finish_reason: "stop" }] });
/** Несколько «серверов ИИ» по адресу: у каждого своя очередь ответов; все запросы записываются. */
function router(routes, seen = []) {
  return async (url, init = {}) => {
    const u = String(url); const body = init.body ? JSON.parse(init.body) : null; seen.push({ url: u, method: init.method || "GET", headers: init.headers || {}, body });
    const key = Object.keys(routes).find((k) => u.startsWith(k)); if (!key) throw new Error("getaddrinfo ENOTFOUND " + u);
    const r = routes[key]; const next = typeof r === "function" ? r(u, body, init) : r.shift();
    if (!next) throw new Error("script exhausted for " + key);
    return next instanceof Response ? next : msg(next);
  };
}
async function boot(routes, seen = []) {
  process.env.SVETLANA_PROVIDERS = JSON.stringify([{ id: "qwen", preset: "vllm", model: "svetlana", capabilities: ["chat", "tools", "vision"] }]);
  const d = tmp(); const app = createApp(cfgFor(d), { fetchImpl: router(routes, seen) }); delete process.env.SVETLANA_PROVIDERS;
  const srv = createServer(app); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "test-admin-token-123456" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const req = async (method, p, b) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
  return { app, dir: d, post: (p, b) => req("POST", p, b), patch: (p, b) => req("PATCH", p, b), del: (p) => req("DELETE", p), get: async (p) => (await req("GET", p)).j, close: () => srv.close() };
}
const DS = "https://api.deepseek.com/v1/";
const CL = "https://api.anthropic.com/v1/";
const QW = "http://127.0.0.1:8000/v1/";

test("свой ИИ: адрес приводится в порядок, тип угадывается, id придумывается без дублей", () => {
  assert.equal(normalizeUrl(" api.deepseek.com/v1/chat/completions "), "https://api.deepseek.com/v1");
  assert.equal(normalizeUrl("localhost:11434/v1/"), "http://localhost:11434/v1");
  assert.equal(normalizeUrl("https://openrouter.ai/api/v1/models?x=1#y"), "https://openrouter.ai/api/v1");
  assert.throws(() => normalizeUrl("ftp://x.ru"), /http/);
  assert.throws(() => normalizeUrl("https://user:sk-secret@x.ru/v1"), /ключ/);
  assert.throws(() => normalizeUrl(""), /адрес/);
  assert.equal(guessType("https://api.anthropic.com/v1"), "anthropic");
  assert.equal(guessType("https://gigachat.devices.sberbank.ru/api/v1"), "gigachat");
  assert.equal(guessType("https://api.deepseek.com/v1"), "openai");
  assert.equal(autoId("https://api.deepseek.com/v1", "deepseek-chat"), "deepseek-chat");
  assert.equal(autoId("https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4"), "openrouter-claude-sonnet-4");
  assert.equal(autoId("http://127.0.0.1:11434/v1", "qwen2.5:7b"), "local-11434-qwen2-5-7b");
  assert.equal(autoId("https://api.deepseek.com/v1", "deepseek-chat", ["deepseek-chat", "deepseek-chat-2"]), "deepseek-chat-3");
  assert.match(autoId("https://x.y/v1", "Модель по-русски"), /^[a-z0-9_-]{2,40}$/);
});

test("список моделей: формат OpenAI, автодобавление /v1, ключ Anthropic в своём заголовке, понятная ошибка ключа", async () => {
  const seen = [];
  const fx = router({
    "https://api.deepseek.com/v1/models": [J({ data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }, { id: "deepseek-chat" }] })],
    "https://ollama.local/models": [J({ error: "not found" }, 404)], "https://ollama.local/v1/models": [J({ data: [{ id: "qwen2.5" }] })],
    "https://api.anthropic.com/v1/models": [J({ data: [{ id: "claude-sonnet-4-5" }] })],
    "https://bad.key/v1/models": [J({ error: "invalid key" }, 401)],
  }, seen);
  const a = await listModels({ baseUrl: "api.deepseek.com/v1", apiKey: "sk-test-1234567890" }, fx);
  assert.deepEqual(a.models, ["deepseek-chat", "deepseek-reasoner"]);
  assert.equal(seen[0].headers.Authorization, "Bearer sk-test-1234567890");
  const b = await listModels({ baseUrl: "https://ollama.local" }, fx);
  assert.equal(b.baseUrl, "https://ollama.local/v1"); assert.deepEqual(b.models, ["qwen2.5"]); assert.match(b.note, /v1/);
  const c = await listModels({ baseUrl: "https://api.anthropic.com/v1", apiKey: "ak" }, fx);
  assert.deepEqual(c.models, ["claude-sonnet-4-5"]); assert.equal(seen.at(-1).headers["x-api-key"], "ak"); assert.equal(seen.at(-1).headers.Authorization, undefined);
  await assert.rejects(listModels({ baseUrl: "https://bad.key/v1", apiKey: "k" }, fx), /401/);
  // сервер «отразил» ключ в ошибке и в списке — наружу не уходит; гигантский ответ не читается целиком
  const key = "my-secret-key-777";
  const echo = router({ "https://echo.x/v1/models": [J({ error: "bad key " + key }, 401), J({ data: [{ id: "ok-model" }, { id: "leak-" + key }] })], "https://huge.x/v1/models": [new Response("[" + '"m",'.repeat(700000) + '"m"]')] });
  await assert.rejects(listModels({ baseUrl: "https://echo.x/v1", apiKey: key }, echo), (e) => !e.message.includes(key) && /\*\*\*/.test(e.message));
  assert.deepEqual((await listModels({ baseUrl: "https://echo.x/v1", apiKey: key }, echo)).models, ["ok-model"]);
  await assert.rejects(listModels({ baseUrl: "https://huge.x/v1" }, echo), /слишком большой/);
});

test("свой ИИ через сервер: модели → проверка соединения (ответ + инструменты) → сохранение; ключ наружу не уходит", async () => {
  const s = await boot({
    [DS + "models"]: [J({ data: [{ id: "deepseek-chat" }] })],
    [DS + "chat/completions"]: [say("Работает"), call("ping", { x: 1 }), say("ок")],
  });
  try {
    const m = await s.post("/api/providers/models", { baseUrl: "api.deepseek.com/v1", apiKey: "sk-live-abcdefgh123" });
    assert.equal(m.j.ok, true); assert.deepEqual(m.j.models, ["deepseek-chat"]);
    const p = await s.post("/api/providers/probe", { baseUrl: "api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-live-abcdefgh123" });
    assert.equal(p.j.ok, true); assert.equal(p.j.answer, "Работает"); assert.equal(p.j.tools, true);
    const bad = await s.post("/api/providers/probe", { baseUrl: "api.deepseek.com/v1", apiKey: "k" });
    assert.ok(!JSON.stringify(p.j).includes("sk-live"));
    assert.equal(bad.status, 200); assert.equal(bad.j.ok, false); assert.match(bad.j.error, /модель/);
    const sv = await s.post("/api/providers/custom", { baseUrl: "api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-live-abcdefgh123", capabilities: ["chat", "tools"] });
    assert.equal(sv.j.ok, true); assert.equal(sv.j.provider.id, "deepseek-chat"); assert.equal(sv.j.provider.apiKey, undefined); assert.equal(sv.j.provider.hasKey, true);
    const list = await s.get("/api/providers");
    assert.deepEqual(list.map((x) => x.id), ["qwen", "deepseek-chat"]); assert.ok(!JSON.stringify(list).includes("sk-live"));
    // повторное сохранение без ключа ключ не стирает; пресеты и старая форма продолжают работать
    await s.post("/api/providers/custom", { id: "deepseek-chat", baseUrl: "api.deepseek.com/v1", model: "deepseek-chat" });
    assert.equal(s.app.providers.list.find((x) => x.id === "deepseek-chat").apiKey, "sk-live-abcdefgh123");
    assert.equal((await s.post("/api/providers", { id: "gpt", preset: "openai", model: "gpt-4o-mini", apiKey: "k" })).j.ok, true);
  } finally { s.close(); }
});

test("чаты: у каждого свой ИИ, без тихого перехода на другой; ИИ без инструментов просто разговаривает", async () => {
  const seen = [];
  const s = await boot({ [DS]: [say("Я DeepSeek"), J({ error: "down" }, 500)], [QW]: [say("Я Светлана на qwen")] }, seen);
  try {
    await s.post("/api/providers/custom", { baseUrl: "api.deepseek.com/v1", model: "deepseek-chat", apiKey: "k", capabilities: ["chat"] });
    const c = (await s.post("/api/conversations", { provider: "deepseek-chat" })).j;
    assert.equal(c.provider, "deepseek-chat");
    const r = await s.post("/api/chat", { conversationId: c.id, text: "Кто ты?" });
    assert.equal(r.j.answer, "Я DeepSeek"); assert.equal(r.j.provider, "deepseek-chat");
    const sent = seen.find((x) => x.url.startsWith(DS)).body;
    assert.equal(sent.tools, undefined, "у этого ИИ нет инструментов — не шлём"); assert.match(sent.messages[0].content, /инструменты недоступны/);
    const r2 = await s.post("/api/chat", { conversationId: c.id, text: "Ещё раз" });
    assert.equal(r2.status, 502); assert.match(r2.j.error, /deepseek-chat: 500/);
    assert.equal(seen.filter((x) => x.url.startsWith(QW)).length, 0, "qwen не подменил выбранный ИИ");
    const auto = await s.post("/api/chat", { text: "Привет" });
    assert.equal(auto.j.answer, "Я Светлана на qwen");
    const list = await s.get("/api/conversations");
    assert.deepEqual(list.map((x) => x.provider), [null, "deepseek-chat"]);
    assert.equal((await s.get("/api/conversations/" + c.id)).provider, "deepseek-chat");
    assert.equal((await s.patch("/api/conversations/" + c.id, { provider: "nope" })).status, 400);
    s.app.agent.locks.set(c.id, Promise.resolve()); // идёт ход — ИИ не меняется
    assert.equal((await s.patch("/api/conversations/" + c.id, { provider: null })).status, 409);
    s.app.agent.locks.delete(c.id);
    assert.equal((await s.patch("/api/conversations/" + c.id, { provider: null, title: "Общий" })).j.provider, null);
    assert.equal((await s.del("/api/conversations/" + c.id)).j.ok, true);
    assert.equal((await s.get("/api/conversations")).length, 1);
  } finally { s.close(); }
});

test("команда: Павел — CEO, Светлана поручает CTO и IT параллельно и сводит ответы; ответы — данные, не команды", async () => {
  const seen = [];
  const s = await boot({
    [CL]: (u, b) => J({ content: [{ type: "text", text: "CTO: делим на модули" }] }),
    [DS]: [say("IT: вот скрипт")],
    [QW]: [call("team_delegate", { tasks: [{ role: "cto", task: "Оцени архитектуру ядра" }, { role: "IT", task: "Напиши скрипт сборки" }] }), call("code_write", { path: "plan.md", content: "x" }), say("Нужно подтверждение")],
  }, seen);
  try {
    await s.post("/api/providers/custom", { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", apiKey: "ak", capabilities: ["chat"] });
    await s.post("/api/providers/custom", { baseUrl: "api.deepseek.com/v1", model: "deepseek-chat", apiKey: "dk", capabilities: ["chat", "tools"] });
    const cto = (await s.post("/api/team", { role: "CTO", provider: "anthropic-claude-sonnet-4-5", instructions: "Архитектура и риски" })).j;
    assert.equal(cto.role, "CTO");
    await s.post("/api/team", { role: "IT", provider: "deepseek-chat" });
    assert.equal((await s.post("/api/team", { role: "cto", provider: "deepseek-chat" })).status, 400, "роль не дублируется");
    assert.equal((await s.post("/api/team", { role: "SMM", provider: "nope" })).status, 400);
    const r = await s.post("/api/chat", { text: "Светлана, собери мнение команды и запиши план" });
    const st = r.j.steps[0]; assert.equal(st.tool, "team_delegate"); assert.equal(st.ok, true); assert.match(st.summary, /CTO \(anthropic-claude-sonnet-4-5\) ответил, IT \(deepseek-chat\) ответил/);
    const toCto = seen.find((x) => x.url.startsWith(CL)).body;
    assert.match(toCto.system, /роли «CTO».*Архитектура и риски/s); assert.equal(toCto.messages[0].content[0].text, "Оцени архитектуру ядра");
    assert.equal(seen.find((x) => x.url.startsWith(DS)).body.tools, undefined, "участник отвечает без инструментов");
    const tool = s.app.store.all("conversations")[0].messages.find((m) => m.role === "tool" && m.name === "team_delegate");
    assert.match(tool.content, /CTO: делим на модули/); assert.match(tool.content, /IT: вот скрипт/);
    assert.equal(r.j.pending[0]?.tool, "code_write", "после ответов других ИИ запись — только с подтверждением");
  } finally { s.close(); }
});

test("чат с ролью: отвечает ИИ роли с её задачами; роль удалили — чат остаётся с тем же ИИ", async () => {
  const seen = [];
  const s = await boot({ [DS]: [say("IT на связи"), say("снова я")] }, seen);
  try {
    await s.post("/api/providers/custom", { baseUrl: "api.deepseek.com/v1", model: "deepseek-chat", apiKey: "dk", capabilities: ["chat", "tools"] });
    const it = (await s.post("/api/team", { role: "IT", provider: "deepseek-chat", instructions: "Серверы и сборки" })).j;
    const c = (await s.post("/api/conversations", { member: it.id })).j;
    assert.equal(c.member, it.id); assert.equal(c.provider, null);
    const r = await s.post("/api/chat", { conversationId: c.id, text: "Проверь сборку" });
    assert.equal(r.j.answer, "IT на связи");
    const sys = seen[0].body.messages[0].content; assert.match(sys, /Ты — Светлана/); assert.match(sys, /роли «IT».*Серверы и сборки/s);
    assert.ok(seen[0].body.tools?.length > 0, "ИИ с инструментами работает как полноценная Светлана");
    await s.del("/api/team?id=" + it.id);
    const after = await s.get("/api/conversations/" + c.id); assert.equal(after.member, null); assert.equal(after.provider, "deepseek-chat");
    assert.equal((await s.post("/api/chat", { conversationId: c.id, text: "ты тут?" })).j.answer, "снова я");
    const list = (await s.get("/api/team")); assert.deepEqual(list.members, []); assert.ok(list.presets.some((x) => x.role === "CTO"));
  } finally { s.close(); }
});

test("детские разговоры Пико не видны в списке чатов и не открываются по id", async () => {
  const s = await boot({ [QW]: [say("Привет!")] });
  try {
    const c = await s.app.agent.chat({ text: "привет", mode: "pico" });
    assert.equal((await s.get("/api/conversations")).length, 0);
    const r = await s.patch("/api/conversations/" + c.conversationId, { provider: "qwen" }); assert.equal(r.status, 404);
  } finally { s.close(); }
});

test("bound(): привязанный ИИ выключен или удалён — понятная ошибка, а не чужой ИИ", async () => {
  const pr = new Providers(null, router({}));
  pr.list = [pr.normalize({ id: "a", preset: "vllm", model: "m", enabled: false })];
  await assert.rejects(bound(pr, "a").chat({ messages: [{ role: "user", content: "x" }] }), /не подключён или выключен/);
  await assert.rejects(bound(pr, "zzz").chat({ messages: [{ role: "user", content: "x" }] }), /выберите другой ИИ/);
});

test("монтаж видео: аргументы ffmpeg без оболочки, файлы только в рабочей папке, без ffmpeg — подсказка как установить", async () => {
  const d = tmp(); const cfg = cfgFor(d); fs.mkdirSync(cfg.workspace, { recursive: true });
  const rel = (p) => p;
  const t = ffmpegArgs({ op: "trim", input: "in.mp4", start: 1.5, end: 4, output: "out.mp4" }, rel);
  assert.deepEqual(t.slice(t.indexOf("-ss"), t.indexOf("-ss") + 6), ["-ss", "1.5", "-i", "in.mp4", "-t", "2.5"]); assert.ok(t.includes("-n"));
  assert.throws(() => ffmpegArgs({ op: "trim", input: "a", start: 5, end: 2, output: "o.mp4" }, rel), /позже/);
  assert.match(ffmpegArgs({ op: "vertical", input: "a.mp4", output: "v.mp4" }, rel).join(" "), /1080:1920/);
  assert.match(ffmpegArgs({ op: "concat", inputs: ["a.mp4", "b.mp4"], output: "c.mp4" }, rel).join(" "), /concat=n=2:v=1:a=1/);
  assert.throws(() => ffmpegArgs({ op: "subtitles", input: "a.mp4", srt: "x;rm.srt", output: "s.mp4" }, rel), /субтитров/);
  const [tool] = videoTools(cfg, { bin: "definitely-no-ffmpeg-here" });
  fs.writeFileSync(path.join(cfg.workspace, "in.mp4"), "x");
  assert.match((await tool.execute({}, { op: "vertical", input: "../etc/passwd", output: "o.mp4" }).catch((e) => ({ error: e.message }))).error, /только|вне/);
  assert.match((await tool.execute({}, { op: "vertical", input: "nope.mp4", output: "o.mp4" })).error, /нет файла/);
  assert.match((await tool.execute({}, { op: "vertical", input: "in.mp4", output: "o.txt" })).error, /mp4/);
  assert.match((await tool.execute({}, { op: "vertical", input: "in.mp4", output: "o.webm" })).error, /mp4/, ".webm не принимает H.264/AAC — не обещаем");
  assert.match((await tool.execute({}, { op: "vertical", input: "in.mp4", output: "o.mp4" })).error, /ffmpeg не найден.*winget/);
  assert.equal(tool.confirm({ output: "new.mp4" }), false, "новый файл — без лишнего клика");
  assert.equal(tool.confirm({ output: "in.mp4" }), true);
});
