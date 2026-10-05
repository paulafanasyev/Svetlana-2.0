// CRM, бухгалтерия самозанятого (НПД, 422-ФЗ) и память. Данные — в вашем хранилище на сервере.
const money = (n) => `${Math.round(n * 100) / 100} ₽`.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const STAGES = ["lead", "contact", "proposal", "negotiation", "won", "lost"];
// НПД: 4% с физлиц, 6% с юрлиц и ИП; лимит дохода 2,4 млн ₽ в календарный год (ст. 4, 10 422-ФЗ).
export const NPD = { rateIndividual: 0.04, rateBusiness: 0.06, yearLimit: 2_400_000 };

export function npdReport(incomes, from, to) {
  const inRange = incomes.filter((r) => !r.cancelled && r.date >= from && r.date <= to);
  const ind = inRange.filter((r) => r.payer === "individual").reduce((s, r) => s + r.amount, 0);
  const bus = inRange.filter((r) => r.payer !== "individual").reduce((s, r) => s + r.amount, 0);
  return { from, to, count: inRange.length, incomeIndividuals: ind, incomeBusiness: bus, total: ind + bus,
    taxBeforeDeduction: Math.round((ind * NPD.rateIndividual + bus * NPD.rateBusiness) * 100) / 100 };
}

export function businessTools(store) {
  const isoDate = { type: "string", maxLength: 10, minLength: 10, format: "date" };
  return [
    // ---------- CRM ----------
    { name: "crm_contact_add", domain: "crm", risk: "write", confirm: false, description: "Добавить клиента/контакт в CRM.",
      parameters: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 200 }, phone: { type: "string", maxLength: 40 }, email: { type: "string", maxLength: 200 }, company: { type: "string", maxLength: 200 }, note: { type: "string", maxLength: 2000 }, tags: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 20 } }, required: ["name"], additionalProperties: false },
      async execute(_c, a) { const r = store.insert("contacts", a); return { data: r, summary: `Контакт «${r.name}» добавлен (${r.id})` }; } },
    { name: "crm_find", domain: "crm", risk: "read", description: "Найти контакты и сделки в CRM по тексту.",
      parameters: { type: "object", properties: { query: { type: "string", maxLength: 200 } }, additionalProperties: false },
      async execute(_c, a) {
        const q = (a.query || "").toLowerCase(); const m = (o) => !q || JSON.stringify(o).toLowerCase().includes(q);
        const contacts = store.find("contacts", m).slice(0, 50); const deals = store.find("deals", m).slice(0, 50);
        return { data: { contacts, deals }, summary: `Контактов: ${contacts.length}, сделок: ${deals.length}` };
      } },
    { name: "crm_deal_add", domain: "crm", risk: "write", confirm: false, description: "Создать сделку в воронке.",
      parameters: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 }, contactId: { type: "string", maxLength: 40 }, amount: { type: "number", minimum: 0 }, stage: { type: "string", enum: STAGES }, dueDate: isoDate }, required: ["title"], additionalProperties: false },
      async execute(_c, a) {
        if (a.contactId && !store.get("contacts", a.contactId)) return { ok: false, error: "контакт не найден" };
        const r = store.insert("deals", { stage: "lead", ...a }); return { data: r, summary: `Сделка «${r.title}» создана, этап ${r.stage}` };
      } },
    { name: "crm_deal_move", domain: "crm", risk: "write", confirm: false, description: "Перевести сделку на другой этап воронки.",
      parameters: { type: "object", properties: { dealId: { type: "string", maxLength: 40 }, stage: { type: "string", enum: STAGES } }, required: ["dealId", "stage"], additionalProperties: false },
      async execute(_c, a) { const r = store.update("deals", a.dealId, { stage: a.stage }); return r ? { data: r, summary: `Сделка «${r.title}» → ${a.stage}` } : { ok: false, error: "сделка не найдена" }; } },
    { name: "crm_task_add", domain: "crm", risk: "write", confirm: false, description: "Создать задачу/напоминание (звонок, встреча, дедлайн).",
      parameters: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 300 }, due: { type: "string", maxLength: 25 }, dealId: { type: "string", maxLength: 40 }, contactId: { type: "string", maxLength: 40 } }, required: ["title"], additionalProperties: false },
      async execute(_c, a) {
        if (a.contactId && !store.get("contacts", a.contactId)) return { ok: false, error: "контакт не найден" };
        if (a.dealId && !store.get("deals", a.dealId)) return { ok: false, error: "сделка не найдена" };
        const r = store.insert("tasks", { done: false, ...a }); return { data: r, summary: `Задача «${r.title}»${r.due ? " на " + r.due : ""} создана` }; } },
    { name: "crm_overview", domain: "crm", risk: "read", description: "Сводка CRM: воронка по этапам, сумма в работе, открытые задачи.",
      async execute() {
        const deals = store.all("deals"); const by = Object.fromEntries(STAGES.map((s) => [s, deals.filter((d) => d.stage === s).length]));
        const pipeline = deals.filter((d) => !["won", "lost"].includes(d.stage)).reduce((s, d) => s + (d.amount || 0), 0);
        const open = store.find("tasks", (t) => !t.done);
        return { data: { byStage: by, pipelineRub: pipeline, openTasks: open.slice(0, 50) }, summary: `В работе ${money(pipeline)}, открытых задач: ${open.length}` };
      } },
    // ---------- бухгалтерия НПД ----------
    { name: "acc_income_add", domain: "accounting", risk: "write", description: "Записать доход самозанятого (для учёта и расчёта НПД). Чек в «Мой налог» нужно пробить отдельно.",
      parameters: { type: "object", properties: { amount: { type: "number", minimum: 0.01, maximum: 100000000 }, date: isoDate, payer: { type: "string", enum: ["individual", "business"] }, payerName: { type: "string", maxLength: 200 }, payerInn: { type: "string", maxLength: 12 }, service: { type: "string", minLength: 1, maxLength: 300 }, receiptNumber: { type: "string", maxLength: 60 } }, required: ["amount", "date", "payer", "service"], additionalProperties: false },
      async execute(_c, a) {
        const r = store.insert("incomes", a);
        const year = a.date.slice(0, 4); const ytd = npdReport(store.all("incomes"), `${year}-01-01`, `${year}-12-31`).total;
        const warn = ytd > NPD.yearLimit ? ` ⚠ Превышен годовой лимит НПД ${money(NPD.yearLimit)}: ${money(ytd)}` : ytd > NPD.yearLimit * 0.9 ? ` ⚠ До лимита НПД осталось ${money(NPD.yearLimit - ytd)}` : "";
        return { data: { ...r, yearTotal: ytd, receiptPending: !a.receiptNumber }, summary: `Доход ${money(a.amount)} записан${a.receiptNumber ? "" : "; чек в «Мой налог» ещё не пробит"}.${warn}` };
      } },
    { name: "acc_income_cancel", domain: "accounting", risk: "write", description: "Аннулировать ошибочную запись дохода (чек в «Мой налог» аннулируйте там же).",
      parameters: { type: "object", properties: { incomeId: { type: "string", maxLength: 40 }, reason: { type: "string", maxLength: 300 } }, required: ["incomeId", "reason"], additionalProperties: false },
      async execute(_c, a) { const r = store.update("incomes", a.incomeId, { cancelled: true, cancelReason: a.reason }); return r ? { data: r, summary: "Запись аннулирована" } : { ok: false, error: "запись не найдена" }; } },
    { name: "acc_expense_add", domain: "accounting", risk: "write", confirm: false, description: "Записать расход (для управленческого учёта; на НПД расходы налог не уменьшают).",
      parameters: { type: "object", properties: { amount: { type: "number", minimum: 0.01 }, date: isoDate, category: { type: "string", maxLength: 100 }, note: { type: "string", maxLength: 500 } }, required: ["amount", "date"], additionalProperties: false },
      async execute(_c, a) { const r = store.insert("expenses", a); return { data: r, summary: `Расход ${money(a.amount)} записан` }; } },
    { name: "acc_report", domain: "accounting", risk: "read", description: "Отчёт за период: доходы (физлица/юрлица), НПД до вычета, расходы, прибыль, остаток лимита 2,4 млн ₽.",
      parameters: { type: "object", properties: { from: isoDate, to: isoDate }, required: ["from", "to"], additionalProperties: false },
      async execute(_c, a) {
        const rep = npdReport(store.all("incomes"), a.from, a.to);
        const exp = store.find("expenses", (e) => e.date >= a.from && e.date <= a.to).reduce((s, e) => s + e.amount, 0);
        const year = a.to.slice(0, 4); const ytd = npdReport(store.all("incomes"), `${year}-01-01`, `${year}-12-31`).total;
        const noReceipt = store.find("incomes", (r) => !r.cancelled && !r.receiptNumber && r.date >= a.from && r.date <= a.to).length;
        return { data: { ...rep, expenses: exp, profit: rep.total - exp, yearIncome: ytd, limitLeft: Math.max(0, NPD.yearLimit - ytd), withoutReceipt: noReceipt,
          note: "Налог до вычета. Налоговый вычет 10 000 ₽ (ставки 3%/4% вместо 4%/6%) применяется ФНС автоматически — точную сумму к уплате смотрите в «Мой налог»." },
          summary: `Доход ${money(rep.total)}, НПД до вычета ${money(rep.taxBeforeDeduction)}, расходы ${money(exp)}${noReceipt ? `, без чека: ${noReceipt}` : ""}` };
      } },
    // ---------- память ----------
    { name: "memory_save", domain: "memory", risk: "write", confirm: false, description: "Запомнить факт о пользователе или проекте надолго.",
      parameters: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: 100 }, value: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["key", "value"], additionalProperties: false },
      async execute(_c, a) { const ex = store.find("memory", (m) => m.key === a.key)[0]; const r = ex ? store.update("memory", ex.id, { value: a.value }) : store.insert("memory", a); return { data: r, summary: `Запомнила: ${a.key}` }; } },
    { name: "memory_recall", domain: "memory", risk: "read", description: "Вспомнить сохранённые факты (поиск по тексту).",
      parameters: { type: "object", properties: { query: { type: "string", maxLength: 200 } }, additionalProperties: false },
      async execute(_c, a) { const q = (a.query || "").toLowerCase(); const r = store.find("memory", (m) => !q || (m.key + " " + m.value).toLowerCase().includes(q)).slice(0, 50); return { data: r, summary: `Нашла: ${r.length}` }; } },
  ];
}
