import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../lib/app.mjs";
import { isPrivateIp } from "../lib/netguard.mjs";
import { tmp, cfgFor, scriptedFetch, say } from "./helpers.mjs";

const two = (a, b) => ({ role: "assistant", content: "", tool_calls: [a, b].map(([n, args], i) => ({ id: `t${i}`, type: "function", function: { name: n, arguments: JSON.stringify(args) } })) });
function mk(script, seen, dir = tmp()) {
  process.env.SVETLANA_PROVIDERS = JSON.stringify([{ id: "q", preset: "vllm", model: "m", capabilities: ["chat", "tools", "vision"] }]);
  const app = createApp(cfgFor(dir), { fetchImpl: scriptedFetch(script, seen) }); delete process.env.SVETLANA_PROVIDERS; return app;
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function checkOrder(msgs) { // после assistant(tool_calls) идут ВСЕ ответы tool, и только потом остальное
  for (let i = 0; i < msgs.length; i++) if (msgs[i].tool_calls?.length) {
    const ids = new Set(msgs[i].tool_calls.map((c) => c.id));
    const n = ids.size; for (let j = i + 1; j <= i + n; j++) { assert.equal(msgs[j]?.role, "tool", `сообщение ${j} должно быть tool`); ids.delete(msgs[j].tool_call_id); }
    assert.equal(ids.size, 0, "у каждого вызова есть ответ");
  }
}

test("картинка с экрана идёт модели только после всех результатов пачки (OpenAI/Anthropic порядок)", async () => {
  const seen = []; const app = mk([two(["screen_view", { deviceId: "d1" }], ["crm_find", { query: "x" }]), say("Вижу экран.")], seen);
  app.registry.get("screen_view").execute = async () => ({ data: { width: 1, height: 1 }, image: { mime: "image/png", base64: PNG }, untrusted: true });
  await app.agent.chat({ text: "что на экране?" });
  const msgs = seen[1].body.messages; checkOrder(msgs);
  assert.ok(msgs.at(-1).content[0].type === "image_url", "изображение в конце");
});

test("то же при подтверждении: картинка после всех tool, а запись без confirm в общей пачке тоже требует явного подтверждения", async () => {
  const seen = []; const app = mk([two(["screen_view", { deviceId: "d1" }], ["code_write", { path: "a.txt", content: "1" }]), say("ок")], seen);
  app.registry.get("screen_view").execute = async () => ({ data: {}, image: { mime: "image/png", base64: PNG } });
  const r = await app.agent.chat({ text: "x" }); assert.equal(r.pending.length, 1);
  await app.agent.confirm({ conversationId: r.conversationId, decisions: [{ callId: r.pending[0].callId, token: r.pending[0].token, approve: true }] });
  checkOrder(seen.at(-1).body.messages);
  assert.ok(seen.at(-1).body.messages.some((m) => Array.isArray(m.content) && m.content[0].type === "image_url"), "скриншот вернулся модели после подтверждения");
  const seen2 = []; const app2 = mk([two(["code_write", { path: "b.txt", content: "1" }], ["crm_contact_add", { name: "Скрытый" }]), say("ок")], seen2);
  const r2 = await app2.agent.chat({ text: "y" });
  assert.deepEqual(r2.pending.map((p) => p.tool), ["code_write", "crm_contact_add"], "вторая запись видна владельцу");
  await app2.agent.confirm({ conversationId: r2.conversationId, decisions: [{ callId: r2.pending[0].callId, token: r2.pending[0].token, approve: true }] });
  assert.equal(app2.store.all("contacts").length, 0, "без своего подтверждения контакт не создан");
});

test("метка «прочитаны чужие данные» сохраняется вместе с ожидающим действием", async () => {
  const dir = tmp(); const app = mk([two(["web_fetch", { url: "https://example.com/" }], ["code_write", { path: "c.txt", content: "1" }])], [], dir);
  app.registry.get("web_fetch").execute = async () => ({ data: { text: "..." }, untrusted: true });
  const r = await app.agent.chat({ text: "z" });
  assert.equal(app.store.get("conversations", r.conversationId).tainted, true);
  const fresh = mk([], [], dir); assert.equal(fresh.store.get("conversations", r.conversationId).tainted, true, "после перезапуска тоже");
});

test("SSRF: IPv4-совместимые IPv6 (::7f00:1, ::ac10:1) запрещены", () => {
  for (const ip of ["::7f00:1", "::ac10:1", "::a00:1", "::ffff:7f00:1"]) assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp("2a02:6b8::2:242"), false);
});

test("CRM/НПД: битые даты и ссылки на несуществующие записи отклоняются", async () => {
  const { validate } = await import("../lib/tools/registry.mjs");
  const app = mk([], []); const add = app.registry.get("acc_income_add");
  assert.ok(validate(add.parameters, { amount: 1, date: "2026-99-99", payer: "individual", service: "x" }).length);
  assert.ok(validate(add.parameters, { amount: 1, date: "2026-02-30", payer: "individual", service: "x" }).length);
  assert.deepEqual(validate(add.parameters, { amount: 1, date: "2028-02-29", payer: "individual", service: "x" }), []);
  assert.equal((await app.registry.get("crm_task_add").execute({}, { title: "t", contactId: "нет" })).ok, false);
});

test("устройство: без свежего скриншота и за пределами экрана действие не отправляется; пустой ответ устройства — не успех", async () => {
  const app = mk([], []); const calls = [];
  app.hub.call = async (id, m, p) => { calls.push(m); return m === "screen.capture" ? { image: PNG, width: 100, height: 200 } : {}; };
  const act = app.registry.get("device_act"), view = app.registry.get("screen_view");
  const real = app.hub.call; app.hub.call = async (id, m) => (m === "screen.capture" ? { width: 100, height: 200 } : {});
  await view.execute({}, { deviceId: "d" });
  assert.match((await act.execute({}, { deviceId: "d", action: "tap", x: 5, y: 5 })).error, /сначала посмотрите экран/, "снимок без картинки не открывает управление");
  app.hub.call = real;
  assert.match((await act.execute({}, { deviceId: "d", action: "tap", x: 5, y: 5 })).error, /сначала посмотрите экран/);
  await view.execute({}, { deviceId: "d" });
  assert.match((await act.execute({}, { deviceId: "d", action: "tap", x: 150, y: 5 })).error, /вне экрана/);
  assert.equal((await act.execute({}, { deviceId: "d", action: "tap", x: 50, y: 50 })).ok, false, "{} от устройства — не успех");
  assert.deepEqual(calls, ["screen.capture", "input.tap"]);
});
