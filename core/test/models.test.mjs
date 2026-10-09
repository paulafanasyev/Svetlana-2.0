import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
test("офлайн-модели ПК: каталог, скачивание через Ollama с процентами и отменой, зрение модели определяется", () => {
  const out = execFileSync("python3", [path.resolve("test/models_check.py")], { encoding: "utf8", timeout: 60000 });
  assert.match(out, /OK/);
});
