// Картинки хранятся в репозитории текстом (web/assets.b64.json) — разворачиваем их в файлы перед запуском.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const assets = JSON.parse(fs.readFileSync(path.join(web, "assets.b64.json"), "utf8"));
for (const [name, b64] of Object.entries(assets)) {
  const f = path.join(web, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(b64, "base64"));
}
console.log("картинки на месте:", Object.keys(assets).join(", "));
