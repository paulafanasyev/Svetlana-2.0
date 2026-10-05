import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
test("агент ПК: масштаб Retina, тап только после скриншота, буфер обмена восстанавливается, режим только-просмотр", () => {
  const out = execFileSync("python3", [path.resolve("test/desktop_agent_check.py")], { encoding: "utf8" });
  assert.match(out, /OK/);
});
