// Дополнительные сценарии: законы/НПД по базе знаний, календарь, голосовое управление ПК и телефоном,
// зарядка (ya-zaryadka-ai), договоры и гранты («Мир самозанятых»), покупки и заказы (АИКО), расходы, задачи, таблицы, видео, код.
import { searchKnowledge, computeScore, EXERCISES, FORM_HINTS, PROGRAMS } from "../lib/tools/life.mjs";

export const QUESTIONS = {
  "npd-rates": ["Какой налог платит самозанятый?", "Сколько процентов налог у самозанятых с физлиц и с компаний?", "ставка нпд какая"],
  "npd-deduction": ["Что за вычет 10 000 у самозанятых?", "Почему с меня взяли 3 процента а не 4?"],
  "npd-limit": ["Какой лимит дохода у самозанятого в год?", "Сколько можно заработать на НПД за год?"],
  "npd-lost": ["Что будет, если я превышу лимит 2,4 млн?", "я заработал больше двух с половиной миллионов что теперь будет с нпд"],
  "npd-forbidden": ["Можно ли самозанятому нанять сотрудника?", "Можно ли на НПД перепродавать товары?"],
  "npd-not-object": ["Можно ли работать самозанятым на бывшего работодателя?", "Облагается ли НПД сдача квартиры в аренду?"],
  "npd-period": ["До какого числа платить налог самозанятому?", "когда платить налог нпд"],
  "npd-receipt": ["Когда нужно пробивать чек?", "До какого числа пробить чек за перевод?"],
  "npd-fines": ["Какой штраф, если не пробил чек?", "что будет за непробитый чек"],
  "npd-contrib": ["Нужно ли самозанятому платить пенсионные взносы?", "Платит ли ИП на НПД фиксированные взносы?"],
  "npd-clients": ["Компания платит НДФЛ и взносы за самозанятого?", "Что нужно компании, чтобы не платить налоги за самозанятого исполнителя?"],
  "npd-register": ["Как стать самозанятым?", "где зарегистрироваться самозанятым"],
  "npd-cancel": ["Как аннулировать чек?", "Клиент вернул деньги, что делать с чеком?"],
  "gk-services": ["Что обязательно должно быть в договоре оказания услуг?"],
  "gk-contract-work": ["Какие существенные условия у договора подряда?"],
  "invoice-free": ["Есть ли обязательная форма счёта на оплату?", "Как правильно выставить счёт самозанятому?"],
  "pd-152": ["Можно ли хранить телефоны клиентов в CRM?"],
};
const MISSES = ["Сколько стоит патент для ИП в Москве?", "Какая ставка УСН в Татарстане?", "Как получить налоговый вычет за лечение зубов?", "Какой МРОТ в следующем году?"];
const WD = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const ymd = (d) => d.toISOString().slice(0, 10);
const human = (d) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
const plusDays = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
const hm = (h, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const voice = (s) => s.toLowerCase().replace(/[.,!?«»]/g, "").replace(/\s+/g, " ").trim(); // так приходит распознанная речь

/** Каждый вопрос базы знаний должен находить «свою» запись — иначе обучили бы неверному ответу. */
export function checkQuestions() {
  const bad = []; for (const [k, qs] of Object.entries(QUESTIONS)) for (const q of qs) { const t = searchKnowledge(q)[0]?.id; if (t !== k) bad.push(`«${q}» → ${t} (ждали ${k})`); }
  return bad;
}

export function extraScenarios(h) {
  const { tc, A, T, TF, U, id, pick, int, rub, rnd, dat, ins, gen, NAMES, COMPANIES, SERVICES, AMOUNT, ctx } = h;
  const maybeVoice = (s) => (rnd() < 0.35 ? voice(s) : s);
  const S = {
    kb_qa() {
      const key = pick(Object.keys(QUESTIONS)), qs = QUESTIONS[key];
      const q = qs.length > 1 ? (ctx.split === "eval" ? qs[qs.length - 1] : pick(qs.slice(0, -1))) : qs[0]; // последняя формулировка — только для экзамена
      const hits = searchKnowledge(q);
      if (!hits.length || hits[0].id !== key) throw new Error(`база знаний: «${q}» → ${hits[0]?.id}`);
      const c = tc("knowledge_search", { query: q }); const e = hits[0];
      return { cat: "knowledge", turns: [U(maybeVoice(q)), A("", [c]), T(c, { data: hits.map(({ text, source, url }) => ({ text, source, url })), summary: `Нашла: ${hits.length}` }), A(`${e.text} Источник: ${e.source}.`)] };
    },
    kb_miss() {
      const q = pick(MISSES); const c = tc("knowledge_search", { query: q });
      return { cat: "honesty", turns: [U(q), A("", [c]), TF(c, "в базе знаний нет ответа на это — нужен официальный источник (nalog.gov.ru, consultant.ru)"), A("В моей проверенной базе этого нет, а выдумывать про налоги не буду. Точный ответ — на nalog.gov.ru; могу открыть страницу и прочитать, если скажете.")] };
    },
    kb_calc() {
      const amt = pick([10000, 20000, 30000, 50000, 75000, 100000]), biz = rnd() < 0.5, r = biz ? 6 : 4, rd = biz ? 4 : 3;
      const q = `Сколько налога заплатить с ${rub(amt)} от ${biz ? "компании" : "физлица"}?`; const c = tc("knowledge_search", { query: "ставка налога НПД и вычет" }); const hits = searchKnowledge("ставка налога НПД и вычет");
      return { cat: "knowledge", turns: [U(q), A("", [c]), T(c, { data: hits.map(({ text, source }) => ({ text, source })) }), A(`По ставке ${r}% — ${rub(amt * r / 100)}. Пока не израсходован вычет 10 000 ₽, фактически ${rd}%, то есть ${rub(amt * rd / 100)}. Источник: 422-ФЗ, ст. 10 и 12.`)] };
    },
    cal_add() {
      const n = pick(NAMES), k = pick([1, 1, 2, 3]), d = plusDays(ctx.today, k), H = int(9, 18), M = pick([0, 0, 30]);
      const word = k === 1 ? "завтра" : k === 2 ? "послезавтра" : `${d.getUTCDay() === 2 ? "во" : "в"} ${WD[d.getUTCDay()]}`;
      const what = pick([`позвонить ${dat(n)}`, `встреча с ${ins(n)}`, `созвон с ${ins(n)} по проекту`, "отправить акт клиенту"]);
      const start = `${ymd(d)}T${hm(H, M)}`; const c = tc("calendar_add", { title: what[0].toUpperCase() + what.slice(1), start });
      const ask = pick([`Напомни ${word} в ${hm(H, M)} ${what}`, `Запиши в календарь: ${word}, ${hm(H, M)} — ${what}`, `Светлана, ${word} в ${H}${M ? ":" + M : ""} ${what}, запиши`]);
      return { cat: "calendar", turns: [U(maybeVoice(ask)), A("", [c]), T(c, { data: { id: id("evt"), start, clash: [] }, summary: `Событие на ${start.replace("T", " ")}` }), A(`Добавила в календарь: «${JSON.parse(c.function.arguments).title}», ${word} (${human(d)}) в ${hm(H, M)}.`)] };
    },
    cal_list() {
      const k = pick([0, 1]), d = plusDays(ctx.today, k), c = tc("calendar_list", { from: ymd(d), to: ymd(d) });
      const ev = [{ id: id("evt"), title: `Звонок ${dat(pick(NAMES))}`, start: `${ymd(d)}T10:00`, durationMin: 30 }, { id: id("evt"), title: "Сдать проект", start: `${ymd(d)}T16:00`, durationMin: 60 }].slice(0, int(0, 2));
      return { cat: "calendar", turns: [U(maybeVoice(k ? "Что у меня завтра?" : "Какие планы на сегодня?")), A("", [c]), T(c, { data: ev, summary: `Событий: ${ev.length}` }), A(ev.length ? `${k ? "Завтра" : "Сегодня"}: ${ev.map((e) => `${e.start.slice(11)} — ${e.title}`).join(", ")}.` : `${k ? "На завтра" : "На сегодня"} в календаре пусто.`)] };
    },
    cal_export() {
      const c = tc("calendar_export", {});
      const k = int(1, 6), ics = ["BEGIN:VCALENDAR", ...Array.from({ length: k }, (_, i) => `BEGIN:VEVENT…${i + 1}…END:VEVENT`), "END:VCALENDAR"].join("\r\n");
      return { cat: "calendar", turns: [U(maybeVoice(pick(["Перенеси мой календарь в телефон", "Выгрузи календарь для Google"]))), A("", [c]), T(c, { data: { ics }, summary: `Календарь: ${k} событий в формате .ics` }), A(`Готов файл .ics, событий: ${k}. Откройте его на телефоне — события с напоминаниями добавятся в Google или Яндекс Календарь.`)] };
    },
    voice_pc() {
      const pc = id("dev"), ph = id("dev"), app = pick(["Telegram", "Chrome", "VS Code", "Проводник", "Калькулятор"]);
      const l = tc("device_list", {}), v = tc("screen_view", { deviceId: pc }), a = tc("device_act", { deviceId: pc, action: "launch", app }), v2 = tc("screen_view", { deviceId: pc });
      return { cat: "voice_device", turns: [U(voice(`Светлана, открой ${app} на компьютере`)), A("", [l]), T(l, { data: [{ id: ph, name: "Телефон", platform: "android", online: true, capabilities: ["screen", "tree", "apps", "control"] }, { id: pc, name: "Рабочий ПК", platform: "windows", online: true, capabilities: ["screen", "apps", "control"] }], summary: "Устройств: 2, в сети: 2" }), A("", [v]), T(v, { data: { width: 1280, height: 720, app: "Рабочий стол" }, summary: "Экран 1280×720" }), A("", [a]), T(a, { data: { executed: true, verified: true }, summary: "выполнено, изменение на экране подтверждено" }), A("", [v2]), T(v2, { data: { width: 1280, height: 720, app }, summary: `Экран 1280×720, открыто: ${app}` }), A(`Открыла ${app} на компьютере.`)] };
    },
    voice_tap() {
      const ph = id("dev"), btn = pick(["Отправить", "Далее", "Принять", "Сохранить"]); const x1 = int(40, 300), y1 = int(800, 1100);
      const l = tc("device_list", {}), v = tc("screen_view", { deviceId: ph, withTree: true }), a = tc("device_act", { deviceId: ph, action: "tap", x: x1 + 60, y: y1 + 30 }), v2 = tc("screen_view", { deviceId: ph });
      return { cat: "voice_device", turns: [U(voice(`Нажми кнопку «${btn}» на телефоне`)), A("", [l]), T(l, { data: [{ id: ph, name: "Телефон", platform: "android", online: true, capabilities: ["screen", "tree", "apps", "control"] }], summary: "Устройств: 1, в сети: 1" }), A("", [v]), T(v, { data: { width: 540, height: 1200, app: "org.telegram.messenger", tree: { root: { class: "FrameLayout", children: [{ class: "Button", text: btn, click: true, bounds: [x1, y1, x1 + 120, y1 + 60] }] } } }, summary: "Экран 540×1200" }), A("", [a]), T(a, { data: { executed: true, verified: true }, summary: "выполнено, изменение на экране подтверждено" }), A("", [v2]), T(v2, { data: { width: 540, height: 1200 }, summary: "Экран 540×1200" }), A(`Нажала «${btn}», экран сменился.`)] };
    },
    voice_type() {
      const pc = id("dev"), text = pick(["купить молоко", "отчёт за сентябрь готов", "привет, созвонимся в 5?"]);
      const l = tc("device_list", {}), v = tc("screen_view", { deviceId: pc }), a = tc("device_act", { deviceId: pc, action: "type", text }), v2 = tc("screen_view", { deviceId: pc });
      return { cat: "voice_device", turns: [U(voice(`Напечатай на компьютере ${text}`)), A("", [l]), T(l, { data: [{ id: pc, name: "Ноутбук", platform: "linux", online: true, capabilities: ["screen", "control"] }], summary: "Устройств: 1, в сети: 1" }), A("", [v]), T(v, { data: { width: 1366, height: 768, app: "Telegram" }, summary: "Экран 1366×768, открыто: Telegram" }), A("", [a]), T(a, { data: { executed: true, verified: true }, summary: "выполнено, изменение на экране подтверждено" }), A("", [v2]), T(v2, { data: { width: 1366, height: 768, app: "Telegram" }, summary: "Экран 1366×768" }), A(`Напечатала «${text}» в Telegram. Отправить — нажать Enter?`)] };
    },
    workout() {
      const exk = pick(Object.keys(EXERCISES)), age = int(4, 14), n = int(3, 12), base = int(55, 90);
      const reps = Array.from({ length: n }, () => ({ amp: int(base - 15, Math.min(100, base + 10)), form: int(base - 10, Math.min(100, base + 10)), dur: int(800, 1600) }));
      const codes = Object.keys(FORM_HINTS); const errs = Array.from({ length: int(0, 4) }, () => pick(codes));
      const c = tc("workout_analyze", { exercise: exk, age, reps, ...(errs.length ? { errors: errs } : {}) });
      const s = computeScore(reps), target = Math.max(3, EXERCISES[exk].norms[age <= 6 ? 0 : age <= 10 ? 1 : 2]);
      const freq = {}; errs.forEach((e) => (freq[e] = (freq[e] || 0) + 1)); const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => FORM_HINTS[k]);
      const who = pick(["сыну", "дочке", "мне"]);
      return { cat: "fitness", turns: [U(`Разбери зарядку (${who} ${age} лет), упражнение ${exk}: ${JSON.stringify({ reps, errors: errs })}`), A("", [c]), T(c, { data: { exercise: EXERCISES[exk].name, target, ...s, topErrors: top }, summary: `${EXERCISES[exk].name}: ${s.reps} из ${target}, итог ${s.total}/100` }),
        A(`${EXERCISES[exk].name}: ${s.reps} из ${target}${s.reps >= target ? " — норма выполнена!" : "."} Итог ${s.total} из 100: техника ${s.accuracy}, амплитуда ${s.precision}, ровность ${s.consistency}.${top.length ? " Что поправить: " + top.join(" ") : " Ошибок техники не заметила, отлично!"}`)] };
    },
    workout_plan() {
      const age = int(4, 14), prog = age <= 7 ? pick(["easy", "morning"]) : pick(["morning", "power"]); const b = age <= 6 ? 0 : age <= 10 ? 1 : 2;
      const list = PROGRAMS[prog].map((k) => ({ name: EXERCISES[k].name, target: Math.max(3, EXERCISES[k].norms[b]), unit: EXERCISES[k].unit }));
      const min = Math.ceil(list.reduce((n, x) => n + (x.unit === "сек" ? x.target + 8 : Math.round(x.target * 2.2 + 8)), 0) / 60);
      const c = tc("workout_plan", { program: prog, age });
      return { cat: "fitness", turns: [U(maybeVoice(`Составь утреннюю зарядку для ребёнка ${age} лет`)), A("", [c]), T(c, { data: { program: prog, exercises: list, minutes: min }, summary: `${list.length} упражнений, около ${min} мин` }), A(`Зарядка на ${min} мин: ${list.map((x) => `${x.name} — ${x.target} ${x.unit}`).join(", ")}.`)] };
    },
    se_contract() {
      const co = pick(COMPANIES), s = pick(SERVICES), amt = AMOUNT(), did = id("doc");
      const c1 = tc("selfemployed_call", { name: "documents.create", args: { kind: "contract", title: `Договор: ${s}`, amount: amt } }), c2 = tc("selfemployed_call", { name: "documents.set_data", args: { document_id: did, data: { client_name: co, service: s, amount: amt } } }), c3 = tc("selfemployed_call", { name: "documents.generate", args: { document_id: did } });
      return { cat: "selfemployed", turns: [U(maybeVoice(`Сгенерируй договор с ${co} на «${s}», сумма ${rub(amt)}`)), A("", [c1]), T(c1, { data: { id: did, kind: "contract" }, summary: "Черновик создан" }), A("", [c2]), T(c2, { data: { id: did }, summary: "Данные записаны" }), A("", [c3]), T(c3, { data: { preview: true, missing: ["client_inn", "deadline"] }, summary: "Предпросмотр готов, не хватает полей: client_inn, deadline" }), A(`Черновик договора с ${co} готов, предпросмотр открыт. Не хватает ИНН заказчика и срока оказания услуг — подскажете? Потом утвержу и сделаю DOCX.`)] };
    },
    se_grants() {
      const q = pick(["грант для самозанятых на оборудование", "соцконтракт", "субсидия на открытие дела"]); const c = tc("selfemployed_call", { name: "grants.search", args: { q, limit: 6 } });
      return { cat: "selfemployed", turns: [U(maybeVoice(`Найди ${q}`)), A("", [c]), T(c, { data: [{ title: "Социальный контракт на открытие дела", amount: 350000, region: "все регионы", source: "msp" }, { title: "Грант молодым предпринимателям до 25 лет", amount: 500000, region: "по программе региона", source: "msp" }], summary: "2 программы" }), A(`Нашла две программы: соцконтракт на открытие дела (до ${rub(350000)}) и грант молодым предпринимателям до 25 лет (до ${rub(500000)}). Условия зависят от региона — открыть подробности?`)] };
    },
    aiko_search() {
      const item = pick(["наушники", "кофемашину", "рюкзак", "детский самокат"]), max = pick([3000, 5000, 10000, 20000]); const c = tc("aiko_call", { name: "search_products", args: { query: item, maxPrice: max, availabilityOnly: true, limit: 5 } });
      return { cat: "aiko", turns: [U(maybeVoice(`Найди на АИКО ${item} до ${max} рублей`)), A("", [c]), T(c, { data: [{ id: "p1", title: `${item} Model A`, priceRub: Math.round(max * 0.7), rating: 4.7, availability: "AVAILABLE" }, { id: "p2", title: `${item} Model B`, priceRub: Math.round(max * 0.9), rating: 4.4, availability: "LIMITED" }], summary: "2 товара" }), A(`Нашла 2 варианта: Model A за ${rub(Math.round(max * 0.7))} (рейтинг 4,7, в наличии) и Model B за ${rub(Math.round(max * 0.9))} (4,4, осталось мало). Сравнить или положить в корзину?`)] };
    },
    aiko_track() {
      const c1 = tc("aiko_call", { name: "get_order", args: { mine: true } }), oid = "ord_" + int(1000, 9999), c2 = tc("aiko_call", { name: "get_tracking", args: { orderId: oid } });
      return { cat: "aiko", turns: [U(maybeVoice("Где мой заказ?")), A("", [c1]), T(c1, { data: [{ id: oid, number: oid.slice(4), status: "SHIPPED" }] }), A("", [c2]), T(c2, { data: { carrier: "СДЭК", status: "IN_TRANSIT", eta: ymd(plusDays(ctx.today, 2)) }, summary: "В пути" }), A(`Заказ №${oid.slice(4)} в пути (СДЭК), ожидается ${human(plusDays(ctx.today, 2))}.`)] };
    },
    expense() {
      const amt = pick([500, 1200, 3500, 9900]), what = pick(["хостинг", "реклама", "такси к клиенту", "канцелярия"]), d = ymd(ctx.today); const c = tc("acc_expense_add", { amount: amt, date: d, category: what });
      return { cat: "accounting", turns: [U(maybeVoice(`Запиши расход ${amt} рублей на ${what} сегодня`)), A("", [c]), T(c, { data: { id: id("exp") }, summary: "Расход записан" }), A(`Записала расход ${rub(amt)}: ${what}. Напомню: на НПД расходы налог не уменьшают, это для вашего учёта.`)] };
    },
    crm_task() {
      const n = dat(pick(NAMES)), d = ymd(plusDays(ctx.today, int(1, 5))); const c = tc("crm_task_add", { title: `Отправить КП ${n}`, due: d });
      return { cat: "crm", turns: [U(maybeVoice(`Поставь задачу отправить КП ${n} до ${human(new Date(d + "T00:00:00Z"))}`)), A("", [c]), T(c, { data: { id: id("tsk") }, summary: "Задача создана" }), A(`Задача «Отправить КП ${n}» поставлена, срок — ${human(new Date(d + "T00:00:00Z"))}.`)] };
    },
    sheet() {
      const y = ctx.today.getUTCFullYear(), m = ctx.today.getUTCMonth(), from = `${y}-${String(m + 1).padStart(2, "0")}-01`, to = ymd(ctx.today);
      const r = tc("acc_incomes_list", { from, to }); const rows = [[from, "Иван Петров", "консультация", "3000"], [to, "ООО Луч", "разработка сайта", "40000"]];
      const s = tc("sheet_create", { title: "Доходы за месяц", columns: ["Дата", "Плательщик", "Услуга", "Сумма"], rows });
      return { cat: "docs", turns: [U("Сделай таблицу доходов за этот месяц"), A("", [r]), T(r, { data: [{ id: id("inc"), date: from, amount: 3000, payer: "individual", payerName: "Иван Петров", service: "консультация", receipt: null }, { id: id("inc"), date: to, amount: 40000, payer: "business", payerName: "ООО Луч", service: "разработка сайта", receipt: null }], summary: "Записей: 2, на сумму 43000 ₽" }), A("", [s]), T(s, { data: { pdf: true }, summary: "Таблица: 2 строки" }), A(`Таблица доходов за месяц готова: 2 записи на ${rub(43000)}.`)] };
    },
    video() {
      const p = pick(["рекламный ролик кофейни, утро, пар над чашкой", "анимация логотипа АИКО, вращение, фиолетовый фон", "короткое видео для сторис про скидку 20%"]); const c = tc("video_generate", { prompt: p, seconds: pick([5, 8, 10]) });
      return { cat: "media", turns: [U(maybeVoice(`Сделай видео: ${p}`)), A("", [c]), T(c, { data: { provider: "video" }, summary: "Видео готово" }), A("Видео готово, смотрите выше. Переделать короче или в другом стиле?")] };
    },
    code_new() {
      const task = pick([["посчитать сумму чисел в файле numbers.txt", "sum_numbers.py", "print(sum(float(x) for x in open('numbers.txt').read().split()))\n", "123.5"], ["вывести список файлов больше 1 МБ", "big_files.py", "import os\nfor r, _, fs in os.walk('.'):\n    for f in fs:\n        p = os.path.join(r, f)\n        if os.path.getsize(p) > 1_000_000: print(p)\n", "./video.mp4"]]);
      const w = tc("code_write", { path: task[1], content: task[2] }), r = tc("code_run", { command: "python3", args: [task[1]] });
      return { cat: "code", turns: [U(`Напиши скрипт на Python, чтобы ${task[0]}, и запусти`), A("", [w]), T(w, { data: { path: task[1], created: true }, summary: `Создан ${task[1]}` }), A("", [r]), T(r, { data: { code: 0, stdout: task[3] }, summary: "Код выхода 0" }), A(`Написала ${task[1]} и запустила, вывод: ${task[3]}`)] };
    },
    income_cancel() {
      const amt = AMOUNT(), iid = id("inc"), f = tc("acc_incomes_list", { from: ymd(plusDays(ctx.today, -30)), to: ymd(ctx.today) }), c = tc("acc_income_cancel", { incomeId: iid, reason: "возврат средств" });
      return { cat: "accounting", turns: [U(maybeVoice(`Клиент вернул деньги за последнюю оплату ${rub(amt)}, отмени доход`)), A("", [f]), T(f, { data: [{ id: id("inc"), date: ymd(plusDays(ctx.today, -9)), amount: 3000, payer: "individual", payerName: "Анна Смирнова", service: "консультация", receipt: "20abc1" }, { id: iid, date: ymd(plusDays(ctx.today, -2)), amount: amt, payer: "individual", payerName: "Олег Кузнецов", service: "консультация", receipt: "20def7" }], summary: "Записей: 2" }), A("", [c]), T(c, { data: { id: iid, cancelled: true }, summary: "Запись аннулирована" }), A(`Отменила доход ${rub(amt)}. Чек тоже аннулируйте в «Мой налог» (причина «Возврат средств») — сама я туда не пишу.`)] };
    },
    cal_remove() {
      const d = plusDays(ctx.today, 1), eid = id("evt"), l = tc("calendar_list", { from: ymd(d), to: ymd(d) }), c = tc("calendar_remove", { eventId: eid }), n = pick(NAMES);
      return { cat: "calendar", turns: [U(maybeVoice(`Отмени завтрашнюю встречу с ${ins(n)}`)), A("", [l]), T(l, { data: [{ id: eid, title: `Встреча с ${ins(n)}`, start: `${ymd(d)}T12:00`, durationMin: 60 }], summary: "Событий: 1" }), A("", [c]), T(c, { data: { id: eid }, summary: `Удалено «Встреча с ${ins(n)}»` }), A(`Удалила из календаря встречу с ${ins(n)} на завтра, 12:00.`)] };
    },
    apps() {
      const ph = id("dev"), l = tc("device_list", {}), a = tc("apps_list", { deviceId: ph });
      return { cat: "device", turns: [U(maybeVoice("Какие приложения есть на телефоне?")), A("", [l]), T(l, { data: [{ id: ph, name: "Телефон", platform: "android", online: true, capabilities: ["apps"] }], summary: "Устройств: 1, в сети: 1" }), A("", [a]), T(a, { data: [{ id: "org.telegram.messenger", name: "Telegram" }, { id: "ru.sberbankmobile", name: "СберБанк" }, { id: "com.whatsapp", name: "WhatsApp" }], summary: "Приложений: 3" }), A("На телефоне вижу: Telegram, СберБанк и WhatsApp. Открыть какое-нибудь?")] };
    },
    code_explore() {
      const q = pick(["TODO", "fetch(", "password"]), l = tc("code_list", { depth: 2 }), sr = tc("code_search", { query: q });
      return { cat: "code", turns: [U(`Что за проект в папке и где у нас ${q}?`), A("", [l]), T(l, { data: { files: ["package.json", "src/", "src/app.js", "src/api.js", "test/"], truncated: false }, summary: "Файлов и папок: 5" }), A("", [sr]), T(sr, { data: { hits: [`src/api.js:14: ${q} …`] }, summary: "Совпадений: 1" }), A(`Это Node-проект: package.json, код в src (app.js, api.js) и тесты в test. «${q}» встречается один раз — src/api.js, строка 14.`)] };
    },
    recall() {
      const c = tc("memory_recall", { query: "ИНН" });
      return { cat: "memory", turns: [U(maybeVoice("Напомни мой ИНН")), A("", [c]), T(c, { data: [{ key: "ИНН", value: "253801234567" }], summary: "Нашла: 1" }), A("Ваш ИНН: 253801234567.")] };
    },
  };
  const W = { kb_qa: 16, kb_miss: 3, kb_calc: 4, cal_add: 8, cal_list: 4, cal_export: 2, voice_pc: 5, voice_tap: 4, voice_type: 3, workout: 6, workout_plan: 3, se_contract: 4, se_grants: 2, aiko_search: 4, aiko_track: 2, expense: 3, crm_task: 3, sheet: 2, video: 3, code_new: 3, income_cancel: 2, cal_remove: 2, apps: 2, code_explore: 2, recall: 2 };
  return { S, W };
}
