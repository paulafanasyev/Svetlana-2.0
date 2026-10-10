// Приоритет ИИ (порядок во вкладке «ИИ») и версия ядра.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../lib/app.mjs";
import { createServer } from "../server.mjs";
import { tmp, cfgFor, say } from "./helpers.mjs";

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const msg = (m) => J({ choices: [{ message: m, finish_reason: "stop" }] });
function router(routes, seen = []) {
  return async (url, init = {}) => {
    const u = String(url); const body = init.body ? JSON.parse(init.body) : null; seen.push({ url: u, method: init.method || "GET", body });
    const key = Object.keys(routes).find((k) => u.startsWith(k)); if (!key) throw new Error("getaddrinfo ENOTFOUND " + u);
    const next = routes[key].shift(); if (!next) throw new Error("script exhausted for " + key);
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
  return { app, dir: d, post: (p, b) => req("POST", p, b), get: async (p) => (await req("GET", p)).j, close: () => srv.close() };
}
const DS = "https://api.deepseek.com/v1/";
const QW = "http://127.0.0.1:8000/v1/";

test("приоритет ИИ: порядок из вкладки «ИИ» сохраняется, модель телефона после перезапуска встаёт на своё место; версия ядра видна", async () => {
  const seen = [];
  const s = await boot({ [DS]: [say("отвечает DeepSeek")] }, seen);
  try {
    await s.post("/api/providers/custom", { baseUrl: "api.deepseek.com/v1", model: "deepseek-chat", apiKey: "dk", capabilities: ["chat", "tools"] });
    s.app.providers.upsert({ id: "local", preset: "vllm", model: "phone", capabilities: ["chat", "tools"], compact: true });
    assert.deepEqual(s.app.providers.list.map((p) => p.id), ["qwen", "deepseek-chat", "local"]);
    const r = await s.post("/api/providers/order", { ids: ["deepseek-chat", "local", "qwen", "nope"] });
    assert.deepEqual(r.j.order, ["deepseek-chat", "local", "qwen"]);
    s.app.providers.remove("local"); s.app.providers.upsert({ id: "local", preset: "vllm", model: "phone", capabilities: ["chat", "tools"], compact: true }); // телефон перезапустил модель
    assert.deepEqual(s.app.providers.list.map((p) => p.id), ["deepseek-chat", "local", "qwen"]);
    assert.equal((await s.post("/api/chat", { text: "привет" })).j.answer, "отвечает DeepSeek", "первым спрашивается первый по приоритету");
    assert.ok(!seen.some((x) => x.url.startsWith(QW)));
    const v = await s.get("/api/version"); assert.match(v.version, /команда/); assert.ok(v.tools > 50);
  } finally { s.close(); }
});

test("приоритет ИИ: при сбое первого отвечает следующий; ИИ из настроек сервера (env) не пишутся в providers.json", async () => {
  const seen = [];
  const s = await boot({ [DS]: [new Response("busy", { status: 503 })], [QW]: [say("отвечает Qwen")] }, seen);
  try {
    await s.post("/api/providers/custom", { baseUrl: "api.deepseek.com/v1", model: "deepseek-chat", apiKey: "dk", capabilities: ["chat", "tools"] });
    await s.post("/api/providers/order", { ids: ["deepseek-chat", "qwen"] });
    assert.equal((await s.post("/api/chat", { text: "привет" })).j.answer, "отвечает Qwen");
    assert.ok(seen.findIndex((x) => x.url.startsWith(DS)) < seen.findIndex((x) => x.url.startsWith(QW)), "сначала первый по приоритету");
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "providers.json"), "utf8")).map((p) => p.id);
    assert.deepEqual(saved, ["deepseek-chat"], "qwen задан в env — в файл не попадает");
  } finally { s.close(); }
});
