import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { codeTools } from "../lib/tools/code.mjs";
import { tmp, cfgFor } from "./helpers.mjs";

test("песочница: команды идут через отдельный процесс, без ключей ядра; опасные параметры git отклоняются; без песочницы запуск выключен", async () => {
  const d = tmp(); const ws = path.join(d, "ws"); fs.mkdirSync(ws); const sock = path.join(d, "r.sock");
  const child = spawn(process.execPath, [path.resolve("runner.mjs")], { env: { PATH: process.env.PATH, RUNNER_SOCKET: sock, RUNNER_ROOT: ws }, stdio: "ignore" });
  try {
    for (let i = 0; i < 50 && !fs.existsSync(sock); i++) await new Promise((r) => setTimeout(r, 100));
    process.env.SVETLANA_TEST_SECRET_KEY = "must-not-leak";
    const T = Object.fromEntries(codeTools(cfgFor(d, { runnerSocket: sock, allowHostExec: false })).map((t) => [t.name, t]));
    await T.code_write.execute({}, { path: "env.js", content: "console.log(process.env.SVETLANA_TEST_SECRET_KEY || 'clean', process.cwd())" });
    const r = await T.code_run.execute({}, { command: "node", args: ["env.js"] });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.match(r.data.stdout, /^clean /);
    const g = await T.code_run.execute({}, { command: "git", args: ["-c", "core.sshCommand=touch /tmp/pwn", "status"] }); assert.equal(g.ok, false); assert.match(g.error, /опасный параметр git/);
    const off = Object.fromEntries(codeTools(cfgFor(d, { runnerSocket: "", allowHostExec: false })).map((t) => [t.name, t]));
    assert.match((await off.code_run.execute({}, { command: "node", args: ["env.js"] })).error, /запуск команд выключен/);
    const t0 = Date.now(); const slow = await T.code_run.execute({}, { command: "node", args: ["-e", "setInterval(()=>{},1000)"], timeoutSec: 1 }); assert.equal(slow.data.timedOut, true); assert.ok(Date.now() - t0 < 5000);
  } finally { child.kill(); delete process.env.SVETLANA_TEST_SECRET_KEY; }
});
