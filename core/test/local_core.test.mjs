import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
test("локальный режим ПК: ядро стартует на 127.0.0.1, Ollama прописана, ключ устройства выдаётся сам, ws пускает только по нему", () => {
  const out = execFileSync("python3", [path.resolve("test/local_core_check.py")], { encoding: "utf8", env: { ...process.env, SVETLANA_NODE: process.execPath }, timeout: 90000 });
  assert.match(out, /OK/);
});
