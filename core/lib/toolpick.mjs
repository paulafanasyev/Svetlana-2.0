// Выбор инструментов для маленькой модели на телефоне: вместо всех ~60 схем (десятки тысяч токенов) — 8–12 нужных под запрос.
// Детерминированно (одинаковый запрос → одинаковый набор), чтобы llama.cpp переиспользовал кэш начала запроса между шагами.

/** Подсказки: основа слова в запросе → какие инструменты (по подстроке имени) нужны. */
const HINTS = [
  [/прилож|сайт|код|прогр|файл|скрип|игр|html|react|проек|вёрст|верст|страниц|калькул/, ["code_"]],
  [/экран|нажм|нажа|откро|откры|телеф|кликн|введи|впиши|напеч|листа|свайп|прокру|1с|браузер|ватсап|whatsapp|телеграм/, ["screen", "device", "app"]],
  [/клиен|сделк|конта|задач|crm|воронк|напомин/, ["crm", "contact", "deal", "task"]],
  [/доход|расход|налог|нпд|чек|деньг|оплат|выруч|бухгал|лимит/, ["acc_", "income", "expense", "tax"]],
  [/докум|догов|презе|слайд|счёт|счет|pdf|табли|письм|акт|отчёт|отчет/, ["doc_", "slides_", "invoice_", "sheet_"]],
  [/найди|поиск|интер|новос|загугл|прочит|ссылк|курс|погод/, ["web", "search", "fetch"]],
  [/встреч|кален|распис|завтр|сегодн|недел|созвон/, ["cal", "event"]],
  [/закон|стать|кодекс|422|фз|юрид/, ["knowledge"]],
  [/аико|aiko|маркетпл/, ["aiko"]],
  [/github|гитхаб|репозит|коммит|пулл|pull|push|пуш|запуш|issue|ишью|workflow|(^|[^а-яё])ран[ыа]?([^а-яё]|$)|actions/, ["github_"]],
  [/mcp|мсп|мцп|коннектор/, ["mcp_"]],
  [/vercel|версел|деплой|задеплой|хостинг/, ["vercel_"]],
  [/вконтакт|(^|[^а-яё])вк([^а-яё]|$)|vk|(^|[^а-яё])пост([^а-яё]|$)|опубликуй|сообществ|паблик/, ["vk_"]],
  [/youtube|ютуб|ютюб|видеоролик|канал/, ["youtube_"]],
  [/почт|письм|email|e-mail|gmail|mail\.ru|яндекс.почт|входящ|ящик/, ["mail_"]],
  [/самозан|мир сам|платформ/, ["selfemployed", "docs_search"]],
  [/запом|помни|забудь|память/, ["memory", "remember", "recall"]],
  [/упражн|зарядк|трениров|присед|отжим/, ["workout", "exercise"]],
];
const DEFAULT = ["memory", "knowledge", "web", "screen", "device", "code_env"];
const stems = (t) => new Set((String(t).toLowerCase().match(/[a-zа-яё0-9]{3,}/g) || []).map((w) => w.slice(0, 5)));

/** tools: [{name, description, domain}], text: последнее сообщение владельца, recent: имена недавно вызванных инструментов. */
export function pickTools(tools, text, recent = [], max = 12) {
  const q = String(text || "").toLowerCase(); const qs = stems(q); const rec = new Set(recent);
  const hinted = HINTS.filter(([re]) => re.test(q)).flatMap(([, keys]) => keys);
  const scored = tools.map((t, i) => {
    const doc = stems(`${t.name.replace(/_/g, " ")} ${t.description || ""} ${t.domain || ""}`);
    let s = 0; for (const w of qs) if (doc.has(w)) s += 1;
    if (hinted.some((k) => t.name.includes(k))) s += 4;
    if (rec.has(t.name)) s += 3;
    return { t, s, i };
  });
  let pick = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((x) => x.t.name);
  if (pick.length < 4) for (const k of DEFAULT) for (const t of tools) if (pick.length < 8 && t.name.includes(k) && !pick.includes(t.name)) pick.push(t.name);
  return pick;
}

/** Имена инструментов, вызванных в последних сообщениях разговора. */
export function recentTools(messages, n = 12) {
  const out = [];
  for (const m of messages.slice(-n)) for (const c of m.tool_calls || []) if (c.function?.name && !out.includes(c.function.name)) out.push(c.function.name);
  return out;
}

/** Короткая история для маленькой модели: прошлый обмен (если влезает) + сообщение владельца, начавшее ход, + хвост шагов.
 *  Хвост начинается с ответа ассистента, чтобы результаты инструментов не остались без вызова. Длинные результаты обрезаются. */
export function compactHistory(msgs, max = 16, toolChars = 3000) {
  const isOwner = (m) => m.role === "user" && !(Array.isArray(m.content) && m.content.some((x) => x.type === "text" && /^\[Изображение от инструмента/.test(x.text)));
  let start = -1; for (let i = msgs.length - 1; i >= 0; i--) if (isOwner(msgs[i])) { start = i; break; }
  if (start < 0) return msgs.slice(-max);
  let tail = msgs.slice(start + 1);
  if (tail.length > max - 1) {
    let j = tail.length - (max - 1);
    while (j < tail.length && tail[j].role !== "assistant") j++;
    tail = [{ role: "assistant", content: "(часть предыдущих шагов скрыта, чтобы уложиться в память модели)" }, ...tail.slice(j)];
  }
  let before = [];
  if (tail.length + 1 < max) { // прошлый вопрос-ответ для связности разговора
    const prev = msgs.slice(0, start).filter((m) => isOwner(m) || (m.role === "assistant" && !m.tool_calls?.length && m.content));
    before = prev.slice(-Math.min(4, max - tail.length - 1));
    while (before.length && before[0].role !== "user") before.shift();
  }
  const cut = (m) => m.role === "tool" && typeof m.content === "string" && m.content.length > toolChars ? { ...m, content: m.content.slice(0, toolChars) + "…(обрезано)" } : m;
  return [...before, msgs[start], ...tail].map(cut);
}
