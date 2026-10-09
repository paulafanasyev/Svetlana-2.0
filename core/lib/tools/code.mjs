// Кодинг: работа только внутри рабочей папки (SVETLANA_WORKSPACE). Запись и команды — после подтверждения.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import { runSandboxed, checkArgs, spawnSafe, killTree } from "../../runner.mjs";

const MAX_READ = 200_000;
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__", ".gradle"]);
const MAX_SERVERS = 3;
/** Что даже в «режиме разработки» спрашиваем отдельно: код из строки, выход из папки проектов, публикация и учётные данные. */
const PY_INLINE = /^-(?!-)[a-zA-Z]*[ci]/; // -c, -i и слитые -Bc"…", -icprint(1)
const INLINE = { node: /^-[epric]$|^--(eval|print|interactive|require|import|loader|experimental-loader|run|env-file|inspect)/, python: PY_INLINE, python3: PY_INLINE, py: PY_INLINE };
const OUTSIDE = /^[a-zA-Z]:|^[\\/]|(^|[\\/=])\.\.([\\/]|$)|^~|^--(prefix|cwd|global|location|userconfig|globalconfig|git-dir|work-tree)(=|$)|^-(g|C)$/;
const SUBCMD = { git: /^(push|remote|config|credential|submodule|filter-branch|daemon|send-email|clone|fetch|pull)$/, npm: /^(publish|unpublish|login|logout|adduser|token|owner|access|config|exec|x|deprecate|dist-tag|link)$/, dotnet: /^(nuget|tool)$/ };
/** npx без клика — только известные инструменты сборки; любой другой пакет из интернета — с подтверждением. */
const NPX_OK = /^(create-vite|vite|create-react-app|create-next-app|next|tsc|typescript|eslint|prettier|vitest|jest|serve|http-server|nodemon|tailwindcss|@tailwindcss\/cli|electron|electron-builder)(@[\w.^~-]+)?$/;
export function devRisky(a) {
  const args = a.args || [];
  if (["npm", "npx"].includes(a.command) && args.some((x) => /ignore-scripts|scripts-prepend|script-shell|node-options|userconfig|globalconfig|registry/i.test(x))) return "настройки npm";
  if (INLINE[a.command] && args.some((x) => INLINE[a.command].test(x))) return "код из строки";
  if (args.some((x) => OUTSIDE.test(x))) return "путь вне папки проектов";
  const sub = args.find((x) => !x.startsWith("-"));
  if (SUBCMD[a.command] && sub && SUBCMD[a.command].test(sub)) return "публикация/учётные данные";
  if (a.command === "npx") { const pkg = args.find((x) => !x.startsWith("-")); if (!pkg || !NPX_OK.test(pkg) || args.some((x) => /^(-p|--package)(=|$)/.test(x))) return "пакет из интернета через npx"; }
  // pip: новые пакеты из интернета (их установка может выполнять код) — с подтверждением; -r requirements.txt проекта — можно
  const pipArgs = a.command === "pip" ? args : ["python", "python3", "py"].includes(a.command) && args[0] === "-m" && args[1] === "pip" ? args.slice(2) : null;
  if (pipArgs && pipArgs[0] !== "list" && pipArgs[0] !== "show" && pipArgs[0] !== "freeze" && !(pipArgs[0] === "install" && pipArgs.slice(1).every((x, i, all) => x === "-r" || (all[i] !== "-r" && all[i - 1] === "-r" && !/:/.test(x)) || x === "--upgrade" || x === "-U")))
    return "установка пакетов pip";
  return null;
}
const devAutoCmd = (a) => !devRisky(a);
/** Чужой код в проекте (зависимости): его текст — внешние данные, после чтения режим разработки снова спрашивает. */
export const FOREIGN_MARK = ".svetlana-foreign"; // кладём в папку, скачанную git clone: её содержимое — внешние данные
export const FOREIGN = /(^|[\\/])(node_modules|\.venv|venv|env|site-packages|vendor|__pypackages__|bower_components)([\\/]|$)/i;

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{4,5})(?!\d)/i;

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

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, "127.0.0.1"); const done = (v) => { s.destroy(); resolve(v); };
  s.once("connect", () => done(true)); s.once("error", () => done(false)); s.setTimeout(500, () => done(false));
});

/** Фоновые dev-серверы проектов (просмотр приложения в браузере). Живут, пока живёт ядро. */
const servers = new Map(); let nextId = 1; let starting = 0; // starting — места, занятые запусками, которые ещё ждут порт
/** Просмотр простых веб-проектов (HTML/CSS/JS без сборки) — свой маленький сервер на 127.0.0.1, работает и на телефоне, где команд нет.
 *  Отдельный порт = отдельный источник: страница проекта не видит API Светланы (cookie HttpOnly, POST без нашего Origin отклоняется). */
const previews = new Map(); let nextPreview = 1;
const PMIME = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2" };
function startPreview(dir, rootReal) {
  for (const p of previews.values()) if (p.dir === dir) return Promise.resolve(p);
  if (previews.size >= MAX_SERVERS) { const [oldest] = previews.keys(); previews.get(oldest).server.close(); previews.delete(oldest); }
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, "http://x"); const parts = u.pathname.split("/"); // /<секрет>/путь
        if (parts[1] !== rec.key) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Нет такого файла"); }
        let rel = decodeURIComponent(parts.slice(2).join("/")) || "index.html";
        let f = path.resolve(dir, rel);
        if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
        const real = fs.existsSync(f) ? fs.realpathSync(f) : "";
        if (!real || !(real === dir || real.startsWith(dir + path.sep)) || !real.startsWith(rootReal + path.sep) || !fs.statSync(real).isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Нет такого файла"); }
        res.writeHead(200, { "Content-Type": PMIME[path.extname(real).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
        fs.createReadStream(real).pipe(res);
      } catch { res.writeHead(400); res.end(); }
    });
    const rec = { id: "p" + nextPreview++, dir, server, port: 0, key: crypto.randomBytes(16).toString("hex") };
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { rec.port = server.address().port; previews.set(rec.id, rec); resolve(rec); });
  });
}
const stopAll = () => { for (const s of servers.values()) killTree(s.child); servers.clear(); for (const p of previews.values()) p.server.close(); previews.clear(); };
process.once("exit", stopAll);
for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { stopAll(); process.exit(0); });

export function codeTools(cfg) {
  const root = cfg.workspace; fs.mkdirSync(root, { recursive: true });
  const P = (rel) => safePath(root, rel);
  /** По настоящему пути (после ссылок): зависимости или скачанное git clone — чужое. */
  const isForeign = (rel) => {
    let f; try { f = P(rel || "."); } catch { return true; }
    const rootReal = fs.realpathSync(root); const r = path.relative(rootReal, f);
    if (FOREIGN.test(r)) return true;
    for (let d = fs.existsSync(f) && fs.statSync(f).isDirectory() ? f : path.dirname(f); d.startsWith(rootReal); d = path.dirname(d)) { if (fs.existsSync(path.join(d, FOREIGN_MARK))) return true; if (d === rootReal) break; }
    return false;
  };
  const allowCmd = (a) => {
    if (!cfg.commandAllow.includes(a.command)) return `команда «${a.command}» не в списке разрешённых (SVETLANA_COMMAND_ALLOW)`;
    return checkArgs(a.command, a.args || []);
  };
  const list = () => [...servers.values()].map((s) => ({ id: s.id, url: s.url, command: s.title, cwd: s.cwd, running: s.child.exitCode === null }))
    .concat([...previews.values()].map((p) => ({ id: p.id, url: `http://127.0.0.1:${p.port}/${p.key}/`, command: "просмотр (code_preview)", cwd: path.relative(root, p.dir) || ".", running: true })));
  async function serve(a) {
    if (a.port && (await portOpen(a.port))) return { ok: false, error: `порт ${a.port} уже занят` };
    const cwd = P(a.cwd || ".");
    const sp = spawnSafe({ command: a.command, args: a.args || [], cwd, root: fs.realpathSync(root), env: a.port ? { PORT: String(a.port), BROWSER: "none" } : { BROWSER: "none" } });
    if (sp.error) return { ok: false, error: sp.error };
    const child = sp.child; let log = "";
    const add = (d) => { log = (log + d).slice(-8000); };
    child.stdout.on("data", add); child.stderr.on("data", add); child.on("error", (e) => add("\n" + e.message));
    const id = String(nextId++);
    const rec = { id, child, cwd: path.relative(root, cwd) || ".", title: [a.command, ...(a.args || [])].join(" ").slice(0, 200), url: "" };
    servers.set(id, rec);
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode !== null || child.signalCode) { servers.delete(id); return { ok: false, error: `процесс завершился (код ${child.exitCode})`, data: { log: log.slice(-3000) }, untrusted: true }; }
      const m = URL_RE.exec(log); const port = a.port || (m && Number(m[1]) <= 65535 && Number(m[1]));
      if (port && (await portOpen(port))) { rec.url = `http://127.0.0.1:${port}/`; return { data: { id, url: rec.url, log: log.slice(-1500) }, summary: `Запущено: ${rec.url}`, untrusted: true }; }
    }
    killTree(child); servers.delete(id);
    return { ok: false, error: "сервер не открыл порт за 45 секунд — укажите port или проверьте команду", data: { log: log.slice(-3000) }, untrusted: true };
  }
  return [
    { name: "code_list", domain: "code", risk: "read", taints: true, description: `Показать файлы и папки в рабочей папке проектов (${root}).`,
      parameters: { type: "object", properties: { path: { type: "string", maxLength: 500 }, depth: { type: "integer", minimum: 0, maximum: 6 } }, additionalProperties: false },
      async execute(_c, a) { const out = []; await walk(P(a.path || "."), root, a.depth ?? 2, out, 800); return { data: { root, files: out, truncated: out.length >= 800 }, summary: `Файлов и папок: ${out.length}`, untrusted: true, foreign: isForeign(a.path) }; } },
    { name: "code_read", domain: "code", risk: "read", taints: true, description: "Прочитать файл (с номерами строк). Можно диапазон строк.",
      parameters: { type: "object", properties: { path: { type: "string", maxLength: 500 }, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } }, required: ["path"], additionalProperties: false },
      async execute(_c, a) {
        const f = P(a.path); const st = await fsp.stat(f); if (!st.isFile()) throw new Error("это не файл");
        const text = (await fsp.readFile(f, "utf8")).slice(0, MAX_READ); const lines = text.split("\n");
        const s = (a.startLine || 1) - 1, e = Math.min(lines.length, a.endLine || lines.length);
        return { untrusted: true, foreign: isForeign(a.path), data: { path: a.path, totalLines: lines.length, text: lines.slice(s, e).map((l, i) => `${s + i + 1}| ${l}`).join("\n") }, summary: `${a.path}: строки ${s + 1}–${e} из ${lines.length}` };
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
        return { data: { hits }, summary: `Совпадений: ${hits.length}`, untrusted: true, foreign: isForeign(a.path) || hits.some((h) => isForeign(h.split(":")[0])) };
      } },
    { name: "code_env", domain: "code", risk: "read", description: "Узнать среду разработки: ОС, рабочая папка проектов, какие программы установлены (node, npm, git, python, dotnet) и их версии, что разрешено запускать. Вызывай перед созданием нового проекта.",
      async execute() {
        const tools = {};
        if (cfg.allowHostExec && !cfg.runnerSocket) {
          for (const c of ["node", "npm", "git", "python", "dotnet"].filter((x) => cfg.commandAllow.includes(x) || (x === "python" && cfg.commandAllow.includes("python3")))) {
            const r = await runSandboxed({ command: c === "python" && !cfg.commandAllow.includes("python") ? "python3" : c, args: ["--version"], cwd: root, timeoutMs: 15000, root: fs.realpathSync(root) });
            tools[c] = r.code === 0 ? (r.stdout || r.stderr).trim().split("\n")[0].slice(0, 80) : "не установлено";
          }
        }
        return { data: { os: process.platform === "win32" ? "Windows" : process.platform, root, allowed: cfg.commandAllow, run: cfg.runnerSocket ? "песочница на сервере" : cfg.allowHostExec ? "на этом компьютере (каждая команда — с подтверждением)" : "выключен", tools,
          tips: process.platform === "android" ? "Телефон: команды (npm, python) здесь не запускаются. Делай веб-приложения на чистых HTML/CSS/JS (без сборки, без npm) и показывай их через code_preview — откроются прямо в приложении." : process.platform === "win32" ? "Windows: python вместо python3; пути через \\ или /; без shell-операторов (&&, |, >) — каждую команду отдельным code_run; крупные файлы пиши частями (code_write, затем code_append)." : "крупные файлы пиши частями (code_write, затем code_append)" }, summary: `Среда: ${Object.entries(tools).map(([k, v]) => `${k} ${v}`).join(", ") || "команды не запускаются"}` };
      } },
    { name: "code_append", domain: "code", risk: "write", devAuto: () => true, description: "Дописать текст в конец файла (для больших файлов: сначала code_write с первой частью, потом code_append с остальными).",
      parameters: { type: "object", properties: { path: { type: "string", minLength: 1, maxLength: 500 }, content: { type: "string", minLength: 1, maxLength: 400000 } }, required: ["path", "content"], additionalProperties: false },
      async execute(_c, a) { const f = P(a.path); if (!fs.existsSync(f)) return { ok: false, error: "файла нет — сначала code_write" }; await fsp.appendFile(f, a.content); const size = (await fsp.stat(f)).size;
        return { data: { path: a.path, bytes: size }, summary: `Дописано в ${a.path}, теперь ${size} байт` }; } },
    { name: "code_write", domain: "code", risk: "write", devAuto: () => true, description: "Создать или полностью перезаписать файл в проекте (папки создаются сами). Большой файл — частями через code_append.",
      parameters: { type: "object", properties: { path: { type: "string", minLength: 1, maxLength: 500 }, content: { type: "string", maxLength: 400000 } }, required: ["path", "content"], additionalProperties: false },
      async execute(_c, a) { const f = P(a.path); await fsp.mkdir(path.dirname(f), { recursive: true }); const existed = fs.existsSync(f); await fsp.writeFile(f, a.content); const back = await fsp.readFile(f, "utf8");
        return { ok: back === a.content, data: { path: a.path, bytes: Buffer.byteLength(a.content), created: !existed }, summary: `${existed ? "Перезаписан" : "Создан"} ${a.path} (${Buffer.byteLength(a.content)} байт), проверено чтением` }; } },
    { name: "code_edit", domain: "code", risk: "write", devAuto: () => true, description: "Точечная правка: заменить фрагмент find на replace (фрагмент должен встречаться ровно один раз).",
      parameters: { type: "object", properties: { path: { type: "string", maxLength: 500 }, find: { type: "string", minLength: 1, maxLength: 100000 }, replace: { type: "string", maxLength: 100000 } }, required: ["path", "find", "replace"], additionalProperties: false },
      async execute(_c, a) {
        const f = P(a.path); const s = await fsp.readFile(f, "utf8"); const n = s.split(a.find).length - 1;
        if (n !== 1) return { ok: false, error: n === 0 ? "фрагмент не найден" : `фрагмент встречается ${n} раз — уточните` };
        const out = s.replace(a.find, () => a.replace); await fsp.writeFile(f, out);
        return { data: { path: a.path }, summary: `Правка в ${a.path} применена` };
      } },
    { name: "code_run", domain: "code_run", risk: "dangerous", description: `Запустить команду в проекте (без shell) и дождаться конца: установка зависимостей, сборка, тесты. Разрешены: ${cfg.commandAllow.join(", ")}. Таймаут до 10 минут. Для серверов, которые работают постоянно, — code_serve.`,
      parameters: { type: "object", properties: { command: { type: "string", maxLength: 40 }, args: { type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 60 }, cwd: { type: "string", maxLength: 500 }, timeoutSec: { type: "integer", minimum: 1, maximum: 600 } }, required: ["command"], additionalProperties: false },
      confirm: () => true, devAuto: devAutoCmd, // команды — с подтверждением; без кликов только в «режиме разработки» и не опасные (devRisky)
      async execute(_c, a) {
        const bad = allowCmd(a); if (bad) return { ok: false, error: bad };
        const cwd = P(a.cwd || "."); const timeoutMs = (a.timeoutSec || 120) * 1000;
        let r;
        if (cfg.runnerSocket) r = await viaRunner(cfg.runnerSocket, { command: a.command, args: a.args || [], cwd: path.relative(fs.realpathSync(root), cwd), timeoutSec: a.timeoutSec || 120 });
        else if (cfg.allowHostExec) r = await runSandboxed({ command: a.command, args: a.args || [], cwd, timeoutMs, root: fs.realpathSync(root) }); // без ключей ядра в окружении
        else return { ok: false, error: "запуск команд выключен: включите песочницу (SVETLANA_RUNNER_SOCKET, сервис runner в docker-compose) или явно SVETLANA_ALLOW_HOST_EXEC=1" };
        if (r.error) return { ok: false, error: r.error };
        const cloned = a.command === "git" && (a.args || []).find((x) => !x.startsWith("-")) === "clone";
        if (cloned && r.code === 0) { // скачанный репозиторий помечаем: его README и код — внешние данные
          // источник — аргумент-адрес (://, user@host:, .git); папка — следующий позиционный аргумент, иначе имя репозитория
          const args = a.args || []; const ui = args.findIndex((x) => /:\/\/|^[\w.-]+@[\w.-]+:|\.git$/.test(x));
          const next = ui >= 0 ? args[ui + 1] : undefined;
          const dir = next && !next.startsWith("-") ? next : ui >= 0 ? args[ui].replace(/[\\/]+$/, "").split(/[\\/:]/).pop().replace(/\.git$/, "") : "";
          let marked = false;
          try { if (dir) { fs.writeFileSync(path.join(P(path.join(a.cwd || ".", dir)), FOREIGN_MARK), "скачано git clone — содержимое считается внешними данными\n"); marked = true; } } catch { /* ниже */ }
          if (!marked) fs.writeFileSync(path.join(P(a.cwd || "."), FOREIGN_MARK), "сюда скачивали git clone — содержимое считается внешними данными\n"); // не поняли куда — чужой вся папка
        }
        return { ok: r.code === 0, foreign: Boolean(devRisky(a)), data: r, summary: r.timedOut ? "Остановлено по таймауту" : `Код выхода ${r.code}`, error: r.code === 0 ? undefined : (r.stderr || r.stdout).slice(-2000), untrusted: true };
      } },
    { name: "code_serve", domain: "code_run", risk: "dangerous", description: `Запустить проект в фоне для просмотра в браузере (dev-сервер: npm run dev, npx vite, python -m http.server 8000…) и вернуть адрес http://127.0.0.1:порт. Не больше ${MAX_SERVERS} одновременно; остановить — code_serve_stop.`,
      parameters: { type: "object", properties: { command: { type: "string", maxLength: 40 }, args: { type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 60 }, cwd: { type: "string", maxLength: 500 }, port: { type: "integer", minimum: 1024, maximum: 65535 } }, required: ["command"], additionalProperties: false },
      confirm: () => true, devAuto: devAutoCmd,
      async execute(_c, a) {
        const bad = allowCmd(a); if (bad) return { ok: false, error: bad };
        if (!cfg.allowHostExec || cfg.runnerSocket) return { ok: false, error: "фоновый запуск доступен только в локальном режиме на этом компьютере" };
        for (const s of servers.values()) if (s.child.exitCode !== null) servers.delete(s.id);
        if (servers.size + starting >= MAX_SERVERS) return { ok: false, error: `уже запущено ${servers.size} — сначала остановите лишнее (code_serve_stop)`, data: { servers: list() } };
        starting++; // место занято сразу, до первого await: параллельные запуски не обойдут лимит
        try { return await serve(a); } finally { starting--; }
      } },
    { name: "code_preview", domain: "code", risk: "read", description: "Показать веб-проект (HTML/CSS/JS без сборки) — вернёт адрес http://127.0.0.1:порт/…, по нему проект открывается прямо в приложении. Работает везде, в том числе на телефоне. В проекте используй относительные пути (app.js, а не /app.js).",
      parameters: { type: "object", properties: { path: { type: "string", minLength: 1, maxLength: 500, description: "папка проекта, где лежит index.html" }, entry: { type: "string", maxLength: 200, description: "страница, по умолчанию index.html" } }, required: ["path"], additionalProperties: false },
      async execute(_c, a) {
        const dir = P(a.path); if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, error: "нет такой папки — сначала создайте проект (code_write)" };
        const entry = String(a.entry || "index.html").replace(/^\/+/, "");
        if (!fs.existsSync(safePath(dir, entry))) return { ok: false, error: `в папке нет ${entry}` };
        const p = await startPreview(dir, fs.realpathSync(root)); const url = `http://127.0.0.1:${p.port}/${p.key}/${entry === "index.html" ? "" : encodeURI(entry)}`;
        return { data: { id: p.id, url }, summary: `Проект открыт: ${url}` };
      } },
    { name: "code_serve_stop", domain: "code_run", risk: "write", confirm: false, description: "Остановить фоновый сервер проекта (id из code_serve) или все сразу (id не указывать).",
      parameters: { type: "object", properties: { id: { type: "string", maxLength: 10 } }, additionalProperties: false },
      async execute(_c, a) {
        const ids = a.id ? [a.id] : [...servers.keys(), ...previews.keys()]; let n = 0;
        for (const i of ids) { const s = servers.get(i); if (s) { killTree(s.child); servers.delete(i); n++; } const pv = previews.get(i); if (pv) { pv.server.close(); previews.delete(i); n++; } }
        return { ok: n > 0 || !a.id, data: { stopped: n }, summary: `Остановлено: ${n}`, error: n || !a.id ? undefined : "нет такого сервера" };
      } },
    { name: "code_serve_list", domain: "code_run", risk: "read", description: "Какие фоновые серверы проектов сейчас запущены и их адреса.",
      async execute() { return { data: { servers: list() }, summary: `Запущено: ${servers.size + previews.size}` }; } },
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
