import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../lib/app.mjs";
import { computeScore, searchKnowledge } from "../lib/tools/life.mjs";
import { tmp, cfgFor } from "./helpers.mjs";

const app = () => createApp(cfgFor(tmp()));
test("календарь: добавить, найти за период, предупредить о накладке, выгрузить .ics, удалить", async () => {
  const a = app(), r = (n, x) => a.registry.run(a.registry.get(n), x, {});
  assert.equal((await r("calendar_add", { title: "Звонок", start: "2026-10-06T25:00" })).ok, false);
  const e = await r("calendar_add", { title: "Звонок Ивану", start: "2026-10-06T10:00" });
  assert.equal(e.ok, true);
  assert.match((await r("calendar_add", { title: "Стоматолог", start: "2026-10-06T10:00" })).summary, /уже есть: Звонок Ивану/);
  assert.equal((await r("calendar_list", { from: "2026-10-06", to: "2026-10-06" })).data.length, 2);
  assert.match((await r("calendar_export", {})).data.ics, /DTSTART:20261006T100000[\s\S]*TRIGGER:-PT15M/);
  assert.equal((await a.registry.get("calendar_remove").execute({}, { eventId: e.data.id })).ok, undefined);
  assert.equal((await r("calendar_list", { from: "2026-10-01", to: "2026-10-31" })).data.length, 1);
});
test("база знаний отвечает с источником и честно молчит, если не знает", async () => {
  assert.equal(searchKnowledge("какая ставка налога для самозанятых с физлиц")[0].id, "npd-rates");
  assert.equal(searchKnowledge("до какого числа платить налог")[0].id, "npd-period");
  assert.equal(searchKnowledge("лимит дохода в год")[0].id, "npd-limit");
  const a = app(); assert.equal((await a.registry.run(a.registry.get("knowledge_search"), { query: "квантовая гравитация" }, {})).ok, false);
});
test("зарядка: формулы совпадают с ya-zaryadka-ai", async () => {
  const s = computeScore([{ amp: 80, form: 90, dur: 1000 }, { amp: 80, form: 90, dur: 1000 }, { amp: 80, form: 90, dur: 1000 }]);
  assert.deepEqual(s, { accuracy: 90, precision: 80, consistency: 100, total: 90, reps: 3 });
  const a = app(); const r = await a.registry.run(a.registry.get("workout_analyze"), { exercise: "squat", age: 8, reps: [{ amp: 50, form: 60, dur: 900 }], errors: ["shallow", "shallow", "tilt"] }, {});
  assert.equal(r.data.target, 8); assert.equal(r.data.topErrors[0].code, "shallow");
  const p = await a.registry.run(a.registry.get("workout_plan"), { program: "morning", age: 5 }, {});
  assert.equal(p.data.exercises.length, 5);
});
test("список доходов за период без отменённых", async () => {
  const a = app(); const add = (x) => a.store.insert("incomes", { payer: "individual", service: "x", ...x });
  add({ amount: 100, date: "2026-10-01" }); add({ amount: 200, date: "2026-10-02", cancelled: true }); add({ amount: 300, date: "2026-11-01" });
  const r = await a.registry.run(a.registry.get("acc_incomes_list"), { from: "2026-10-01", to: "2026-10-31" }, {});
  assert.equal(r.data.length, 1); assert.equal(r.data[0].amount, 100);
});
