// Режим разработчика: команды на Windows (npm.cmd, python), фоновый сервер проекта для просмотра в браузере.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnPlan, resolveWin, safeEnv } from "../runner.mjs";
import { codeTools } from "../lib/tools/code.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sv-dev-"));
const cfgFor = (d, extra = {}) => ({ workspace: path.join(d, "ws"), commandAllow: ["node", "npm", "git", "python3"], allowHostExec: true, runnerSocket: "", ...extra });

test("Windows: npm.cmd через cmd.exe без метасимволов, python3 → python, магазинная заглушка пропускается", () => {
  const files = new Set(["C:\\nodejs\\npm.cmd", "C:\\nodejs\\node.exe", "C:\\Users\\p\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe", "C:\\Py312\\python.exe"]);
  const env = { Path: "C:\\Users\\p\\AppData\\Local\\Microsoft\\WindowsApps;C:\\nodejs;C:\\Py312", PATHEXT: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
  const exists = (f) => files.has(f);
  const npm = spawnPlan("npm", ["install", "my lib"], { platform: "win32", env, exists });
  assert.equal(npm.file, "C:\\Windows\\System32\\cmd.exe"); assert.equal(npm.verbatim, true);
  assert.deepEqual(npm.args.slice(0, 3), ["/d", "/s", "/c"]); assert.equal(npm.args[3], '""C:\\nodejs\\npm.cmd" install "my lib""');
  assert.match(spawnPlan("npm", ["run", "x & calc"], { platform: "win32", env, exists }).error, /опасные/);
  assert.match(spawnPlan("npm", ["%PATH%"], { platform: "win32", env, exists }).error, /опасные/);
  assert.equal(spawnPlan("node", ["-e", "a && b"], { platform: "win32", env, exists }).file, "C:\\nodejs\\node.exe", "exe запускается напрямую, cmd не участвует");
  assert.equal(resolveWin("python3", env, exists).file, "C:\\Py312\\python.exe");
  assert.match(spawnPlan("dotnet", [], { platform: "win32", env, exists }).error, /не найдена/);
  assert.deepEqual(spawnPlan("npm", ["test"], { platform: "linux" }), { file: "npm", args: ["test"] });
  const e = safeEnv("C:\\ws", {}, "win32", { Path: "C:\\x", SystemRoot: "C:\\Windows", SVETLANA_ADMIN_TOKEN: "secret", APPDATA: "C:\\A" });
  assert.equal(e.SVETLANA_ADMIN_TOKEN, undefined, "ключи ядра не попадают в команды"); assert.equal(e.SystemRoot, "C:\\Windows"); assert.equal(e.Path, "C:\\x");
});

test("code_serve: проект запускается в фоне, отдаёт страницу по адресу, останавливается", async () => {
  const d = tmp(); const T = Object.fromEntries(codeTools(cfgFor(d)).map((t) => [t.name, t]));
  await T.code_write.execute({}, { path: "app/index.html", content: "<h1>Привет от Светланы</h1>" });
  await T.code_write.execute({}, { path: "app/serve.js", content: "const h=require('http'),f=require('fs');h.createServer((q,s)=>{s.setHeader('content-type','text/html; charset=utf-8');s.end(f.readFileSync(__dirname+'/index.html'))}).listen(0,'127.0.0.1',function(){console.log('Local: http://localhost:'+this.address().port+'/')})" });
  assert.equal(T.code_serve.confirm(), true, "запуск — только с подтверждением");
  const r = await T.code_serve.execute({}, { command: "node", args: ["serve.js"], cwd: "app" });
  assert.match(r.data.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const html = await (await fetch(r.data.url)).text(); assert.match(html, /Привет от Светланы/);
  assert.equal((await T.code_serve_list.execute({}, {})).data.servers.length, 1);
  assert.match((await T.code_serve.execute({}, { command: "rm", args: ["-rf", "/"] })).error, /не в списке/);
  assert.match((await T.code_serve.execute({}, { command: "node", args: ["-e", "process.exit(3)"] })).error, /завершился \(код 3\)/);
  assert.equal((await T.code_serve_stop.execute({}, { id: r.data.id })).data.stopped, 1);
  await new Promise((s) => setTimeout(s, 300));
  await assert.rejects(fetch(r.data.url), "после остановки страница недоступна");
  const off = Object.fromEntries(codeTools(cfgFor(d, { allowHostExec: false })).map((t) => [t.name, t]));
  assert.match((await off.code_serve.execute({}, { command: "node", args: ["serve.js"], cwd: "app" })).error, /только в локальном режиме/);
});

test("code_run на этой ОС: node и (если есть) npm реально запускаются", async () => {
  const d = tmp(); const T = Object.fromEntries(codeTools(cfgFor(d)).map((t) => [t.name, t]));
  const r = await T.code_run.execute({}, { command: "node", args: ["-e", "console.log('ок ' + process.platform)"] });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.match(r.data.stdout, /ок /);
  const n = await T.code_run.execute({}, { command: "npm", args: ["--version"], timeoutSec: 60 });
  if (!/не найдена|ENOENT/.test(n.error || "")) assert.equal(n.ok, true, JSON.stringify(n)); // npm есть на CI; у пользователя без Node — понятная ошибка
});

test("Windows: путь к .cmd с метасимволами отклоняется, cmd.exe берётся из SystemRoot", () => {
  const env = { Path: "C:\\a&b", PATHEXT: ".CMD", SystemRoot: "C:\\Windows", ComSpec: "C:\\evil.exe" };
  assert.match(spawnPlan("npm", ["test"], { platform: "win32", env, exists: (f) => f === "C:\\a&b\\npm.cmd" }).error, /опасные/);
  const ok = spawnPlan("npm", ["test"], { platform: "win32", env: { ...env, Path: "C:\\Program Files\\nodejs" }, exists: (f) => f === "C:\\Program Files\\nodejs\\npm.cmd" });
  assert.equal(ok.file, "C:\\Windows\\System32\\cmd.exe"); assert.equal(ok.args[3], '""C:\\Program Files\\nodejs\\npm.cmd" test"');
});

test("code_env и code_append: модель знает среду и пишет большие файлы частями; лимит фоновых серверов не обходится параллельно", async () => {
  const d = tmp(); const T = Object.fromEntries(codeTools(cfgFor(d)).map((t) => [t.name, t]));
  const env = await T.code_env.execute({}, {}); assert.equal(env.data.root, path.join(d, "ws")); assert.match(env.data.tools.node, /^v\d+/);
  assert.equal((await T.code_append.execute({}, { path: "big.txt", content: "x" })).ok, false);
  await T.code_write.execute({}, { path: "big.txt", content: "a".repeat(1000) }); await T.code_append.execute({}, { path: "big.txt", content: "b".repeat(1000) });
  assert.equal(fs.readFileSync(path.join(d, "ws", "big.txt"), "utf8").length, 2000);
  const slow = { command: "node", args: ["-e", "setTimeout(()=>{},3000)"] };
  const rs = await Promise.all([1, 2, 3, 4].map(() => T.code_serve.execute({}, slow).catch((e) => ({ ok: false, error: e.message }))));
  assert.ok(rs.some((r) => /уже запущено/.test(r.error || "")), "четвёртый параллельный запуск отклонён");
});
