// Кодинг: работа только внутри рабочей папки (SVETLANA_WORKSPACE). Запись и команды — после подтверждения.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { runSandboxed, checkArgs } from "../../runner.mjs";

const MAX_READ = 200_000;
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__", ".gradle"]);

export function safePath(root, rel) {
  if (typeof rel !== "string" || rel.includes("\0")) throw new Error("некорректный путь");
  const abs = path.resolve(root, rel || ".");
  let base = abs; const rest = [];
  while (!fs.existsSync(base)) { rest.unshift(path.basename(base)); base = path.dirname(base); }
  const real = path.join(fs.realpathSync(base), ...rest);
  const rootReal = fs.realpathSync(root);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error("путь вне рабочей папки — запрещено");
  return real;
}

async function walk(dir, root, depth, out, limit) {
  if (out.length >= limit) return;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name); const rel = path.relative(root, p);
    if (e.isDirectory()) { out.push(rel + "/"); if (depth > 0) await walk(p, root, depth - 1, out, limit); }
    else if (e.isFile()) out.push(rel);
    if (out.length >= limit) return;
  }
}

export function runProcess(cmd, args, { cwd, timeoutMs = 120000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env, CI: "1" }, shell: false });
    let out = "", err = "", killed = false;
    const cap = (s, d) => (s.length > 60000 ? s : s + d);
    child.stdout.on("data", (d) => { out = cap(out, d.toString()); });
    child.stderr.on("data", (d) => { err = cap(err, d.toString()); });
    const t = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, stdout: out, stderr: String(e.message), timedOut: false }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code, stdout: out.slice(-20000), stderr: err.slice(-20000), timedOut: killed }); });
  });
}

export function codeTools(cfg) {
  const root = cfg.workspace; fs.mkdirSync(root, { recursive: true });
  const P = (rel) => safePath(root, rel);
  return [
    { name: "code_list", domain: "code", risk: "read", taints: true, description: "Показать файлы и папки в рабочей папке проекта.",
      parameters: { type: "object", properties: { path: { type: "string", maxLength: 500 }, depth: { type: "integer", minimum: 0, maximum: 6 } }, additionalProperties: false },
      async execute(_c, a) { const out = []; await walk(P(a.path || "."), root, a.depth ?? 2, out, 800); return { data: { files: out, truncated: out.length >= 800 }, summary: `Файлов и папок: ${out.length}`, untrusted: true }; } },
    { name: "code_read", domain: "code", risk: "read", taints: true, description: "Прочитать файл (с номерами строк). Можно диапазон строк.",
      parameters: { type: "object", properties: { path: { type: "string", maxLength: 500 }, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } }, required: ["path"], additionalProperties: false },
      async execute(_c, a) {
        const f = P(a.path); const st = await fsp.stat(f); if (!st.isFile()) throw new Error("это не файл");
        const text = (await fsp.readFile(f, "utf8")).slice(0, MAX_READ); const lines = text.split("\n");
        const s = (a.startLine || 1) - 1, e = Math.min(lines.length, a.endLine || lines.length);
        return { untrusted: true, data: { path: a.path, totalLines: lines.length, text: lines.slice(s, e).map((l, i) => `${s + i + 1}| ${l}`).join("\n") }, summary: `${a.path}: строки ${s + 1}–${e} из ${lines.length}` };
      } },
    { name: "code_search", domain: "code", risk: "read", taints: true, description: "Найти текст или регулярное выражение по файлам проекта.",
      parameters: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 300 }, regex: { type: "boolean" }, path: { type: "string", maxLength: 500 } }, required: ["query"], additionalProperties: false },
      async execute(_c, a) {
        const files = []; await walk(P(a.path || "."), root, 12, files, 5000);
        const re = a.regex ? new RegExp(a.query, "i") : null; const hits = [];
        for (const rel of files) {
          if (rel.endsWith("/")) continue;
          const f = path.join(root, rel); const st = await fsp.stat(f); if (st.size > 1_000_000) continue;
          const lines = (await fsp.readFile(f, "utf8").catch(() => "")).split("\n");
          lines.forEach((l, i) => { if (hits.length < 200 && (re ? re.test(l) : l.toLowerCase().includes(a.query.toLowerCase()))) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 200)}`); });
          if (hits.length >= 200) break;
        }
        return { data: { hits }, summary: `Совпадений: ${hits.length}`, untrusted: true };
      } },
    { name: "code_write", domain: "code", risk: "write", description: "Создать или полностью перезаписать файл в проекте.",
      parameters: { type: "object", properties: { path: { type: "string", minLength: 1, maxLength: 500 }, content: { type: "string", maxLength: 400000 } }, required: ["path", "content"], additionalProperties: false },
      async execute(_c, a) { const f = P(a.path); await fsp.mkdir(path.dirname(f), { recursive: true }); const existed = fs.existsSync(f); await fsp.writeFile(f, a.content); const back = await fsp.readFile(f, "utf8");
        return { ok: back === a.content, data: { path: a.path, bytes: Buffer.byteLength(a.content), created: !existed }, summary: `${existed ? "Перезаписан" : "Создан"} ${a.path} (${Buffer.byteLength(a.content)} байт), проверено чтением` }; } },
    { name: "code_edit", domain: "code", risk: "write", description: "Точечная правка: заменить фрагмент find на replace (фрагмент должен встречаться ровно один раз).",
      parameters: { type: "object", properties: { path: { type: "string", maxLength: 500 }, find: { type: "string", minLength: 1, maxLength: 100000 }, replace: { type: "string", maxLength: 100000 } }, required: ["path", "find", "replace"], additionalProperties: false },
      async execute(_c, a) {
        const f = P(a.path); const s = await fsp.readFile(f, "utf8"); const n = s.split(a.find).length - 1;
        if (n !== 1) return { ok: false, error: n === 0 ? "фрагмент не найден" : `фрагмент встречается ${n} раз — уточните` };
        const out = s.replace(a.find, () => a.replace); await fsp.writeFile(f, out);
        return { data: { path: a.path }, summary: `Правка в ${a.path} применена` };
      } },
    { name: "code_run", domain: "code_run", risk: "dangerous", description: `Запустить команду в проекте (без shell). Разрешены: ${cfg.commandAllow.join(", ")}. Таймаут до 10 минут.`,
      parameters: { type: "object", properties: { command: { type: "string", maxLength: 40 }, args: { type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 60 }, cwd: { type: "string", maxLength: 500 }, timeoutSec: { type: "integer", minimum: 1, maximum: 600 } }, required: ["command"], additionalProperties: false },
      confirm: () => true, // команды — всегда только с подтверждением, без «разрешить на сессию»
      async execute(_c, a) {
        if (!cfg.commandAllow.includes(a.command)) return { ok: false, error: `команда «${a.command}» не в списке разрешённых (SVETLANA_COMMAND_ALLOW)` };
        const bad = checkArgs(a.command, a.args || []); if (bad) return { ok: false, error: bad };
        const cwd = P(a.cwd || "."); const timeoutMs = (a.timeoutSec || 120) * 1000;
        let r;
        if (cfg.runnerSocket) r = await viaRunner(cfg.runnerSocket, { command: a.command, args: a.args || [], cwd: path.relative(fs.realpathSync(root), cwd), timeoutSec: a.timeoutSec || 120 });
        else if (cfg.allowHostExec) r = await runSandboxed({ command: a.command, args: a.args || [], cwd, timeoutMs, root: fs.realpathSync(root) }); // без ключей ядра в окружении
        else return { ok: false, error: "запуск команд выключен: включите песочницу (SVETLANA_RUNNER_SOCKET, сервис runner в docker-compose) или явно SVETLANA_ALLOW_HOST_EXEC=1" };
        if (r.error) return { ok: false, error: r.error };
        return { ok: r.code === 0, data: r, summary: r.timedOut ? "Остановлено по таймауту" : `Код выхода ${r.code}`, error: r.code === 0 ? undefined : (r.stderr || r.stdout).slice(-2000), untrusted: true };
      } },
  ];
}

function viaRunner(socketPath, q) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: "/run", method: "POST", headers: { "Content-Type": "application/json" }, timeout: (q.timeoutSec + 30) * 1000 }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({ error: "песочница ответила не JSON" }); } });
    });
    req.on("error", (e) => resolve({ error: "песочница недоступна: " + e.message })); req.end(JSON.stringify(q));
  });
}
