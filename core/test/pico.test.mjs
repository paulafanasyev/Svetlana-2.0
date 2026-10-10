import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../lib/app.mjs";
import { createServer } from "../server.mjs";
import { tmp, cfgFor, scriptedFetch, call, say } from "./helpers.mjs";

const TOKEN = "pico-token-1234567890";
async function boot(script, seen) {
  process.env.SVETLANA_PROVIDERS = JSON.stringify([{ id: "qwen", preset: "vllm", model: "svetlana", capabilities: ["chat", "tools"] }]);
  const app = createApp(cfgFor(tmp(), { picoToken: TOKEN, picoOrigins: ["https://localhost", "capacitor://localhost"] }), { fetchImpl: scriptedFetch(script, seen) }); delete process.env.SVETLANA_PROVIDERS;
  const srv = createServer(app); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/api/pico/chat`;
  const ask = (b, h = {}) => fetch(base, { method: "POST", headers: { "content-type": "application/json", origin: "https://localhost", authorization: `Bearer ${TOKEN}`, ...h }, body: JSON.stringify(b) });
  return { app, base, ask, close: () => srv.close() };
}

test("Пико из детского приложения: CORS, свой токен, только детские инструменты, чужой разговор закрыт", async () => {
  const seen = [];
  const s = await boot([call("math_check", { expression: "7*8", answer: "54" }), say("Почти! Проверь ещё раз: 7 раз по 8."), call("crm_find", { query: "Иван" }), say("Давай лучше порешаем примеры!")], seen);
  try {
    const pre = await fetch(s.base, { method: "OPTIONS", headers: { origin: "capacitor://localhost", "access-control-request-method": "POST" } });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-origin"), "capacitor://localhost");
    assert.equal((await s.ask({ text: "привет" }, { authorization: "Bearer wrong" })).status, 401);
    assert.equal((await s.ask({ text: "привет" }, { origin: "https://evil.example" })).status, 403);
    const r = await s.ask({ text: "7 на 8 будет 54?" }); const j = await r.json();
    assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), "https://localhost");
    assert.match(j.answer, /Почти/); assert.deepEqual(j.steps, [{ tool: "math_check", ok: true }]);
    const offered = seen[0].body.tools.map((t) => t.function.name).sort();
    assert.deepEqual(offered, ["exercise_evaluate", "exercise_templates", "math_check", "workout_analyze", "workout_plan"]);
    assert.match(seen[0].body.messages[0].content, /Ты — Пико/);
    const j2 = await (await s.ask({ text: "найди Ивана в CRM", conversationId: j.conversationId })).json();
    assert.equal(j2.steps.length, 0, "взрослый инструмент не выполнился");
    const toolMsg = s.app.store.get("conversations", j.conversationId).messages.find((m) => m.role === "tool" && m.name === "crm_find");
    assert.match(toolMsg.content, /нет/);
    const adult = s.app.store.insert("conversations", { title: "взрослый", messages: [{ role: "user", content: "x" }], pending: [], mode: "pavel" });
    assert.equal((await s.ask({ text: "покажи", conversationId: adult.id })).status, 403);
  } finally { s.close(); }
});
