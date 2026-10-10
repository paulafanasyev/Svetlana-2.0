// У каждого чата своя папка в рабочей папке проектов: chats/<id чата>/. Туда ложатся загруженные файлы,
// и Светлана работает с ними обычными инструментами code_* (читать, править, пушить на GitHub, деплоить).
import fs from "node:fs";
import path from "node:path";

const MAX = 25 * 1024 * 1024;
export const chatDir = (cfg, id) => path.join(cfg.workspace, "chats", id);
/** Имя файла без путей и служебных символов; пусто → «файл». */
export function safeName(n) {
  const base = String(n || "").split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return base || "файл";
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (d) => { n += d.length; if (n > limit) { reject(Object.assign(new Error("файл больше 25 МБ"), { status: 413 })); req.destroy(); } else chunks.push(d); });
    req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject);
  });
}
function unique(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) { const n = `${stem} (${i})${ext}`; if (!fs.existsSync(path.join(dir, n))) return n; }
}

/** [status, body] или null — /api/chats/<id>/files (после проверки входа). */
export async function chatFilesApi(app, req, p, url) {
  const m = /^\/api\/chats\/([A-Za-z0-9_-]{1,64})\/files$/.exec(p); if (!m) return null;
  const c = app.store.get("conversations", m[1]); if (!c || c.mode === "pico") return [404, { error: "нет такого чата" }];
  const dir = chatDir(app.cfg, c.id);
  if (req.method === "GET") {
    if (!fs.existsSync(dir)) return [200, { dir: path.relative(app.cfg.workspace, dir).split(path.sep).join("/"), files: [] }];
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => { const st = fs.statSync(path.join(dir, e.name)); return { name: e.name, size: st.size, at: st.mtime.toISOString() }; });
    return [200, { dir: path.relative(app.cfg.workspace, dir).split(path.sep).join("/"), files }];
  }
  if (req.method === "POST") {
    const buf = await readBody(req, MAX);
    fs.mkdirSync(dir, { recursive: true });
    const name = unique(dir, safeName(url.searchParams.get("name")));
    fs.writeFileSync(path.join(dir, name), buf);
    const rel = path.relative(app.cfg.workspace, path.join(dir, name)).split(path.sep).join("/");
    return [200, { ok: true, name, size: buf.length, path: rel }];
  }
  return null;
}
