#!/usr/bin/env node
// Песочница команд Светланы. Запускается ОТДЕЛЬНЫМ контейнером: видит только /workspace, без ключей и данных ядра,
// по умолчанию без сети. Слушает unix-сокет в общем томе; ядро шлёт {command,args,cwd,timeoutSec}.
//   docker compose up -d runner   (см. docker-compose.yml)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const DENY_GIT = /^(-c|--config-env|--exec-path|--upload-pack|--receive-pack|-u|--template|--git-dir|--work-tree)(=|$)/;
export function checkArgs(command, args) {
  if (command === "git" && args.some((a) => DENY_GIT.test(a) || /core\.(sshCommand|hooksPath|fsmonitor|pager|editor)|credential\.helper/i.test(a))) return "опасный параметр git";
  return null;
}
export function runSandboxed({ command, args = [], cwd, timeoutMs, root, env }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, detached: true,
      env: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: root, LANG: "C.UTF-8", CI: "1", npm_config_ignore_scripts: "true", npm_config_update_notifier: "false", ...env } });
    let out = "", err = "", killed = false;
    child.stdout.on("data", (d) => { if (out.length < 200000) out += d; });
    child.stderr.on("data", (d) => { if (err.length < 200000) err += d; });
    const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* уже */ } } };
    const t = setTimeout(() => { killed = true; kill(); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, stdout: out, stderr: String(e.message), timedOut: false }); });
    child.on("close", (code) => { clearTimeout(t); kill(); resolve({ code, stdout: out.slice(-20000), stderr: err.slice(-20000), timedOut: killed }); }); // kill: добиваем фоновых потомков
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
        const cwd = path.resolve(ROOT, q.cwd || "."); if (cwd !== ROOT && !cwd.startsWith(ROOT + path.sep)) return send(400, { error: "вне рабочей папки" });
        send(200, await runSandboxed({ command: q.command, args: q.args || [], cwd, timeoutMs: Math.min(600, q.timeoutSec || 120) * 1000, root: ROOT }));
      } catch (e) { send(500, { error: String(e.message) }); }
    });
  }).listen(SOCK, () => { fs.chmodSync(SOCK, 0o660); console.log("песочница слушает", SOCK, "· корень", ROOT); });
}
