import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../lib/app.mjs";
import { calc, searchDocs } from "../lib/tools/brain.mjs";
import { systemFor, toolFilter } from "../lib/agent.mjs";
import { squat } from "./synth-pose.mjs";
import { tmp, cfgFor } from "./helpers.mjs";

const setup = () => { const cfg = cfgFor(tmp()); const a = createApp(cfg); const put = (f, x) => { const p = path.join(cfg.workspace, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify({ frames: x })); };
  return { a, put, cfg, r: (n, x) => a.registry.run(a.registry.get(n), x, {}), x: (n, x) => a.registry.get(n).execute({}, x) }; };

test("новое упражнение из эталонной записи: создать, распознать, оценить, выгрузить пакет для приложения", async () => {
  const { put, x, r, cfg } = setup();
  put("pico/uploads/ref.json", squat({ reps: 4 })); put("pico/uploads/good.json", squat({ reps: 6 })); put("pico/uploads/bad.json", squat({ reps: 5, depth: 0.5 })); put("pico/uploads/arms.json", squat({ reps: 5, arms: 1 }));
  const c = await x("exercise_template_create", { name: "Присед с руками", kind: "reps", file: "pico/uploads/ref.json", norms: [5, 8, 10] });
  assert.equal(c.data.id, "присед_с_руками"); assert.equal(c.data.primary.startsWith("knee"), true);
  const good = await r("exercise_evaluate", { exerciseId: c.data.id, file: "pico/uploads/good.json", age: 8 });
  assert.equal(good.data.reps, 6); assert.ok(good.data.total >= 85, `хорошая попытка: ${good.data.total}`); assert.equal(good.data.target, 8);
  const bad = await r("exercise_evaluate", { exerciseId: c.data.id, file: "pico/uploads/bad.json", age: 8 });
  assert.ok(bad.data.total < good.data.total - 30); assert.match(bad.data.topErrors.join(" "), /глубже|шире/);
  const arms = await r("exercise_evaluate", { exerciseId: c.data.id, file: "pico/uploads/arms.json" });
  assert.match(arms.data.topErrors.join(" "), /локоть/);
  const pack = await r("exercise_pack_export", {}); assert.equal(pack.data.count, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfg.workspace, "pico/exercises.json"), "utf8")).exercises[0].kind, "reps");
  assert.equal((await x("exercise_template_create", { name: "Пусто", kind: "reps", file: "../../etc/passwd" })).ok, false);
});
test("калькулятор репетитора: верно считает и не исполняет посторонний код", async () => {
  assert.equal(calc("(12 + 8) × 3 ÷ 4"), 15); assert.equal(calc("2^3^2"), 512); assert.equal(calc("-3 + 5"), 2);
  assert.throws(() => calc("process.exit()")); assert.throws(() => calc("1/0"));
  const { r } = setup(); const m = await r("math_check", { expression: "7 × 8", answer: "54" });
  assert.equal(m.data.correct, false); assert.equal(m.data.value, 56);
});
test("справочник продуктов находит нужный раздел с источником", () => {
  assert.equal(searchDocs("как оформить возврат", "aiko")[0].id, "aiko-07");
  assert.equal(searchDocs("как сделать договор", "selfemployed")[0].id, "selfemployed-05");
  assert.equal(searchDocs("добавить новое упражнение по видео")[0].id, "pico-05");
  assert.equal(searchDocs("как добавить инструмент в ядро")[0].id, "svetlana-02");
});
test("режим Пико: детский промпт и только детские инструменты", () => {
  const { a } = setup();
  const names = a.registry.forModel(toolFilter("pico")).map((t) => t.function.name).sort();
  assert.deepEqual(names, ["exercise_evaluate", "exercise_templates", "math_check", "workout_analyze", "workout_plan"]);
  assert.match(systemFor(new Date(), "Europe/Moscow", "pico"), /НИКОГДА не давай готовый ответ/);
  assert.equal(a.registry.forModel(toolFilter("pavel")).length, a.registry.list().length);
});
