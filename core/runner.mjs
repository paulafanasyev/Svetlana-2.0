#!/usr/bin/env node
// Песочница команд Светланы. На сервере запускается ОТДЕЛЬНЫМ контейнером: видит только /workspace, без ключей и данных ядра,
// по умолчанию без сети. Слушает unix-сокет в общем томе; ядро шлёт {command,args,cwd,timeoutSec}.
//   docker compose up -d runner   (см. docker-compose.yml)
// На Windows (локальный режим «всё на этом ПК») команды идут прямо на компьютере владельца, каждая — после его подтверждения:
// npm/npx и прочие .cmd запускаются через cmd.exe без метасимволов, python3 → python/py, дерево процессов гасится taskkill.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const DENY_GIT = /^(-c|--config-env|--exec-path|--upload-pack|--receive-pack|-u|--template|--git-dir|--work-tree)(=|$)/;
export function checkArgs(command, args) {
  if (command === "git" && args.some((a) => DENY_GIT.test(a) || /core\.(sshCommand|hooksPath|fsmonitor|pager|editor)|credential\.helper/i.test(a))) return "опасный параметр git";
  return null;
}

const WIN_ALIAS = { python3: ["python", "py", "python3"], python: ["python", "py"], pip: ["pip", "py"], pytest: ["pytest", "py"] };
const WIN_ALIAS_ARGS = { py: { pip: ["-m", "pip"], pytest: ["-m", "pytest"] } };
const WIN_ENV = ["SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
  "ProgramData", "CommonProgramFiles", "HOMEDRIVE", "HOMEPATH", "USERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"];
const CMD_META = /[&|<>^%!"\r\n]/;

const envGet = (env, k) => env[k] ?? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())];

/** Найти программу на Windows по PATH и PATHEXT (без shell). Магазинную заглушку python из WindowsApps пропускаем. */
export function resolveWin(name, env = process.env, exists = fs.existsSync) {
  const dirs = String(envGet(env, "Path") || "").split(";").filter(Boolean);
  const exts = String(envGet(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const alias of WIN_ALIAS[name] || [name]) {
    for (const d of dirs) {
      if (/^py(thon3?)?$/i.test(alias) && /\\WindowsApps\\?$/i.test(d)) continue;
      for (const e of exts) { const f = path.win32.join(d, alias + e.toLowerCase()); if (exists(f)) return { file: f, alias }; }
    }
  }
  return null;
}

/** Как запустить команду: {file, args, verbatim} или {error}. На Linux/macOS — как есть. */
export function spawnPlan(command, args = [], { platform = process.platform, env = process.env, exists } = {}) {
  if (platform !== "win32") return { file: command, args };
  const r = resolveWin(command, env, exists);
  if (!r) return { error: `программа «${command}» не найдена на этом компьютере — установите её (например, Node.js с nodejs.org, Python с python.org, Git с git-scm.com)` };
  const full = [...(WIN_ALIAS_ARGS[r.alias]?.[command] || []), ...args];
  if (/\.(cmd|bat)$/i.test(r.file)) { // .cmd без shell Node запускать не даёт — идём через cmd.exe, но без метасимволов
    if (CMD_META.test(r.file)) return { error: `путь к программе «${r.file.slice(0, 120)}» содержит символы, опасные для командной строки Windows — переустановите её в обычную папку` };
    const bad = full.find((a) => CMD_META.test(a));
    if (bad !== undefined) return { error: `в аргументе «${String(bad).slice(0, 60)}» есть символы, опасные для командной строки Windows (& | < > ^ % ! ")` };
    const q = (s) => (s === "" || /\s/.test(s) ? `"${s}"` : s);
    const sysroot = envGet(env, "SystemRoot") || "C:\\Windows"; // только настоящий cmd.exe, не подменённый ComSpec
    return { file: path.win32.join(sysroot, "System32", "cmd.exe"), args: ["/d", "/s", "/c", `"${[`"${r.file}"`, ...full.map(q)].join(" ")}"`], verbatim: true };
  }
  return { file: r.file, args: full };
}

/** Окружение команды: без ключей и настроек ядра. */
export function safeEnv(root, extra = {}, platform = process.platform, src = process.env) {
  const base = { CI: "1", npm_config_ignore_scripts: "true", npm_config_update_notifier: "false", ...extra };
  if (platform !== "win32") return { PATH: src.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: root, LANG: "C.UTF-8", ...base };
  const e = { Path: envGet(src, "Path") || "", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...base };
  for (const k of WIN_ENV) { const v = envGet(src, k); if (v !== undefined) e[k] = v; }
  return e;
}

/** Погасить процесс со всеми потомками. */
export function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") { try { spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { /* уже */ } return; }
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* уже */ } }
}

/** Запустить процесс по плану: {child} или {error}. */
export function spawnSafe({ command, args = [], cwd, root, env }) {
  const plan = spawnPlan(command, args);
  if (plan.error) return { error: plan.error };
  const win = process.platform === "win32";
  try {
    const child = spawn(plan.file, plan.args, { cwd, shell: false, detached: !win, windowsHide: true, windowsVerbatimArguments: Boolean(plan.verbatim), env: safeEnv(root, env) });
    return { child };
  } catch (e) { return { error: String(e.message || e) }; }
}

export function runSandboxed({ command, args = [], cwd, timeoutMs, root, env }) {
  return new Promise((resolve) => {
    const s = spawnSafe({ command, args, cwd, root, env });
    if (s.error) return resolve({ code: -1, stdout: "", stderr: s.error, timedOut: false, error: s.error });
    const child = s.child;
    let out = "", err = "", killed = false;
    child.stdout.on("data", (d) => { if (out.length < 200000) out += d; });
    child.stderr.on("data", (d) => { if (err.length < 200000) err += d; });
    const t = setTimeout(() => { killed = true; killTree(child); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, stdout: out, stderr: String(e.message), timedOut: false }); });
    child.on("close", (code) => { clearTimeout(t); if (process.platform !== "win32") killTree(child); resolve({ code, stdout: out.slice(-20000), stderr: err.slice(-20000), timedOut: killed }); }); // добиваем фоновых потомков
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const SOCK = process.env.RUNNER_SOCKET || "/sock/runner.sock"; const ROOT = fs.realpathSync(process.env.RUNNER_ROOT || "/workspace");
  const ALLOW = (process.env.SVETLANA_COMMAND_ALLOW || "node,npm,npx,git,python3,pytest,ls,cat,tsc,eslint,vitest").split(",");
  try { fs.unlinkSync(SOCK); } catch { /* нет */ }
  http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      const send = (s, o) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      try {
        const q = JSON.parse(b); if (!ALLOW.includes(q.command)) return send(400, { error: "команда не разрешена" });
        const bad = checkArgs(q.command, q.args || []); if (bad) return send(400, { error: bad });
        let cwd = path.resolve(ROOT, q.cwd || "."); try { cwd = fs.realpathSync(cwd); } catch { return send(400, { error: "нет такой папки" }); } // ссылки/junction наружу не пускаем
        if (cwd !== ROOT && !cwd.startsWith(ROOT + path.sep)) return send(400, { error: "вне рабочей папки" });
        send(200, await runSandboxed({ command: q.command, args: q.args || [], cwd, timeoutMs: Math.min(600, q.timeoutSec || 120) * 1000, root: ROOT }));
      } catch (e) { send(500, { error: String(e.message) }); }
    });
  }).listen(SOCK, () => { fs.chmodSync(SOCK, 0o660); console.log("песочница слушает", SOCK, "· корень", ROOT); });
}
