// Календарь, база знаний (НПД, договоры, законы) с источниками и анализ зарядки (логика из ya-zaryadka-ai).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KB = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../knowledge/npd.json"), "utf8"));
const words = (s) => String(s).toLowerCase().replace(/ё/g, "е").match(/[\p{L}\d]+/gu) || [];
const stem = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w);
const STOP = new Set(["можно", "нужно", "надо", "как", "какая", "какой", "какие", "что", "это", "для", "или", "мне", "если", "самозанятым", "самозанятому", "самозанятых", "самозанятый"]);
export function searchKnowledge(q, limit = 3) {
  const qs = [...new Set(words(q).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];
  return KB.map((e) => { const hay = words(e.topic + " " + e.text).map(stem); const topic = words(e.topic).map(stem);
    return { e, s: qs.reduce((n, w) => n + (hay.some((h) => h.includes(w)) ? 1 : 0) + (topic.some((h) => h.includes(w)) ? 2 : 0), 0) }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}

// ---------- зарядка: те же нормы и формулы, что в ya-zaryadka-ai/web-app/core.js ----------
export const EXERCISES = {
  squat: { name: "Приседания", norms: [6, 8, 12], unit: "раз" }, spring: { name: "Пружинка", norms: [8, 10, 14], unit: "раз" },
  jack: { name: "Прыжки «Звёздочка»", norms: [8, 12, 16], unit: "раз" }, arms: { name: "Руки к солнцу", norms: [6, 8, 10], unit: "раз" },
  bend: { name: "Наклоны в стороны", norms: [6, 8, 10], unit: "раз" }, knees: { name: "Высокие колени", norms: [12, 20, 30], unit: "раз" },
  toes: { name: "Достань до носочков", norms: [5, 6, 8], unit: "раз" }, punch: { name: "Удары в стороны", norms: [10, 16, 20], unit: "раз" },
  heron: { name: "Цапля", norms: [8, 12, 20], unit: "сек" }, plane: { name: "Самолёт", norms: [5, 8, 12], unit: "сек" },
};
export const FORM_HINTS = { tilt: "Держи корпус ровно, не заваливайся в сторону.", legs_asym: "Сгибай обе ноги одинаково.", shallow: "Присядь чуть глубже.", arms_asym: "Поднимай обе руки одновременно.", elbows: "Выпрями руки в локтях.", hips: "Бёдра держи на месте, наклоняйся только корпусом.", knees_higher: "Поднимай колени повыше.", knees_bent: "Старайся не сгибать колени.", punch_height: "Выбрасывай руку на уровне плеча.", wobble: "Держи равновесие, смотри в одну точку.", hold_lost: "Попробуй ещё раз и удержи позу.", arms_level: "Держи руки ровно, как крылья самолёта.", jack_legs: "Прыгай шире, ноги в стороны." };
export const PROGRAMS = { morning: ["arms", "squat", "jack", "bend", "heron"], easy: ["spring", "arms", "knees", "plane"], power: ["squat", "punch", "toes", "knees", "heron"], all: ["arms", "spring", "squat", "jack", "bend", "knees", "toes", "punch", "plane", "heron"] };
const ageBand = (age) => (age <= 6 ? 0 : age <= 10 ? 1 : 2);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const c100 = (v) => Math.max(0, Math.min(100, Math.round(v)));
export function computeScore(reps) {
  if (!reps.length) return { accuracy: 0, precision: 0, consistency: 0, total: 0, reps: 0 };
  const accuracy = c100(mean(reps.map((r) => r.form))), precision = c100(mean(reps.map((r) => r.amp)));
  let consistency;
  if (reps.length >= 3) { const d = reps.slice(1).map((r) => r.dur), m = mean(d), cv = m > 0 ? sd(d) / m : 0;
    consistency = c100(100 - cv * 100 - sd(reps.map((r) => r.amp)) * 0.6 - sd(reps.map((r) => r.form)) * 0.6); }
  else consistency = c100(Math.min(accuracy, precision) * 0.6);
  return { accuracy, precision, consistency, total: c100((accuracy + precision + consistency) / 3), reps: reps.length };
}

const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const okDT = (s) => DT.test(s) && !isNaN(new Date(s + ":00Z")) && new Date(s + ":00Z").toISOString().slice(0, 16) === s;
const icsDate = (s) => s.replace(/[-:]/g, "") + "00";

export function lifeTools(store) {
  const dt = { type: "string", minLength: 16, maxLength: 16, description: "ГГГГ-ММ-ДДTЧЧ:ММ, местное время" };
  return [
    { name: "calendar_add", domain: "calendar", risk: "write", confirm: false, description: "Добавить событие или напоминание в календарь Светланы.",
      parameters: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 }, start: dt, durationMin: { type: "integer", minimum: 0, maximum: 1440 }, remindMin: { type: "integer", minimum: 0, maximum: 10080 }, contactId: { type: "string", maxLength: 40 }, note: { type: "string", maxLength: 1000 } }, required: ["title", "start"], additionalProperties: false },
      async execute(_c, a) {
        if (!okDT(a.start)) return { ok: false, error: "время нужно в виде ГГГГ-ММ-ДДTЧЧ:ММ" };
        const clash = store.find("events", (e) => e.start === a.start);
        const r = store.insert("events", { durationMin: 60, remindMin: 15, ...a });
        return { data: { id: r.id, start: r.start, clash: clash.map((e) => e.title) }, summary: `Событие «${a.title}» на ${a.start.replace("T", " ")}${clash.length ? `; в это же время уже есть: ${clash.map((e) => e.title).join(", ")}` : ""}` };
      } },
    { name: "calendar_list", domain: "calendar", risk: "read", description: "События календаря за период (даты включительно).",
      parameters: { type: "object", properties: { from: { type: "string", format: "date", minLength: 10, maxLength: 10 }, to: { type: "string", format: "date", minLength: 10, maxLength: 10 } }, required: ["from", "to"], additionalProperties: false },
      async execute(_c, a) { const r = store.find("events", (e) => e.start.slice(0, 10) >= a.from && e.start.slice(0, 10) <= a.to).sort((x, y) => (x.start < y.start ? -1 : 1)); return { data: r.map((e) => ({ id: e.id, title: e.title, start: e.start, durationMin: e.durationMin })), summary: `Событий: ${r.length}` }; } },
    { name: "calendar_remove", domain: "calendar", risk: "write", description: "Удалить событие из календаря.",
      parameters: { type: "object", properties: { eventId: { type: "string", minLength: 1, maxLength: 40 } }, required: ["eventId"], additionalProperties: false },
      async execute(_c, a) { const e = store.get("events", a.eventId); if (!e) return { ok: false, error: "событие не найдено" }; store.remove("events", a.eventId); return { data: { id: a.eventId }, summary: `Удалено «${e.title}»` }; } },
    { name: "calendar_export", domain: "calendar", risk: "read", description: "Выгрузить календарь в .ics для Google/Яндекс/телефона (с напоминаниями).",
      async execute() {
        const ev = store.all("events");
        const body = ev.map((e) => ["BEGIN:VEVENT", `UID:${e.id}@svetlana`, `DTSTART:${icsDate(e.start)}`, `DURATION:PT${e.durationMin || 60}M`, `SUMMARY:${String(e.title).replace(/[,;\n]/g, " ")}`, ...(e.remindMin ? ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Напоминание", `TRIGGER:-PT${e.remindMin}M`, "END:VALARM"] : []), "END:VEVENT"].join("\r\n"));
        return { data: { ics: ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Svetlana//RU", ...body, "END:VCALENDAR"].join("\r\n") }, summary: `Календарь: ${ev.length} событий в формате .ics` };
      } },
    { name: "acc_incomes_list", domain: "accounting", risk: "read", description: "Список записей дохода за период (id, дата, сумма, плательщик, услуга, чек) — для таблиц, поиска и отмены записи.",
      parameters: { type: "object", properties: { from: { type: "string", format: "date", minLength: 10, maxLength: 10 }, to: { type: "string", format: "date", minLength: 10, maxLength: 10 } }, required: ["from", "to"], additionalProperties: false },
      async execute(_c, a) { const r = store.find("incomes", (x) => !x.cancelled && x.date >= a.from && x.date <= a.to).sort((x, y) => (x.date < y.date ? -1 : 1)).slice(0, 300)
        .map(({ id, date, amount, payer, payerName, service, receiptNumber }) => ({ id, date, amount, payer, payerName, service, receipt: receiptNumber || null }));
        return { data: r, summary: `Записей: ${r.length}, на сумму ${r.reduce((n, x) => n + x.amount, 0)} ₽` }; } },
    { name: "knowledge_search", domain: "knowledge", risk: "read", description: "Найти проверенные сведения о самозанятых (НПД), налогах, договорах и законах РФ с источником. Для любых вопросов о налогах и законах — сначала это.",
      parameters: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 300 } }, required: ["query"], additionalProperties: false },
      async execute(_c, a) { const r = searchKnowledge(a.query); return r.length ? { data: r.map(({ text, source, url }) => ({ text, source, url })), summary: `Нашла: ${r.length} (${r.map((x) => x.source).join("; ")})` } : { ok: false, error: "в базе знаний нет ответа на это — нужен официальный источник (nalog.gov.ru, consultant.ru)" }; } },
    { name: "workout_analyze", domain: "fitness", risk: "read", description: "Разобрать выполнение упражнения по данным камеры (повторы: амплитуда amp и техника form 0–100, длительность dur в мс; коды ошибок техники). Возвращает оценки и подсказки.",
      parameters: { type: "object", properties: { exercise: { type: "string", enum: Object.keys(EXERCISES) }, age: { type: "integer", minimum: 4, maximum: 99 },
        reps: { type: "array", maxItems: 500, items: { type: "object", properties: { amp: { type: "number", minimum: 0, maximum: 100 }, form: { type: "number", minimum: 0, maximum: 100 }, dur: { type: "number", minimum: 0, maximum: 600000 } }, required: ["amp", "form", "dur"], additionalProperties: false } },
        errors: { type: "array", maxItems: 200, items: { type: "string", enum: Object.keys(FORM_HINTS) } } }, required: ["exercise", "reps"], additionalProperties: false },
      async execute(_c, a) {
        const ex = EXERCISES[a.exercise], s = computeScore(a.reps), target = Math.max(3, ex.norms[ageBand(a.age ?? 11)]);
        const freq = {}; for (const e of a.errors || []) freq[e] = (freq[e] || 0) + 1;
        const top = Object.entries(freq).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, n]) => ({ code: k, times: n, hint: FORM_HINTS[k] }));
        return { data: { exercise: ex.name, target, ...s, hearts: s.reps ? Math.max(1, Math.min(10, Math.round(s.total / 10))) : 0, topErrors: top }, summary: `${ex.name}: ${s.reps} из ${target}, итог ${s.total}/100 (техника ${s.accuracy}, амплитуда ${s.precision}, ровность ${s.consistency})` };
      } },
    { name: "workout_plan", domain: "fitness", risk: "read", description: "Составить зарядку: программа morning|easy|power|all и нормы под возраст.",
      parameters: { type: "object", properties: { program: { type: "string", enum: Object.keys(PROGRAMS) }, age: { type: "integer", minimum: 4, maximum: 99 } }, required: ["program"], additionalProperties: false },
      async execute(_c, a) { const b = ageBand(a.age ?? 11); const list = PROGRAMS[a.program].map((k) => ({ id: k, name: EXERCISES[k].name, target: Math.max(3, EXERCISES[k].norms[b]), unit: EXERCISES[k].unit }));
        const sec = list.reduce((n, x) => n + (x.unit === "сек" ? x.target + 8 : Math.round(x.target * 2.2 + 8)), 0);
        return { data: { program: a.program, exercises: list, minutes: Math.ceil(sec / 60) }, summary: `${list.length} упражнений, около ${Math.ceil(sec / 60)} мин` }; } },
  ];
}
