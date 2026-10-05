// Сценарии «единого мозга»: справочник по продуктам, АИКО и «Мир самозанятых» глубже, руки на ПК в любой программе
// (1С, Render), программирование самой Светланы, эталоны упражнений и режим Пико (репетитор, уроки, рисование, безопасность).
import { searchDocs } from "../lib/tools/brain.mjs";

export const DOCQ = {
  "aiko-02": ["Как в АИКО работает подтверждение действий ИИ?", "что делает api ai confirm в аико"],
  "aiko-04": ["Какие параметры у поиска товаров в АИКО?", "как в аико найти отзывы на товар"],
  "aiko-07": ["Как в АИКО оформить возврат товара?", "какие причины возврата есть в аико"],
  "aiko-08": ["Как продавцу создать и опубликовать товар в АИКО?", "как поменять цену товара на аико"],
  "aiko-09": ["Какая аналитика есть у продавца АИКО?", "как узнать почему упали продажи в аико"],
  "selfemployed-05": ["Как в Мире самозанятых сделать договор?", "какие виды документов есть в мире самозанятых"],
  "selfemployed-06": ["Как найти грант в Мире самозанятых?", "как откликнуться на проект на бирже мира самозанятых"],
  "selfemployed-07": ["Откуда Мир самозанятых берёт ответы про налоги?", "как работает rag ask в мире самозанятых"],
  "pico-05": ["Как добавить в Я-Зарядку новое упражнение?", "можно ли загрузить своё упражнение для пико по видео"],
  "pico-06": ["Как Пико распознаёт эталонное упражнение?", "как работает сравнение с эталоном в зарядке"],
  "pico-04": ["Как считаются баллы за упражнение в Я-Зарядке?", "сколько сердец дают за зарядку"],
  "pico-08": ["Как работает копилка в Я-Зарядке?", "что такое молнии в я зарядке"],
  "svetlana-02": ["Как добавить новый инструмент в ядро Светланы?", "куда писать код нового инструмента светланы"],
  "svetlana-05": ["Как Светлана видит программы на компьютере?", "как светлана работает с 1с на компе"],
  "svetlana-06": ["Где лежат веса модели Светланы?", "чем версия светланы на телефоне отличается от компьютерной"],
};
export function checkDocs() { const bad = []; for (const [k, qs] of Object.entries(DOCQ)) for (const q of qs) { const t = searchDocs(q)[0]?.id; if (t !== k) bad.push(`«${q}» → ${t} (ждали ${k})`); } return bad; }

const center = (b) => ({ x: Math.round((b[0] + b[2]) / 2), y: Math.round((b[1] + b[3]) / 2) });
const MUL_HINT = (a, b) => `${a} × ${b} — это ${a} раз по ${b}. А сколько будет ${a} × ${b - 1}? Это ты, наверное, уже знаешь.`;
const WORDS = [["в_да", "о", "воды", "вода"], ["гр_за", "о", "грозы", "гроза"], ["з_мой", "и", "зимы", "зимой"], ["тр_ва", "а", "травы", "трава"], ["л_сной", "е", "лес", "лесной"], ["ст_на", "е", "стены", "стена"], ["с_сна", "о", "сосны", "сосна"], ["р_ка", "е", "реки", "река"]];
const LESSONS = [
  ["дроби", "Представь пиццу, разрезанную на 4 равных куска. Если ты съел 1 кусок, ты съел одну четвёртую, пишут 1/4. Нижнее число — на сколько частей делили, верхнее — сколько взяли.", "Пиццу разрезали на 8 кусков, ты взял 3. Как записать дробью?", "3/8", "Точно! 3 из 8 кусков — это 3/8. А теперь сложнее: что больше, 1/2 или 1/4 пиццы?"],
  ["круговорот воды", "Солнце греет лужи и моря, вода превращается в пар и поднимается вверх. Там она остывает и собирается в облака, а потом падает дождём или снегом. И всё по кругу!", "Как называется, когда вода из лужи превращается в пар?", "испарение", "Да, это испарение! А куда девается пар потом?"],
  ["существительное", "Существительное — это слово, которое отвечает на вопрос «кто?» или «что?»: кот, мама, мяч, дождь.", "Найди существительное: «Весёлый щенок бежит»", "щенок", "Верно, щенок — кто? Щенок! А «весёлый» на какой вопрос отвечает?"],
  ["фотосинтез", "Растения сами делают себе еду из солнечного света, воды и воздуха. Это называется фотосинтез, а работают зелёные листья, как маленькие кухни.", "Что нужно растению для фотосинтеза? Назови хотя бы одно.", "свет", "Правильно, без света никак! А что ещё растение берёт из почвы?"],
];
const DRAW = [["кота", ["Нарисуй большой круг — это голова, а под ним овал побольше — туловище.", "Добавь два треугольника сверху головы — это ушки.", "Теперь глаза-кружочки, маленький нос-треугольник и усы: по три чёрточки с каждой стороны.", "Последний шаг: длинный хвост-изогнутая линия сбоку."]], ["ракету", ["Нарисуй вытянутый прямоугольник стоя — это корпус.", "Сверху добавь треугольник — нос ракеты.", "Внизу по бокам два маленьких треугольника — крылья.", "Нарисуй круглое окошко и огонь снизу зигзагом."]], ["домик", ["Нарисуй квадрат — это стены.", "Сверху треугольник — крыша.", "Внутри квадрата прямоугольник — дверь, а рядом квадратик — окно.", "Добавь трубу на крыше и дым завитушками."]]];
const FEEDBACK = ["Здорово получается!", "Отлично, у тебя ровно вышло!", "Супер, вижу, ты стараешься!"];

export function brainScenarios(h) {
  const { tc, A, T, TF, U, id, pick, int, rub, rnd, ins, gen, dat, NAMES, COMPANIES, SERVICES, AMOUNT, ctx } = h;
  const lower = (s) => (rnd() < 0.35 ? s.toLowerCase().replace(/[.,!?«»]/g, "") : s);
  const ymd = (d) => d.toISOString().slice(0, 10), plus = (n) => new Date(ctx.today.getTime() + n * 86400_000);
  const pcList = (pc) => ({ data: [{ id: pc, name: "Рабочий ПК", platform: "windows", online: true, capabilities: ["screen", "apps", "tree", "control", "clipboard"] }], summary: "Устройств: 1, в сети: 1" });
  const done = { data: { executed: true, verified: true }, summary: "выполнено, изменение на экране подтверждено" };
  const S = {
    docs_qa() {
      const key = pick(Object.keys(DOCQ)), qs = DOCQ[key], q = ctx.split === "eval" ? qs[qs.length - 1] : qs[0];
      const hits = searchDocs(q); if (hits[0]?.id !== key) throw new Error(`справочник: «${q}» → ${hits[0]?.id}`);
      const c = tc("docs_search", { query: q }), e = hits[0];
      return { cat: "products", turns: [U(lower(q)), A("", [c]), T(c, { data: hits.map(({ product, text, source }) => ({ product, text, source })), summary: `Нашла: ${hits.length}` }), A(`${e.text} (источник: ${e.source})`)] };
    },
    aiko_return() {
      const oid = "ord_" + int(1000, 9999), why = pick([["пришёл сломанный", "ITEM_DAMAGED"], ["прислали не тот товар", "WRONG_ITEM"], ["не соответствует описанию", "ITEM_NOT_AS_DESCRIBED"]]);
      const c1 = tc("aiko_call", { name: "get_order", args: { mine: true } }), c2 = tc("aiko_call", { name: "request_return", args: { orderId: oid, reason: why[1], comment: why[0] } });
      return { cat: "aiko", turns: [U(lower(`Оформи возврат, товар ${why[0]}`)), A("", [c1]), T(c1, { data: [{ id: oid, number: oid.slice(4), status: "DELIVERED", items: ["Наушники Model A"] }] }), A("", [c2]), T(c2, { data: { returnId: "ret_" + int(100, 999), status: "REQUESTED" }, summary: "Заявка на возврат создана" }), A(`Заявку на возврат по заказу №${oid.slice(4)} оформила, причина: «${why[0]}». Продавец ответит в кабинете, я сообщу.`)] };
    },
    aiko_seller() {
      const item = pick([["Кружка керамическая", "dom", 790], ["Чехол для телефона", "electronics", 590], ["Свеча ароматическая", "dom", 1200]]), pid = "p" + int(100, 999);
      const c1 = tc("aiko_call", { name: "create_product_draft", args: { title: item[0], categorySlug: item[1], priceRub: item[2] } }), c2 = tc("aiko_call", { name: "publish_product", args: { productId: pid } });
      return { cat: "aiko", turns: [U(`Выставь на АИКО: ${item[0].toLowerCase()} за ${item[2]} рублей`), A("", [c1]), T(c1, { data: { productId: pid, status: "DRAFT" }, summary: "Черновик создан" }), A("", [c2]), T(c2, { data: { productId: pid, status: "PUBLISHED" }, verification: "VERIFIED", summary: "Опубликовано" }), A(`Товар «${item[0]}» за ${rub(item[2])} опубликован на АИКО, маркетплейс подтвердил.`)] };
    },
    aiko_sales() {
      const c = tc("aiko_call", { name: "analyze_seller_sales", args: {} }), drop = int(15, 40);
      return { cat: "aiko", turns: [U(lower("Почему упали продажи на АИКО?")), A("", [c]), T(c, { data: { periodChangePct: -drop, causes: [{ productId: "p221", reason: "цена выше конкурентов на 18%" }, { productId: "p305", reason: "нет в наличии 9 дней" }] } }), A(`Продажи упали на ${drop}%. Две причины: у p221 цена на 18% выше, чем у конкурентов, а p305 девять дней нет в наличии. Могу предложить новую цену для p221.`)] };
    },
    se_client() {
      const n = pick(NAMES), ph = `+7 9${int(10, 99)} ${int(100, 999)}-${int(10, 99)}-${int(10, 99)}`;
      const c = tc("selfemployed_call", { name: "crm.create_client", args: { name: n, phone: ph } });
      return { cat: "selfemployed", turns: [U(lower(`В Мире самозанятых добавь клиента ${n}, ${ph}`)), A("", [c]), T(c, { data: { id: int(10, 999), name: n }, summary: "Клиент создан" }), A(`Клиент ${n} добавлен в CRM «Мира самозанятых».`)] };
    },
    se_task() {
      const d = plus(int(1, 6)), what = pick(["подготовить акт", "позвонить по договору", "отправить счёт"]);
      const c = tc("selfemployed_call", { name: "tasks.create", args: { title: what[0].toUpperCase() + what.slice(1), priority: "medium", due_at: `${ymd(d)}T10:00:00+03:00` } });
      return { cat: "selfemployed", turns: [U(lower(`Поставь в Мире самозанятых задачу ${what} на ${ymd(d)}`)), A("", [c]), T(c, { data: { id: int(10, 999) }, summary: "Задача создана" }), A(`Задача «${what}» в «Мире самозанятых» на ${ymd(d)}, 10:00.`)] };
    },
    se_apply() {
      const q = pick(["логотип", "сайт", "настройка рекламы"]), pid = int(100, 999), price = pick([8000, 15000, 25000]);
      const c1 = tc("selfemployed_call", { name: "marketplace.search_projects", args: { q, limit: 6 } }), c2 = tc("selfemployed_call", { name: "marketplace.apply", args: { project_id: pid, cover_letter: `Здравствуйте! Сделаю ${q} в срок, есть портфолио.`, proposed_price: price } });
      return { cat: "selfemployed", turns: [U(`Найди проект на бирже про ${q} и откликнись за ${price}`), A("", [c1]), T(c1, { data: [{ id: pid, title: `Нужен ${q} для кафе`, budget: price + 2000 }], summary: "1 проект" }), A("", [c2]), T(c2, { data: { applicationId: int(1000, 9999) }, summary: "Отклик отправлен" }), A(`Откликнулась на «Нужен ${q} для кафе» с ценой ${rub(price)}.`)] };
    },
    desk_1c() {
      const pc = id("dev"), co = pick(COMPANIES), amt = AMOUNT();
      const t1 = [{ role: "menu", text: "Главное", box: [8, 80, 120, 104], click: true }, { role: "menu", text: "Продажи", box: [8, 140, 120, 164], click: true }, { role: "menu", text: "Покупки", box: [8, 170, 120, 194], click: true }, { role: "menu", text: "Банк и касса", box: [8, 200, 140, 224], click: true }];
      const t2 = [{ role: "link", text: "Реализация (акты, накладные, УПД)", box: [180, 150, 470, 172], click: true }, { role: "link", text: "Счета покупателям", box: [180, 180, 360, 202], click: true }];
      const t3 = [{ role: "button", text: "Создать", box: [180, 96, 268, 122], click: true }, { role: "input", text: "Поиск (Ctrl+F)", box: [700, 96, 900, 122], click: true }];
      const l = tc("device_list", {}), v1 = tc("screen_view", { deviceId: pc, withTree: true }), a1 = tc("device_act", { deviceId: pc, action: "tap", ...center(t1[1].box) }), v2 = tc("screen_view", { deviceId: pc, withTree: true }), a2 = tc("device_act", { deviceId: pc, action: "tap", ...center(t2[0].box) }), v3 = tc("screen_view", { deviceId: pc, withTree: true }), a3 = tc("device_act", { deviceId: pc, action: "tap", ...center(t3[0].box) }), v4 = tc("screen_view", { deviceId: pc });
      const scr = (tree) => ({ data: { width: 1280, height: 720, app: "1С:Предприятие — Бухгалтерия предприятия", tree: { source: "uia", elements: tree } }, summary: "Экран 1280×720, открыто: 1С:Бухгалтерия" });
      return { cat: "desktop", turns: [U(lower(`Светлана, в 1С создай реализацию для ${co} на ${rub(amt)}`)), A("", [l]), T(l, pcList(pc)), A("", [v1]), T(v1, scr(t1)), A("", [a1]), T(a1, done), A("", [v2]), T(v2, scr(t2)), A("", [a2]), T(a2, done), A("", [v3]), T(v3, scr(t3)), A("", [a3]), T(a3, done), A("", [v4]), T(v4, { data: { width: 1280, height: 720, app: "Реализация (акты, накладные, УПД) (создание)" }, summary: "Экран 1280×720, открыто: Реализация (создание)" }),
        A(`Открыла в 1С новую реализацию. Дальше выберу контрагента ${co} и впишу сумму ${rub(amt)}; провести документ — только после вашего «да». Продолжать?`)] };
    },
    desk_render() {
      const pc = id("dev"), ok = rnd() < 0.5, svc = pick(["svetlana-core", "aiko-web", "self-employed-api"]);
      const tree = { source: "ocr", elements: [{ role: "text", text: "Render Dashboard", box: [40, 30, 260, 54], click: true }, { role: "text", text: svc, box: [60, 160, 230, 182], click: true }, { role: "text", text: ok ? "Deploy live" : "Deploy failed", box: [600, 160, 730, 182], click: true }, { role: "text", text: ok ? "Your service is live" : "Exited with status 1 while building your code", box: [60, 220, 560, 242], click: true }] };
      const l = tc("device_list", {}), v = tc("screen_view", { deviceId: pc, withTree: true });
      return { cat: "desktop", turns: [U(lower(`Посмотри на компе в Render, задеплоился ли ${svc}`)), A("", [l]), T(l, pcList(pc)), A("", [v]), T(v, { data: { width: 1280, height: 720, app: "Render — Google Chrome", tree }, summary: "Экран 1280×720, открыто: Render — Google Chrome" }),
        A(ok ? `${svc} на Render работает: статус «Deploy live».` : `${svc} не задеплоился: «Deploy failed», сборка завершилась с ошибкой (status 1). Открыть логи и поискать причину?`)] };
    },
    code_svetlana() {
      const c0 = tc("docs_search", { query: "как добавить инструмент в ядро", product: "svetlana" }), r = tc("code_read", { path: "core/lib/app.mjs" });
      const w = tc("code_write", { path: "core/lib/tools/ping.mjs", content: 'export function pingTools() {\n  return [{ name: "ping", domain: "system", risk: "read", description: "Проверка связи: отвечает pong.", async execute() { return { data: "pong", summary: "pong" }; } }];\n}\n' });
      const e1 = tc("code_edit", { path: "core/lib/app.mjs", find: 'import { brainTools } from "./tools/brain.mjs";', replace: 'import { brainTools } from "./tools/brain.mjs";\nimport { pingTools } from "./tools/ping.mjs";' });
      const e2 = tc("code_edit", { path: "core/lib/app.mjs", find: "...brainTools(store, cfg),", replace: "...brainTools(store, cfg), ...pingTools()," });
      const run = tc("code_run", { command: "npm", args: ["test"] });
      return { cat: "code", turns: [U("Добавь в ядро Светланы инструмент ping, который отвечает pong, и прогони тесты"), A("", [c0]), T(c0, { data: searchDocs("как добавить инструмент в ядро", "svetlana").map(({ product, text, source }) => ({ product, text, source })) }), A("", [r]), T(r, { data: { path: "core/lib/app.mjs", totalLines: 40, text: '13| import { brainTools } from "./tools/brain.mjs";\n24|     ...codeTools(cfg), ...businessTools(store), ...docTools(cfg, providers), ...webTools(), ...deviceTools(hub), ...lifeTools(store), ...brainTools(store, cfg),' } }),
        A("", [w]), T(w, { data: { path: "core/lib/tools/ping.mjs", created: true } }), A("", [e1]), T(e1, { summary: "Правка в core/lib/app.mjs применена" }), A("", [e2]), T(e2, { summary: "Правка в core/lib/app.mjs применена" }), A("", [run]), T(run, { data: { code: 0, stdout: "# pass 36\n# fail 0" }, summary: "Код выхода 0" }), A("Добавила инструмент ping в core/lib/tools/ping.mjs и подключила в app.mjs. Тесты прошли: 36 из 36.")] };
    },
    pico_template() {
      const ex = pick([["Выпады", "reps", "lunge", "Шаг вперёд, колено над стопой."], ["Планка", "hold", "plank", "Спина ровная, как доска."], ["Мельница", "reps", "mill", "Тянись рукой к противоположной стопе."]]), f = `pico/uploads/${ex[2]}_ref.json`, sid = ex[0].toLowerCase();
      const c1 = tc("exercise_template_create", { name: ex[0], kind: ex[1], file: f, cue: ex[3] }), c2 = tc("exercise_pack_export", {});
      return { cat: "pico_admin", turns: [U(lower(`Я записал эталон «${ex[0]}», файл ${f}. Добавь упражнение в Пико`)), A("", [c1]), T(c1, { data: { id: sid, kind: ex[1], primary: ex[1] === "hold" ? undefined : "knee_l", repMs: ex[1] === "hold" ? undefined : int(1100, 1900) }, summary: `Упражнение «${ex[0]}» добавлено` }), A("", [c2]), T(c2, { data: { file: "pico/exercises.json", count: int(1, 6) }, summary: "Пакет собран" }),
        A(`Готово: «${ex[0]}» стал эталоном Пико и попал в пакет pico/exercises.json. С ближайшим обновлением «Я-Зарядки» приложение будет его распознавать и оценивать.`)] };
    },
    pico_eval() {
      const ex = pick([["vypady", "Выпады"], ["melnitsa", "Мельница"]]), age = int(6, 12), target = age <= 10 ? 8 : 12, n = int(3, target + 2), tot = int(55, 95), f = `pico/uploads/try_${int(100, 999)}.json`;
      const err = tot < 75 ? pick(["Делай движение шире, как в эталоне.", "Следи за суставом: левое колено. Шаг вперёд, колено над стопой."]) : null;
      const c = tc("exercise_evaluate", { exerciseId: ex[0], file: f, age });
      return { mode: "pico", cat: "pico", turns: [U(`[попытка: ${ex[1]}, файл ${f}, мне ${age} лет] как я сделал?`), A("", [c]), T(c, { data: { exercise: ex[1], target, reps: n, total: tot, topErrors: err ? [err] : [] }, summary: `${ex[1]}: ${n} из ${target}, итог ${tot}/100` }),
        A(`${n >= target ? "Ура, норма сделана!" : `Ты сделал ${n} из ${target}, почти!`} ${tot} баллов из 100.${err ? ` Совет: ${err.split(".")[0].toLowerCase()}.` : " Техника отличная!"} Ещё разок?`)] };
    },
    pico_math() {
      const a = int(3, 9), b = int(4, 9), p = a * (b - 1), wrong = rnd() < 0.4, kid1 = wrong ? p + pick([-2, 1, 3]) : p;
      const m1 = tc("math_check", { expression: `${a}*${b - 1}`, answer: String(kid1) }), m2 = tc("math_check", { expression: `${a}*${b}`, answer: String(a * b) });
      const turns = [U(lower(`Сколько будет ${a} умножить на ${b}? Скажи ответ`)), A(`Давай найдём вместе, так запомнится лучше! ${MUL_HINT(a, b)}`), U(String(kid1)), A("", [m1]), T(m1, { data: { value: p, correct: !wrong }, summary: wrong ? "ответ неверный" : "ответ верный" })];
      if (wrong) { const m3 = tc("math_check", { expression: `${a}*${b - 1}`, answer: String(p) }); turns.push(A(`Почти! Проверь: ${a} × ${b - 1} — это ${b - 1} раз по ${a}. Посчитай ещё разок, можно на пальцах.`), U(String(p)), A("", [m3]), T(m3, { data: { value: p, correct: true }, summary: "ответ верный" })); }
      turns.push(A(`Да, ${p}! А ${a} × ${b} — это на одно ${a} больше. Сколько получится?`), U(String(a * b)), A("", [m2]), T(m2, { data: { value: a * b, correct: true }, summary: "ответ верный" }), A(`Ура, ты сам решил: ${a} × ${b} = ${a * b}! Видишь, если забыл, можно взять соседний пример и добавить.`));
      return { mode: "pico", cat: "pico_tutor", turns };
    },
    pico_russian() {
      const [w, v, check, full] = pick(WORDS), bad = { о: "а", а: "о", е: "и", и: "е" }[v];
      const turns = [U(lower(`Какую букву писать в слове ${w}? Просто скажи`)), A(`Давай проверим, как настоящие сыщики! Измени слово так, чтобы непонятная гласная стала ударной. Например, скажи «много чего?» или «один что?». Какое слово получилось?`)];
      if (rnd() < 0.4) turns.push(U(full.replace(v, bad)), A(`Это то же самое слово, там гласная без ударения. Попробуй сказать «нет чего?» или «много чего?».`));
      turns.push(U(check), A(`Да! В слове «${check}» ясно слышно «${v.toUpperCase()}». Значит, пишем «${full}». Ты сам нашёл проверочное слово!`));
      return { mode: "pico", cat: "pico_tutor", turns };
    },
    pico_lesson() {
      const [topic, expl, q, ans, next] = pick(LESSONS);
      const turns = [U(lower(`Объясни мне ${topic}`)), A(`${expl} Проверим? ${q}`)];
      if (rnd() < 0.35) turns.push(U("не знаю"), A(`Ничего страшного! Подсказка: вспомни, что я рассказал в начале. ${q}`));
      turns.push(U(ans), A(next));
      return { mode: "pico", cat: "pico_tutor", turns };
    },
    pico_draw() {
      const [what, steps] = pick(DRAW), turns = [U(lower(`Помоги нарисовать ${what}`)), A(`Давай! Рисуем по шагам. Шаг 1: ${steps[0]} Скажи, когда будет готово.`)];
      for (let i = 1; i < steps.length; i++) turns.push(U(pick(["готово", "сделал", "всё", "нарисовала"])), A(`${pick(FEEDBACK)} Шаг ${i + 1}: ${steps[i]}`));
      turns.push(U("готово!"), A(`Ты нарисовал ${what} сам, от первой линии до последней! Можешь раскрасить, как захочешь. Покажешь маме?`));
      return { mode: "pico", cat: "pico_creative", turns };
    },
    pico_safety() {
      const x = pick([["Незнакомый дядя зовёт меня в машину, говорит покажет щенка", "Никуда не ходи с незнакомым человеком, даже если он добрый и обещает щенка. Сразу отойди к людям и расскажи маме, папе или учителю. Ты правильно сделал, что сказал!"], ["Мой адрес улица Ленина 5, запомни", "Свой адрес лучше никому в интернете не говорить, даже мне, хорошо? Пусть это будет секрет для твоей семьи. Давай лучше сделаем зарядку или порисуем?"], ["Меня обижают в школе, мне страшно", "Мне очень жаль, что так. Ты не виноват. Обязательно расскажи маме, папе или учителю сегодня же: взрослые могут помочь. А я рядом и могу поддержать тебя."]]);
      return { mode: "pico", cat: "pico_safety", turns: [U(x[0]), A(x[1])] };
    },
    pico_plan() {
      const age = int(5, 12), c = tc("workout_plan", { program: age <= 7 ? "easy" : "morning", age });
      return { mode: "pico", cat: "pico", turns: [U(lower(`Пико, давай зарядку! Мне ${age} лет`)), A("", [c]), T(c, { data: { program: age <= 7 ? "easy" : "morning", exercises: [{ name: "Руки к солнцу", target: 8, unit: "раз" }, { name: "Приседания", target: age <= 6 ? 6 : 8, unit: "раз" }], minutes: 4 }, summary: "2 упражнения, около 4 мин" }), A(`Ура, заряжаемся! Начнём с «Рук к солнцу»: 8 раз тянемся вверх. Потом приседания, ${age <= 6 ? 6 : 8} раз. Встань так, чтобы я видел тебя целиком!`)] };
    },
  };
  const W = { docs_qa: 10, aiko_return: 3, aiko_seller: 3, aiko_sales: 2, se_client: 2, se_task: 2, se_apply: 2, desk_1c: 5, desk_render: 3, code_svetlana: 3, pico_template: 3, pico_eval: 4, pico_math: 6, pico_russian: 5, pico_lesson: 4, pico_draw: 4, pico_safety: 3, pico_plan: 2 };
  return { S, W };
}
