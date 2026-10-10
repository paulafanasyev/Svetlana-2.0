// «Мозг» Светланы для всех продуктов: справочник по АИКО, «Миру самозанятых», «Я-Зарядке» и самой Светлане,
// эталоны упражнений Пико (новое упражнение из видео без нового кода) и проверка ответов для режима репетитора.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTemplate, evaluate, hintFor } from "../pico/pose-template.mjs";
import { computeScore } from "./life.mjs";

const KDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../knowledge/products");
export const DOCS = fs.existsSync(KDIR) ? fs.readdirSync(KDIR).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(fs.readFileSync(path.join(KDIR, f), "utf8"))) : [];
const words = (s) => String(s).toLowerCase().replace(/ё/g, "е").match(/[\p{L}\d_.]+/gu) || [];
const stem = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w);
const STOP = new Set(["как", "что", "где", "это", "для", "или", "мне", "если", "можно", "нужно", "какие", "какой", "какая", "работает", "есть", "такое", "такой", "через"]);
const PRODUCT = [["aiko", /аико|aiko|маркетплейс/], ["selfemployed", /мир[а-я]* самозанят|самозанят/], ["pico", /зарядк|пико/], ["svetlana", /светлан|ядр/]];
const PSTOP = /^(аико|aiko|маркетплейс\S*|мир\S*|самозанят\S*|я|зарядк\S*|пико|светлан\S*|ядр\S*)$/;
export function searchDocs(q, product, limit = 3) {
  const low = String(q).toLowerCase().replace(/ё/g, "е");
  product ||= PRODUCT.find(([, re]) => re.test(low))?.[0]; // продукт из вопроса — фильтр, а не слово для поиска
  const qs = [...new Set(words(q).filter((w) => (w.length > 2 || /\d/.test(w)) && !STOP.has(w) && !PSTOP.test(w)).map(stem))];
  return DOCS.filter((d) => !product || d.product === product).map((d) => { const hay = words(d.topic + " " + d.text).map(stem), top = words(d.topic).map(stem);
    return { d, s: qs.reduce((n, w) => n + (hay.some((h) => h.includes(w)) ? 1 : 0) + (top.some((h) => h.includes(w)) ? 2 : 0), 0) }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.d);
}

/** Безопасный калькулятор для проверки ответов ребёнка: только числа, + − × ÷ ^ и скобки. */
export function calc(expr) {
  const src = String(expr).replace(/,/g, ".").replace(/[×xх*]/gi, "*").replace(/[÷:/]/g, "/").replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!/^[\d.+\-*/^()]+$/.test(src)) throw new Error("можно только числа и знаки + − × ÷ ^ ( )");
  let i = 0; const peek = () => src[i], eat = (c) => (src[i] === c ? (i++, true) : false);
  const num = () => { const m = /^\d+(\.\d+)?/.exec(src.slice(i)); if (!m) throw new Error("ожидалось число"); i += m[0].length; return +m[0]; };
  const atom = () => { if (eat("-")) return -atom(); if (eat("(")) { const v = add(); if (!eat(")")) throw new Error("не закрыта скобка"); return v; } return num(); };
  const pow = () => { const b = atom(); return eat("^") ? b ** pow() : b; };
  const mul = () => { let v = pow(); for (;;) { if (eat("*")) v *= pow(); else if (eat("/")) { const d = pow(); if (d === 0) throw new Error("деление на ноль"); v /= d; } else return v; } };
  const add = () => { let v = mul(); for (;;) { if (eat("+")) v += mul(); else if (eat("-")) v -= mul(); else return v; } };
  const v = add(); if (i !== src.length) throw new Error(`лишний символ «${peek()}»`); return Math.round(v * 1e9) / 1e9;
}

export function brainTools(store, cfg) {
  const ws = (p) => { const f = path.resolve(cfg.workspace, String(p)); if (!f.startsWith(path.resolve(cfg.workspace) + path.sep)) throw new Error("файл вне рабочей папки"); return f; };
  const readFrames = (file) => { const j = JSON.parse(fs.readFileSync(ws(file), "utf8")); const frames = Array.isArray(j) ? j : j.frames; if (!Array.isArray(frames)) throw new Error("в файле нет кадров позы (frames)"); return frames; };
  const slug = (s) => String(s).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "ex";
  return [
    { name: "docs_search", domain: "docs_kb", risk: "read", description: "Справочник по продуктам: как устроены и работают маркетплейс АИКО (aiko), «Мир самозанятых» (selfemployed), «Я-Зарядка»/Пико (pico) и сама Светлана (svetlana). С указанием файла-источника.",
      parameters: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 300 }, product: { type: "string", enum: ["aiko", "selfemployed", "pico", "svetlana"] } }, required: ["query"], additionalProperties: false },
      async execute(_c, a) { const r = searchDocs(a.query, a.product); return r.length ? { data: r.map(({ product, text, source }) => ({ product, text, source })), summary: `Нашла: ${r.length}` } : { ok: false, error: "в справочнике продуктов этого нет — посмотрю код (code_search) или спрошу Павла" }; } },
    { name: "math_check", domain: "pico", risk: "read", description: "Проверить ответ ребёнка на пример: посчитать выражение и сравнить. Результат не говори ребёнку сразу — веди его наводящими вопросами.",
      parameters: { type: "object", properties: { expression: { type: "string", minLength: 1, maxLength: 200 }, answer: { type: "string", maxLength: 50 } }, required: ["expression"], additionalProperties: false },
      async execute(_c, a) { try { const v = calc(a.expression); const ans = a.answer === undefined ? undefined : calc(a.answer); return { data: { value: v, ...(ans === undefined ? {} : { correct: Math.abs(ans - v) < 1e-9 }) }, summary: ans === undefined ? "посчитано" : Math.abs(ans - v) < 1e-9 ? "ответ верный" : "ответ неверный" }; } catch (e) { return { ok: false, error: e.message }; } } },
    { name: "exercise_template_create", domain: "pico", risk: "write", description: "Добавить новое упражнение Пико из эталонной записи: файл с кадрами позы MediaPipe (pico/uploads/*.json), 3–5 чистых повторов или удержание.",
      parameters: { type: "object", properties: { name: { type: "string", minLength: 2, maxLength: 60 }, kind: { type: "string", enum: ["reps", "hold"] }, file: { type: "string", minLength: 3, maxLength: 200 }, norms: { type: "array", items: { type: "integer", minimum: 1, maximum: 200 }, minItems: 3, maxItems: 3 }, cue: { type: "string", maxLength: 200 } }, required: ["name", "kind", "file"], additionalProperties: false },
      async execute(_c, a) {
        let tpl; try { tpl = buildTemplate({ id: slug(a.name), name: a.name, kind: a.kind, frames: readFrames(a.file), norms: a.norms, cue: a.cue }); } catch (e) { return { ok: false, error: e.message }; }
        store.remove("exercises", tpl.id); store.insert("exercises", tpl); // повторная загрузка заменяет эталон
        return { data: { id: tpl.id, kind: tpl.kind, primary: tpl.primary, joints: tpl.active, repMs: tpl.repMs }, summary: `Упражнение «${a.name}» добавлено (${tpl.kind === "hold" ? "удержание" : `главный сустав ${tpl.primary}, повтор ≈${tpl.repMs} мс`})` };
      } },
    { name: "exercise_templates", domain: "pico", risk: "read", description: "Список загруженных эталонных упражнений Пико (сверх 10 встроенных).",
      async execute() { const r = store.all("exercises").map(({ id, name, kind, norms, createdAt }) => ({ id, name, kind, norms, createdAt })); return { data: r, summary: `Эталонов: ${r.length}` }; } },
    { name: "exercise_evaluate", domain: "pico", risk: "read", description: "Оценить попытку ребёнка по эталону: файл с кадрами позы → повторы, итог из 100 (те же формулы, что в «Я-Зарядке»), главные ошибки.",
      parameters: { type: "object", properties: { exerciseId: { type: "string", minLength: 1, maxLength: 40 }, file: { type: "string", minLength: 3, maxLength: 200 }, age: { type: "integer", minimum: 4, maximum: 99 } }, required: ["exerciseId", "file"], additionalProperties: false },
      async execute(_c, a) {
        const tpl = store.get("exercises", a.exerciseId); if (!tpl) return { ok: false, error: "такого эталона нет — посмотрите exercise_templates" };
        let r; try { r = evaluate(tpl, readFrames(a.file)); } catch (e) { return { ok: false, error: e.message }; }
        const target = Math.max(3, tpl.norms[(a.age ?? 11) <= 6 ? 0 : (a.age ?? 11) <= 10 ? 1 : 2]);
        const freq = {}; for (const e of r.errors) freq[e] = (freq[e] || 0) + 1;
        const top = Object.entries(freq).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => hintFor(k, tpl));
        if (r.kind === "hold") return { data: { exercise: tpl.name, target, seconds: r.seconds, topErrors: top }, summary: `${tpl.name}: удержание ${r.seconds} из ${target} сек` };
        const s = computeScore(r.reps);
        return { data: { exercise: tpl.name, target, ...s, topErrors: top }, summary: `${tpl.name}: ${s.reps} из ${target}, итог ${s.total}/100` };
      } },
    { name: "exercise_pack_export", domain: "pico", risk: "read", description: "Собрать пакет эталонов pico/exercises.json для обновления приложения «Я-Зарядка».",
      async execute() { const list = store.all("exercises").map(({ createdAt, updatedAt, ...t }) => t); const f = ws("pico/exercises.json"); fs.mkdirSync(path.dirname(f), { recursive: true });
        const pack = { format: "pico-exercises", version: Date.now(), exercises: list }; fs.writeFileSync(f, JSON.stringify(pack));
        return { data: { file: "pico/exercises.json", count: list.length, version: pack.version }, summary: `Пакет: ${list.length} упражнений` }; } },
  ];
}
