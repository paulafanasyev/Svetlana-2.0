// Телефон: маленькая модель получает только нужные инструменты и короткую историю; просмотр веб-проектов без npm; PDF через приложение Android.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { pickTools, recentTools, compactHistory } from "../lib/toolpick.mjs";
import { codeTools } from "../lib/tools/code.mjs";
import { htmlToPdf } from "../lib/tools/docs.mjs";
import { Providers } from "../lib/providers.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sv-and-"));
const FAKE = [
  { name: "crm_contact_add", description: "Добавить контакт клиента в CRM", domain: "crm" }, { name: "acc_income_add", description: "Записать доход самозанятого", domain: "accounting" },
  { name: "doc_create", description: "Создать документ, договор → PDF", domain: "docs" }, { name: "web_search", description: "Найти в интернете", domain: "web" },
  { name: "screen_view", description: "Посмотреть экран устройства", domain: "device" }, { name: "device_act", description: "Нажать, ввести текст на устройстве", domain: "device" },
  { name: "memory_save", description: "Запомнить факт", domain: "memory" }, { name: "knowledge_search", description: "Законы и НПД", domain: "knowledge" },
];

test("маленькая модель: под запрос — нужные инструменты, набор стабилен", () => {
  const tools = [...FAKE, ...codeTools({ workspace: path.join(tmp(), "ws"), commandAllow: ["node"], allowHostExec: false, runnerSocket: "" })];
  const app = pickTools(tools, "Светлана, сделай приложение список дел и покажи его");
  assert.ok(app.includes("code_write") && app.includes("code_preview"), app.join(","));
  assert.ok(!app.includes("acc_income_add"));
  assert.deepEqual(app, pickTools(tools, "Светлана, сделай приложение список дел и покажи его"), "одинаковый запрос — одинаковый набор (кэш модели)");
  assert.ok(app.length <= 12);
  const money = pickTools(tools, "запиши доход 15000 от Ромашки");
  assert.ok(money.includes("acc_income_add"), money.join(","));
  const tap = pickTools(tools, "открой ватсап и нажми на чат с мамой");
  assert.ok(tap.includes("screen_view") && tap.includes("device_act"), tap.join(","));
  const hi = pickTools(tools, "привет"); assert.ok(hi.length >= 4 && hi.length <= 8, hi.join(","));
  assert.deepEqual(recentTools([{ role: "assistant", tool_calls: [{ function: { name: "code_write" } }] }]), ["code_write"]);
});

test("короткая история: сообщение владельца на месте, результаты инструментов не теряют свой вызов", () => {
  const msgs = [{ role: "user", content: "старый вопрос" }, { role: "assistant", content: "старый ответ" }, { role: "user", content: "сделай сайт" }];
  for (let i = 0; i < 20; i++) msgs.push({ role: "assistant", content: "", tool_calls: [{ id: "c" + i, function: { name: "code_write", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c" + i, content: "x".repeat(i === 19 ? 9000 : 10) });
  const h = compactHistory(msgs, 16);
  assert.ok(h.length <= 17, String(h.length));
  assert.ok(h.some((m) => m.content === "сделай сайт"));
  const firstTool = h.findIndex((m) => m.role === "tool"); assert.equal(h[firstTool - 1].role, "assistant");
  assert.ok(h[h.length - 1].content.length < 3100, "длинный результат обрезан");
  assert.deepEqual(compactHistory([{ role: "user", content: "привет" }], 16).map((m) => m.content), ["привет"]);
  assert.deepEqual(compactHistory(msgs.slice(0, 3), 16).map((m) => m.content), ["старый вопрос", "старый ответ", "сделай сайт"], "прошлый обмен сохраняется, если влезает");
});

test("code_preview: веб-проект без npm открывается по адресу, чужие файлы не отдаются", async () => {
  const d = tmp(); const ws = path.join(d, "ws");
  const T = Object.fromEntries(codeTools({ workspace: ws, commandAllow: [], allowHostExec: false, runnerSocket: "" }).map((t) => [t.name, t]));
  await T.code_write.execute({}, { path: "todo/index.html", content: "<h1>Список дел</h1><script src=app.js></script>" });
  await T.code_write.execute({}, { path: "todo/app.js", content: "console.log(1)" });
  await T.code_write.execute({}, { path: "secret.txt", content: "секрет" });
  assert.equal(T.code_preview.risk, "read");
  const r = await T.code_preview.execute({}, { path: "todo" });
  assert.match(r.data.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
  assert.equal((await fetch(r.data.url.replace(/[0-9a-f]{32}\/$/, ""))).status, 404, "без секрета в адресе другие приложения телефона проект не видят");
  assert.equal((await fetch(r.data.url.replace(/[0-9a-f]{32}\/$/, "index.html"))).status, 404);
  const page = await fetch(r.data.url); assert.equal(page.status, 200); assert.match(await page.text(), /Список дел/);
  assert.match((await fetch(r.data.url + "app.js")).headers.get("content-type"), /javascript/);
  assert.equal((await fetch(r.data.url + "..%2Fsecret.txt")).status, 404, "выйти из папки проекта нельзя");
  assert.equal((await fetch(r.data.url.replace(/\/$/, "") + "/../secret.txt")).status, 404);
  assert.equal((await T.code_preview.execute({}, { path: "todo" })).data.url, r.data.url, "повторный просмотр — тот же адрес");
  assert.equal((await T.code_preview.execute({}, { path: "nope" })).ok, false);
  assert.ok((await T.code_serve_list.execute({}, {})).data.servers.some((s) => s.id === r.data.id));
  assert.equal((await T.code_serve_stop.execute({}, { id: r.data.id })).data.stopped, 1);
  await assert.rejects(fetch(r.data.url));
});

test("PDF на телефоне: ядро просит приложение напечатать HTML", async () => {
  const d = tmp(); const html = path.join(d, "a.html"), pdf = path.join(d, "a.pdf"); fs.writeFileSync(html, "<style>@page{size:1280px 720px}</style>слайд");
  let got = null;
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (x) => (b += x)); req.on("end", () => { got = { auth: req.headers.authorization, ...JSON.parse(b) }; fs.writeFileSync(got.pdf, "%PDF-1.4 " + "x".repeat(600)); res.end("ok"); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  process.env.SVETLANA_PDF_BRIDGE = `http://127.0.0.1:${srv.address().port}/pdf`; process.env.SVETLANA_PDF_TOKEN = "t0k";
  try {
    const r = await htmlToPdf({}, html, pdf);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(got.auth, "Bearer t0k"); assert.equal(got.slides, true); assert.equal(got.html, html);
  } finally { delete process.env.SVETLANA_PDF_BRIDGE; delete process.env.SVETLANA_PDF_TOKEN; srv.close(); }
});

test("провайдер телефона: потолок ответа и признак компактной модели", async () => {
  let body = null;
  const fx = async (_u, o) => { body = JSON.parse(o.body); return new Response(JSON.stringify({ choices: [{ message: { content: "ок" } }] }), { status: 200, headers: { "content-type": "application/json" } }); };
  const p = new Providers(null, fx); p.list = [p.normalize({ id: "local", preset: "openai", baseUrl: "http://127.0.0.1:8081/v1", model: "local", compact: true, maxTokens: 1024, capabilities: ["chat", "tools"] })];
  assert.equal(p.compact(), true);
  await p.chat({ messages: [{ role: "user", content: "привет" }], maxTokens: 8000 });
  assert.equal(body.max_tokens, 1024);
  p.list = [p.normalize({ id: "cloud", preset: "openai", model: "gpt", capabilities: ["chat", "tools"] })]; assert.equal(p.compact(), false);
});

test("ядро доказывает, что это оно: HMAC(секрет, nonce) в /healthz", async () => {
  const { createServer } = await import("../server.mjs");
  const crypto = await import("node:crypto");
  const app = { cfg: { adminToken: "a".repeat(20), secret: "s3cret", dataDir: tmp() }, agent: { locks: new Map([["x", 1]]) } };
  const srv = createServer(app); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const j = await (await fetch(`http://127.0.0.1:${srv.address().port}/healthz?nonce=abc`)).json();
    assert.equal(j.busy, true); assert.equal(j.proof, crypto.createHmac("sha256", "s3cret").update("svetlana-health:abc").digest("hex"));
    assert.equal((await (await fetch(`http://127.0.0.1:${srv.address().port}/healthz`)).json()).proof, undefined);
  } finally { srv.close(); }
});
