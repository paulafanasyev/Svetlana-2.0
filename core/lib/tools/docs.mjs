// Документы, презентации, счета, таблицы → HTML + PDF (headless Chromium), картинки и видео через провайдеров.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runProcess } from "./code.mjs";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

/** Безопасный Markdown → HTML: заголовки, списки, таблицы, код, цитаты. Сырой HTML не пропускается. */
export function md(src) {
  const lines = String(src || "").replace(/\r/g, "").split("\n"); const out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const row = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(l); i += 2; const body = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l); const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`); continue;
    }
    if (/^>\s?/.test(l)) { out.push(`<blockquote>${inline(l.replace(/^>\s?/, ""))}</blockquote>`); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const para = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s|>|\|)/.test(lines[i])) para.push(lines[i++]);
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); else { out.push(`<p>${inline(lines[i])}</p>`); i++; }
  }
  return out.join("\n");
}

const BASE_CSS = `*{box-sizing:border-box}body{font-family:"DejaVu Sans","Segoe UI",Roboto,Arial,sans-serif;color:#1d1b3a;line-height:1.5;margin:0}
h1,h2,h3{color:#2b2873;line-height:1.2}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d9d6f2;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f1f0fd}code{background:#f3f3fe;padding:1px 4px;border-radius:4px}pre{background:#151432;color:#e9e8ff;padding:12px;border-radius:8px;white-space:pre-wrap}
blockquote{border-left:4px solid #8c80ef;margin:8px 0;padding:4px 12px;color:#4b4a6b}a{color:#3d7bf7}`;

export function docHtml(title, body) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><title>${esc(title)}</title><style>${BASE_CSS}
@page{size:A4;margin:18mm 16mm}body{padding:0 4px}h1{border-bottom:3px solid #5a5be8;padding-bottom:6px}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}

const THEMES = { aiko: ["#3d7bf7", "#5a5be8", "#9a6ee6"], dark: ["#141432", "#2b2873", "#5a5be8"], green: ["#0f766e", "#14b8a6", "#5eead4"] };
export function slidesHtml(title, slides, theme = "aiko") {
  const [a, b, c] = THEMES[theme] || THEMES.aiko;
  const page = (s, i) => `<section class="s ${i === 0 ? "cover" : ""}"><div class="in">
    ${i === 0 ? `<h1>${esc(s.title)}</h1>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ""}` : `<h2>${esc(s.title)}</h2>`}
    ${(s.bullets || []).length ? `<ul>${s.bullets.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>` : ""}
    ${s.body ? `<div class="body">${md(s.body)}</div>` : ""}
    ${s.image && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.image) ? `<img src="${s.image}" alt="">` : ""}</div><footer>${esc(title)} · ${i + 1}/${slides.length}</footer></section>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><title>${esc(title)}</title><style>${BASE_CSS}
@page{size:1280px 720px;margin:0}html,body{width:1280px}.s{width:1280px;height:720px;position:relative;overflow:hidden;page-break-after:always;padding:64px 80px;background:#fff}
.s::before{content:"";position:absolute;left:0;top:0;right:0;height:10px;background:linear-gradient(100deg,${a},${b},${c})}
.cover{background:linear-gradient(120deg,${a},${b} 55%,${c});color:#fff}.cover h1{color:#fff;font-size:64px;margin-top:150px}.cover .sub{font-size:28px;opacity:.9}
h2{font-size:44px;margin:10px 0 28px}ul{font-size:28px;padding-left:34px}li{margin:10px 0}.body{font-size:24px}img{max-height:380px;max-width:100%;border-radius:16px}
footer{position:absolute;bottom:22px;right:40px;font-size:16px;color:#9896b4}.cover footer{color:#ffffffaa}
@media screen{body{background:#e9e8f5}.s{margin:20px auto;box-shadow:0 10px 40px #0002;border-radius:12px}}</style></head><body>${slides.map(page).join("")}</body></html>`;
}

export function findChromium(cfg) {
  const cands = [cfg.chromium, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  try { for (const d of fs.readdirSync("/ms-playwright")) if (d.startsWith("chromium-")) cands.push(`/ms-playwright/${d}/chrome-linux/chrome`, `/ms-playwright/${d}/chrome-linux64/chrome`); } catch { /* нет */ }
  return cands.find((p) => fs.existsSync(p)) || null;
}

/** Телефон: PDF печатает само приложение Android (WebView → PrintManager), ядро передаёт пути к файлам. */
async function pdfViaBridge(bridge, htmlFile, pdfFile) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 90000);
  try {
    const html = fs.readFileSync(htmlFile, "utf8");
    const r = await fetch(bridge, { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SVETLANA_PDF_TOKEN || ""}` },
      body: JSON.stringify({ html: htmlFile, pdf: pdfFile, slides: /@page\{size:1280px 720px/.test(html) }) });
    const ok = r.ok && fs.existsSync(pdfFile) && fs.statSync(pdfFile).size > 500 && fs.readFileSync(pdfFile).subarray(0, 5).toString() === "%PDF-";
    return ok ? { ok: true } : { ok: false, error: "телефон не смог напечатать PDF: " + (await r.text().catch(() => "")).slice(0, 200) };
  } catch (e) { return { ok: false, error: "печать PDF на телефоне не ответила: " + String(e.message || e).slice(0, 200) }; }
  finally { clearTimeout(t); }
}

export async function htmlToPdf(cfg, htmlFile, pdfFile) {
  if (process.env.SVETLANA_PDF_BRIDGE) return pdfViaBridge(process.env.SVETLANA_PDF_BRIDGE, htmlFile, pdfFile);
  const chrome = findChromium(cfg);
  if (!chrome) return { ok: false, error: "Chromium не найден (CHROMIUM_PATH) — PDF не создан, HTML готов: откройте и «Печать → PDF»" };
  const r = await runProcess(chrome, ["--headless=new", "--disable-gpu", ...(cfg.chromiumNoSandbox ? ["--no-sandbox"] : []), "--disable-background-networking", "--no-pdf-header-footer", `--print-to-pdf=${pdfFile}`, "file://" + htmlFile], { timeoutMs: 90000 });
  const ok = fs.existsSync(pdfFile) && fs.statSync(pdfFile).size > 500 && fs.readFileSync(pdfFile).subarray(0, 5).toString() === "%PDF-";
  return ok ? { ok: true } : { ok: false, error: "Chromium не смог напечатать PDF: " + (r.stderr || "").slice(-300) };
}

export function artifacts(cfg) {
  const dir = path.join(cfg.dataDir, "artifacts"); fs.mkdirSync(dir, { recursive: true });
  const slug = (t) => (String(t).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "file");
  return {
    dir,
    save(title, ext, data) { const name = `${slug(title)}-${crypto.randomBytes(4).toString("hex")}.${ext}`; fs.writeFileSync(path.join(dir, name), data); return { name, url: `/api/artifacts/${name}`, bytes: Buffer.byteLength(data) }; },
    path(name) { if (!/^[\p{L}0-9._-]+$/u.test(name) || name.includes("..")) return null; const p = path.join(dir, name); return fs.existsSync(p) ? p : null; },
  };
}

export function docTools(cfg, providers) {
  const A = artifacts(cfg);
  async function both(title, html) {
    const h = A.save(title, "html", html); const pdfName = h.name.replace(/\.html$/, ".pdf");
    const r = await htmlToPdf(cfg, path.join(A.dir, h.name), path.join(A.dir, pdfName));
    const files = [{ ...h, mime: "text/html" }]; if (r.ok) files.unshift({ name: pdfName, url: `/api/artifacts/${pdfName}`, mime: "application/pdf" });
    return { files, pdf: r.ok, note: r.ok ? undefined : r.error };
  }
  const slideSchema = { type: "object", properties: { title: { type: "string", maxLength: 200 }, subtitle: { type: "string", maxLength: 300 }, bullets: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 10 }, body: { type: "string", maxLength: 4000 }, image: { type: "string", maxLength: 500, description: "ссылка /api/artifacts/… на сгенерированную картинку" } }, required: ["title"], additionalProperties: false };
  return [
    { name: "doc_create", domain: "docs", risk: "read", description: "Создать документ (договор, КП, отчёт, письмо) из Markdown → PDF и HTML.",
      parameters: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 }, markdown: { type: "string", minLength: 1, maxLength: 200000 } }, required: ["title", "markdown"], additionalProperties: false },
      async execute(_c, a) { const r = await both(a.title, docHtml(a.title, md(a.markdown))); return { data: r, artifacts: r.files, summary: r.pdf ? `PDF «${a.title}» готов` : `HTML «${a.title}» готов; ${r.note}` }; } },
    { name: "slides_create", domain: "docs", risk: "read", description: "Сделать презентацию 16:9 → PDF и HTML. Первый слайд — титульный.",
      parameters: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 }, theme: { type: "string", enum: Object.keys(THEMES) }, slides: { type: "array", items: slideSchema, maxItems: 60 } }, required: ["title", "slides"], additionalProperties: false },
      async execute(_c, a) { if (!a.slides.length) return { ok: false, error: "нужен хотя бы один слайд" };
        for (const sl of a.slides) { const m = /^\/api\/artifacts\/(.+)$/.exec(sl.image || ""); const f = m && A.path(decodeURIComponent(m[1]));
          if (f && /\.(png|jpe?g|webp)$/i.test(f)) sl.image = `data:image/${/png$/i.test(f) ? "png" : /webp$/i.test(f) ? "webp" : "jpeg"};base64,${fs.readFileSync(f).toString("base64")}`; } const r = await both(a.title, slidesHtml(a.title, a.slides, a.theme)); return { data: r, artifacts: r.files, summary: `Презентация «${a.title}»: ${a.slides.length} слайдов${r.pdf ? ", PDF готов" : ""}` }; } },
    { name: "invoice_create", domain: "docs", risk: "read", description: "Счёт на оплату от самозанятого (НПД, без НДС) → PDF.",
      parameters: { type: "object", properties: { number: { type: "string", maxLength: 40 }, date: { type: "string", maxLength: 10 }, sellerName: { type: "string", maxLength: 200 }, sellerInn: { type: "string", maxLength: 12 }, buyerName: { type: "string", maxLength: 300 }, buyerInn: { type: "string", maxLength: 12 },
        items: { type: "array", maxItems: 50, items: { type: "object", properties: { name: { type: "string", maxLength: 300 }, qty: { type: "number", minimum: 0 }, price: { type: "number", minimum: 0 } }, required: ["name", "qty", "price"], additionalProperties: false } }, bankDetails: { type: "string", maxLength: 1000 } },
        required: ["number", "date", "sellerName", "buyerName", "items"], additionalProperties: false },
      async execute(_c, a) {
        const total = a.items.reduce((s, x) => s + x.qty * x.price, 0);
        const rows = a.items.map((x, i) => `| ${i + 1} | ${x.name.replace(/\|/g, "/")} | ${x.qty} | ${x.price.toFixed(2)} | ${(x.qty * x.price).toFixed(2)} |`).join("\n");
        const mdText = `**Исполнитель:** ${a.sellerName}${a.sellerInn ? `, ИНН ${a.sellerInn}` : ""} (плательщик НПД)\n\n**Заказчик:** ${a.buyerName}${a.buyerInn ? `, ИНН ${a.buyerInn}` : ""}\n\n| № | Наименование | Кол-во | Цена, ₽ | Сумма, ₽ |\n|---|---|---|---|---|\n${rows}\n\n**Итого к оплате: ${total.toFixed(2)} ₽.** Без НДС (применяется НПД, 422-ФЗ).${a.bankDetails ? `\n\n**Реквизиты:** ${a.bankDetails}` : ""}\n\nПосле оплаты исполнитель формирует чек в «Мой налог».`;
        const r = await both(`Счёт № ${a.number} от ${a.date}`, docHtml(`Счёт № ${a.number} от ${a.date}`, md(mdText)));
        return { data: { ...r, total }, artifacts: r.files, summary: `Счёт № ${a.number} на ${total.toFixed(2)} ₽ готов` };
      } },
    { name: "sheet_create", domain: "docs", risk: "read", description: "Создать таблицу CSV (открывается в Excel/Google Таблицах).",
      parameters: { type: "object", properties: { title: { type: "string", maxLength: 200 }, columns: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 50 }, rows: { type: "array", maxItems: 10000, items: { type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 50 } } }, required: ["title", "columns", "rows"], additionalProperties: false },
      async execute(_c, a) {
        const cell = (v) => { let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // защита от CSV-инъекций формул
        const csv = "\ufeff" + [a.columns, ...a.rows].map((r) => r.map(cell).join(";")).join("\r\n");
        const f = A.save(a.title, "csv", csv); return { data: f, artifacts: [{ ...f, mime: "text/csv" }], summary: `Таблица «${a.title}»: ${a.rows.length} строк` };
      } },
    { name: "image_generate", domain: "media", risk: "external", description: "Сгенерировать изображение по описанию (через подключённого провайдера изображений).",
      parameters: { type: "object", properties: { prompt: { type: "string", minLength: 3, maxLength: 4000 }, size: { type: "string", enum: ["1024x1024", "1024x1792", "1792x1024", "512x512"] } }, required: ["prompt"], additionalProperties: false },
      async execute(_c, a) { const img = await providers.image(a.prompt, { size: a.size }); const f = A.save(a.prompt.slice(0, 30), img.mime.includes("jpeg") ? "jpg" : "png", img.bytes); return { data: { ...f, provider: img.provider }, artifacts: [{ ...f, mime: img.mime }], summary: "Изображение готово" }; } },
    { name: "video_generate", domain: "media", risk: "external", description: "Сгенерировать короткое видео по описанию (через подключённого видеопровайдера, может занять минуты).",
      parameters: { type: "object", properties: { prompt: { type: "string", minLength: 3, maxLength: 4000 }, seconds: { type: "integer", minimum: 2, maximum: 20 } }, required: ["prompt"], additionalProperties: false },
      async execute(_c, a) { const v = await providers.video(a.prompt, { seconds: a.seconds || 5 }); const f = A.save(a.prompt.slice(0, 30), "mp4", v.bytes); return { data: { ...f, provider: v.provider }, artifacts: [{ ...f, mime: v.mime }], summary: "Видео готово" }; } },
  ];
}
