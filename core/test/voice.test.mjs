import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { DeviceHub } from "../lib/devices.mjs";
import { installVoice, voiceOk, VOICE_RATE } from "../lib/voice.mjs";

class MemStore {
  constructor() { this.t = {}; this.n = 0; }
  all(k) { return this.t[k] ||= []; }
  insert(k, row) { const r = { id: "id" + ++this.n, ...row }; this.all(k).push(r); return r; }
  get(k, id) { return this.all(k).find((r) => r.id === id) || null; }
  update(k, id, patch) { const r = this.get(k, id); if (r) Object.assign(r, patch); return r; }
  remove(k, id) { const a = this.all(k); const i = a.findIndex((r) => r.id === id); if (i >= 0) a.splice(i, 1); return i >= 0; }
}
class FakeWs extends EventEmitter { constructor() { super(); this.out = []; } send(s) { this.out.push(JSON.parse(s)); } close() {} }
const tick = () => new Promise((r) => setTimeout(r, 10));

function setup(agent) {
  const store = new MemStore(); const hub = new DeviceHub(store);
  installVoice(hub, { agent, store });
  const { deviceId } = hub.pair("Ноутбук", "windows"); const ws = new FakeWs();
  hub.attach(store.get("devices", deviceId), ws);
  return { store, hub, ws, deviceId };
}
const hello = (ws, caps) => ws.emit("message", JSON.stringify({ type: "hello", platform: "windows", name: "Ноутбук", capabilities: caps }));
const replies = (ws) => ws.out.filter((m) => m.type === "reply");

test("голос: без доступа voice — отказ, мозг не вызывается", async () => {
  let called = 0; const { ws } = setup({ chat: async () => { called++; return {}; } });
  hello(ws, ["screen"]); ws.emit("message", JSON.stringify({ type: "say", reqId: "r1", text: "привет" })); await tick();
  assert.equal(called, 0); assert.match(replies(ws)[0].error, /не включено/); assert.equal(replies(ws)[0].reqId, "r1");
});

test("голос: свой разговор у устройства, deviceId в подсказке, reset начинает заново", async () => {
  const seen = []; let n = 0;
  const { ws, store, deviceId } = setup({ chat: async (a) => { seen.push(a); return { conversationId: a.conversationId || "c" + ++n, answer: "Ок", pending: [] }; } });
  hello(ws, ["screen", "voice"]);
  ws.emit("message", JSON.stringify({ type: "say", reqId: "a", text: "сколько я заработал", conversationId: "ЧУЖОЙ" })); await tick();
  ws.emit("message", JSON.stringify({ type: "say", reqId: "b", text: "а в августе?" })); await tick();
  assert.equal(seen[0].conversationId, undefined, "чужой conversationId от устройства игнорируется");
  assert.equal(seen[1].conversationId, "c1"); assert.match(seen[0].text, new RegExp(`deviceId: ${deviceId}`));
  assert.equal(store.get("devices", deviceId).voiceConv, "c1");
  ws.emit("message", JSON.stringify({ type: "say", reqId: "c", text: "", reset: true })); await tick();
  assert.equal(store.get("devices", deviceId).voiceConv, null);
  assert.deepEqual(replies(ws).map((r) => r.answer), ["Ок", "Ок", "Хорошо, начинаем заново."]);
});

test("голос: подтверждение — действие на этом ПК да, деньги/код только в приложении", async () => {
  let decided = null; let mode = "device";
  const agent = {
    chat: async () => ({ conversationId: "c1", answer: "Нужно подтверждение.", pending: mode === "device"
      ? [{ callId: "k1", token: "t1", tool: "device_act", risk: "dangerous", title: "на устройстве: tap", args: { deviceId: ctx.deviceId } }]
      : [{ callId: "k2", token: "t2", tool: "acc_income_add", risk: "external", title: "записать доход", args: {} }] }),
    confirm: async (a) => { decided = a; return { conversationId: "c1", answer: a.decisions[0].approve ? "Сделала." : "Отменила.", pending: [] }; },
  };
  const ctx = setup(agent); const { ws } = ctx; hello(ws, ["voice", "control"]);
  ws.emit("message", JSON.stringify({ type: "say", reqId: "1", text: "нажми кнопку" })); await tick();
  assert.equal(replies(ws)[0].pending[0].voice, true);
  ws.emit("message", JSON.stringify({ type: "confirm", reqId: "2", approve: true })); await tick();
  assert.equal(decided.decisions[0].approve, true); assert.equal(decided.decisions[0].token, "t1"); assert.equal(replies(ws)[1].answer, "Сделала.");
  mode = "money";
  ws.emit("message", JSON.stringify({ type: "say", reqId: "3", text: "запиши доход" })); await tick();
  assert.equal(replies(ws)[2].pending[0].voice, false);
  ws.emit("message", JSON.stringify({ type: "confirm", reqId: "4", approve: true })); await tick();
  assert.equal(decided.decisions[0].approve, false, "деньги голосом не подтверждаются");
  assert.match(replies(ws)[3].answer, /только в приложении/);
  ws.emit("message", JSON.stringify({ type: "confirm", reqId: "5", approve: true })); await tick();
  assert.equal(replies(ws)[4].answer, "Нечего подтверждать.");
});

test("голос: чужое устройство в device_act голосом не подтверждается", () => {
  assert.equal(voiceOk({ tool: "device_act", risk: "dangerous", args: { deviceId: "other" } }, "me"), false);
  assert.equal(voiceOk({ tool: "code_run", risk: "dangerous", args: {} }, "me"), false);
  assert.equal(voiceOk({ tool: "crm_add", risk: "write", args: {} }, "me"), true);
});

test("голос: лимит фраз в минуту и ответы по одной", async () => {
  let active = 0, maxActive = 0;
  const { ws } = setup({ chat: async () => { active++; maxActive = Math.max(maxActive, active); await tick(); active--; return { conversationId: "c", answer: "ок", pending: [] }; } });
  hello(ws, ["voice"]);
  for (let i = 0; i < VOICE_RATE + 3; i++) ws.emit("message", JSON.stringify({ type: "say", reqId: "q" + i, text: "раз" }));
  await new Promise((r) => setTimeout(r, 400));
  const rs = replies(ws);
  assert.equal(rs.filter((r) => r.error).length, 3); assert.equal(rs.filter((r) => r.answer).length, VOICE_RATE); assert.equal(maxActive, 1);
});

test("голос на ПК: офлайн-команды и голосовой цикл (python)", () => {
  const out = execFileSync("python3", [path.resolve("test/voice_check.py")], { encoding: "utf8" });
  assert.match(out, /OK/);
});
