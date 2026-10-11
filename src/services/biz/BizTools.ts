// Svetlana Business — AI tools, offline chat commands and prompt context.
import type { Tool, ToolResult } from '../ToolRegistry';
import { toolRegistry } from '../ToolRegistry';
import { crmStore, type CRMContact } from '../crm/CRMStore';
import { bizStore, BizStore, REGIME_LABELS, formatRub, type PayerType, type TaxRegime, type DocType } from './BizStore';
import { findSupport, regionalSearchUrl, SUPPORT_KIND_LABELS, type SupportKind } from './SupportCatalog';
import { checkCounterparty, reportText } from './Counterparty';
import { computeAnalytics, analyticsText } from './Analytics';
import { bookingStore } from './Booking';
import { createBookingTools, detectBookingIntent, describeBookingResult, bookingPrompt } from './BookingTools';

const REGIMES: TaxRegime[] = ['npd', 'usn6', 'usn15', 'patent', 'ooo', 'none'];
const DOC_TYPES: DocType[] = ['invoice', 'act', 'contract'];

function ok(data: unknown): ToolResult { return { success: true, data }; }
function fail(error: string): ToolResult { return { success: false, error }; }

const COMPANY_RE = /^(ооо|ао|пао|зао|оао|ип|нко|ано)(?=\s|$|«|")|«|"/i;

export function guessPayerType(name: string | undefined): PayerType {
  return name && COMPANY_RE.test(name.trim()) ? 'company' : 'person';
}

/** Finds a CRM contact by a name in any Russian case form: «Петрова», «Иванову», «Анной». */
export function findContactFuzzy(name: string | undefined): CRMContact | undefined {
  if (!name || !name.trim()) return undefined;
  const exact = crmStore.findContactByName(name);
  if (exact) return exact;
  const words = name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const stems = words.map(w => w.replace(/(ому|ему|ой|ей|ым|им|ою|ую|ов|ев|ва|ве|ву|на|ну|не|ии|ия|ию|а|у|е|ы|и|ю|я)$/u, '')).filter(s => s.length >= 3);
  if (!stems.length) return undefined;
  return crmStore.listContacts().find(c => {
    const n = c.name.toLowerCase();
    return stems.every(s => n.includes(s));
  });
}

function parseAmount(raw: string, mult?: string): number {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  const m = mult ? (/^(тыс|т|к)/i.test(mult) ? 1000 : /^(млн|м)/i.test(mult) ? 1_000_000 : 1) : 1;
  return n * m;
}

function parseDate(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const t = Date.parse(value.trim());
  if (Number.isNaN(t)) throw new Error(`Не понимаю дату «${value}». Используйте формат ГГГГ-ММ-ДД`);
  return t;
}

function clientFrom(p: Record<string, any>): { name: string; contactId?: string } {
  const contact = findContactFuzzy(p.client) ?? (p.contactId ? crmStore.getContact(p.contactId) : undefined);
  const name = String(p.client ?? contact?.name ?? '').trim();
  return { name: contact?.name ?? name, contactId: contact?.id };
}

export function createBizTools(store: BizStore = bizStore): Tool[] {
  const always = async () => true;
  return [
    {
      id: 'biz_set_profile', name: 'Business: set profile', category: 'data', riskLevel: 'low',
      description: 'Set business profile: tax regime (npd, usn6, usn15, patent, ooo), region, name, INN, birth year, sectors, flags.',
      inputSchema: { type: 'object', properties: {
        regime: { type: 'string', description: 'Tax regime', enum: REGIMES },
        region: { type: 'string', description: 'Russian region' },
        fullName: { type: 'string', description: 'Full name or company name' },
        inn: { type: 'string', description: 'INN (10 or 12 digits)' },
        birthYear: { type: 'number', description: 'Birth year' },
        sectors: { type: 'string', description: 'Comma-separated: services, trade, production, tech, agro, export, social, education, creative, tourism' },
        flags: { type: 'string', description: 'Comma-separated: lowIncome, unemployed, newBusiness, socialEnterprise, veteran, disability' },
      } },
      async execute(p) {
        try {
          const patch: Record<string, any> = {};
          for (const k of ['regime', 'region', 'fullName', 'inn', 'birthYear']) if (p[k] !== undefined) patch[k] = p[k];
          if (p.sectors !== undefined) patch.sectors = String(p.sectors).split(',').map(s => s.trim()).filter(Boolean);
          if (p.flags !== undefined) patch.flags = String(p.flags).split(',').map(s => s.trim()).filter(Boolean);
          const prof = store.updateProfile(patch);
          return ok({ regime: REGIME_LABELS[prof.regime], region: prof.region });
        } catch (e: any) { return fail(e?.message || 'Не удалось сохранить профиль'); }
      },
      isAvailable: always,
    },
    {
      id: 'biz_add_income', name: 'Business: record income', category: 'data', riskLevel: 'low',
      description: 'Record received money. payerType person or company (affects НПД rate 4%/6%). Client is matched to CRM contacts.',
      inputSchema: { type: 'object', properties: {
        amount: { type: 'number', description: 'Amount in RUB' },
        description: { type: 'string', description: 'What was paid for' },
        client: { type: 'string', description: 'Payer name' },
        payerType: { type: 'string', description: 'person or company', enum: ['person', 'company'] },
        date: { type: 'string', description: 'YYYY-MM-DD, default today' },
      }, required: ['amount'] },
      async execute(p) {
        try {
          const c = clientFrom(p);
          const e = store.addEntry({
            kind: 'income', amount: Number(p.amount), description: p.description ?? '', date: parseDate(p.date),
            payerType: p.payerType ?? guessPayerType(c.name), contactId: c.contactId, counterparty: c.name || undefined,
          });
          if (c.contactId) crmStore.addActivity({ type: 'note', text: `Оплата ${formatRub(e.amount)}${e.description ? `: ${e.description}` : ''}`, contactId: c.contactId });
          return ok({ id: e.id, amount: e.amount, client: c.name, payerType: e.payerType, receipt: e.receipt, linked: !!c.contactId });
        } catch (err: any) { return fail(err?.message || 'Не удалось записать доход'); }
      },
      isAvailable: always,
    },
    {
      id: 'biz_add_expense', name: 'Business: record expense', category: 'data', riskLevel: 'low',
      description: 'Record a business expense (needed for УСН 15%).',
      inputSchema: { type: 'object', properties: {
        amount: { type: 'number', description: 'Amount in RUB' },
        description: { type: 'string', description: 'What for' },
        category: { type: 'string', description: 'Category' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
      }, required: ['amount'] },
      async execute(p) {
        try {
          const e = store.addEntry({ kind: 'expense', amount: Number(p.amount), description: p.description ?? '', category: p.category, date: parseDate(p.date) });
          return ok({ id: e.id, amount: e.amount, description: e.description });
        } catch (err: any) { return fail(err?.message || 'Не удалось записать расход'); }
      },
      isAvailable: always,
    },
    {
      id: 'biz_create_document', name: 'Business: create invoice/act/contract', category: 'data', riskLevel: 'low',
      description: 'Create an invoice (invoice), act (act) or service contract (contract) for a client with one service line.',
      inputSchema: { type: 'object', properties: {
        type: { type: 'string', description: 'invoice, act or contract', enum: DOC_TYPES },
        client: { type: 'string', description: 'Client name (matched to CRM)' },
        service: { type: 'string', description: 'Service description' },
        amount: { type: 'number', description: 'Price in RUB' },
        qty: { type: 'number', description: 'Quantity, default 1' },
        dueDays: { type: 'number', description: 'Days to pay, default 5' },
      }, required: ['client', 'service', 'amount'] },
      async execute(p) {
        try {
          const c = clientFrom(p);
          const contact = c.contactId ? crmStore.getContact(c.contactId) : undefined;
          const details = contact ? [contact.company, contact.phones[0], contact.emails[0]].filter(Boolean).join(', ') : '';
          const doc = store.createDocument({
            type: p.type ?? 'invoice', clientName: c.name, contactId: c.contactId, clientDetails: details,
            items: [{ name: p.service, qty: p.qty ?? 1, price: Number(p.amount) }], dueDays: p.dueDays,
          });
          return ok({ id: doc.id, type: doc.type, number: doc.number, client: doc.clientName, total: doc.total });
        } catch (err: any) { return fail(err?.message || 'Не удалось создать документ'); }
      },
      isAvailable: always,
    },
    {
      id: 'biz_mark_paid', name: 'Business: mark invoice paid', category: 'data', riskLevel: 'low',
      description: 'Mark an invoice as paid (by number or client name) and record the income.',
      inputSchema: { type: 'object', properties: {
        invoice: { type: 'string', description: 'Invoice number or client name' },
      }, required: ['invoice'] },
      async execute(p) {
        const ref = String(p.invoice).trim().toLowerCase().replace(/^№\s*/, '');
        const open = store.receivables().map(r => r.document);
        const doc = open.find(d => d.number === ref || d.id === p.invoice)
          ?? open.find(d => d.clientName.toLowerCase().includes(ref))
          ?? (() => { const c = findContactFuzzy(p.invoice); return c ? open.find(d => d.contactId === c.id) : undefined; })();
        if (!doc) return fail(`Неоплаченный счёт не найден: ${p.invoice}`);
        const r = store.markPaid(doc.id);
        return ok({ number: r.document.number, client: r.document.clientName, total: r.document.total });
      },
      isAvailable: always,
    },
    {
      id: 'biz_receivables', name: 'Business: who owes me', category: 'data', riskLevel: 'low',
      description: 'List unpaid invoices with days overdue and ready-to-send reminder texts.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const list = store.receivables();
        return ok({
          total: list.reduce((s, r) => s + r.document.total, 0),
          items: list.map(r => ({ number: r.document.number, client: r.document.clientName, total: r.document.total, daysOverdue: r.daysOverdue, reminder: store.reminderText(r.document.id) })),
        });
      },
      isAvailable: always,
    },
    {
      id: 'biz_tax_summary', name: 'Business: tax summary', category: 'data', riskLevel: 'low',
      description: 'Tax estimate for the current year by regime (НПД or УСН) and upcoming deadlines.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const prof = store.getProfile();
        const deadlines = store.deadlines(60).slice(0, 3).map(d => ({ date: new Date(d.date).toLocaleDateString('ru-RU'), title: d.title }));
        if (prof.regime === 'npd') return ok({ regime: 'npd', ...store.npdSummary(), deadlines });
        if (prof.regime === 'usn6' || prof.regime === 'usn15') return ok({ ...store.usnSummary(), deadlines });
        return ok({ regime: prof.regime, deadlines, note: 'Выберите налоговый режим в профиле, чтобы я считала налог.' });
      },
      isAvailable: always,
    },
    {
      id: 'biz_find_support', name: 'Business: find state support', category: 'data', riskLevel: 'low',
      description: 'Find grants, subsidies, loans and other state support for the user profile and region.',
      inputSchema: { type: 'object', properties: {
        kind: { type: 'string', description: 'grant, subsidy, loan, guarantee, consulting, property, tax, education' },
        query: { type: 'string', description: 'Keyword filter' },
      } },
      async execute(p) {
        const prof = store.getProfile();
        const matches = findSupport(prof, store.now(), { kind: p.kind as SupportKind | undefined, query: p.query });
        return ok({
          region: prof.region, regime: prof.regime,
          measures: matches.map(m => ({ title: m.measure.title, kind: SUPPORT_KIND_LABELS[m.measure.kind], amount: m.measure.amount, url: m.measure.url, reasons: m.reasons })),
          regionalSearch: regionalSearchUrl(prof, store.now()),
        });
      },
      isAvailable: always,
    },
    {
      id: 'biz_check_inn', name: 'Business: check counterparty by INN', category: 'data', riskLevel: 'low',
      description: 'Check a company/ИП/self-employed by INN: checksum, name, address, status (active/liquidated/bankrupt), registration date, НПД status, risks.',
      inputSchema: { type: 'object', properties: { inn: { type: 'string', description: 'INN, 10 or 12 digits' } }, required: ['inn'] },
      async execute(p) {
        try {
          const r = await checkCounterparty(String(p.inn), { now: store.now() });
          return ok({ ...r, text: reportText(r) });
        } catch (err: any) { return fail(err?.message || 'Проверка не удалась'); }
      },
      isAvailable: always,
    },
    {
      id: 'biz_analytics', name: 'Business: financial analytics', category: 'data', riskLevel: 'low',
      description: 'Financial summary: income/expenses/profit by month, change vs previous month, top clients and expenses, idle clients, year-end forecast of income and tax, tips.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const a = computeAnalytics(store);
        return ok({ ytd: a.ytd, last12: a.last12, lastMonth: a.lastFull, changeVsPrev: a.changeVsPrev, topClients: a.topClients, topExpenses: a.topExpenses, forecast: a.forecast, insights: a.insights, text: analyticsText(a) });
      },
      isAvailable: always,
    },
  ];
}

export function registerBizTools(store: BizStore = bizStore): void {
  [...createBizTools(store), ...createBookingTools(bookingStore, findContactFuzzy, store)].forEach(t => toolRegistry.registerTool(t));
}
registerBizTools();

// ---------------- chat integration ----------------

export interface BizAction { tool: string; args: Record<string, any> }

const AMOUNT = String.raw`(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(тыс\.?|т\.?|к|млн)?\s*(?:₽|руб(?:лей|ля|ль)?\.?|р\.?)?`;
const NAME = String.raw`([А-ЯЁA-Z«"][^,.!?\n]*?)`;

/** Offline commands: «получил 5000 от Петрова за урок», «выстави счёт Иванову на 15000 за дизайн», «кто мне должен», «сколько налог», «субсидии». */
export function detectBizIntent(text: string): BizAction | null {
  const t = text.trim();
  const low = t.toLowerCase().replace(/ё/g, 'е');

  const income = t.match(new RegExp(String.raw`^(?:я\s+)?(?:получил[аи]?|пришл[оа]|поступил[оа]?|(?:перевел[аи]?|оплатил[аи]?|заплатил[аи]?)\s+мне)\s+${AMOUNT}(?:\s+от\s+${NAME})?(?:\s+за\s+(.+?))?\s*[.!]?$`, 'i'));
  if (income) {
    const amount = parseAmount(income[1], income[2]);
    if (amount > 0) return { tool: 'biz_add_income', args: { amount, client: income[3]?.trim(), description: income[4]?.trim() ?? '' } };
  }
  const spent = t.match(new RegExp(String.raw`^(?:потратил[аи]?|расход|купил[аи]?|оплатил[аи]? расход)\s+${AMOUNT}(?:\s+(?:на|за)\s+(.+?))?\s*[.!]?$`, 'i'));
  if (spent) {
    const amount = parseAmount(spent[1], spent[2]);
    if (amount > 0) return { tool: 'biz_add_expense', args: { amount, description: spent[3]?.trim() ?? '' } };
  }
  const doc = t.match(new RegExp(String.raw`(?:выстави|сделай|создай|подготовь|оформи)\s+(счет|счёт|акт|договор)\s+(?:для\s+)?${NAME}\s+на\s+${AMOUNT}(?:\s+за\s+(.+?))?\s*[.!]?$`, 'i'));
  if (doc) {
    const type = /акт/i.test(doc[1]) ? 'act' : /договор/i.test(doc[1]) ? 'contract' : 'invoice';
    const amount = parseAmount(doc[3], doc[4]);
    if (amount > 0) return { tool: 'biz_create_document', args: { type, client: doc[2].trim(), amount, service: doc[5]?.trim() || 'Услуги' } };
  }
  const booking = detectBookingIntent(t);
  if (booking) return booking;
  const inn = low.match(/(?:^|\D)(\d{12}|\d{10})(?!\d)/)?.[1];
  if (inn && /(инн|контрагент|провер|компани|организаци)/.test(low)) return { tool: 'biz_check_inn', args: { inn } };
  if (/(кто|сколько)\s+(мне\s+)?долж|должник|дебитор|неоплаченн/.test(low)) return { tool: 'biz_receivables', args: {} };
  if (/(налог|нпд|усн)/.test(low) && /(сколько|какой|посчитай|сводк|когда|платить)/.test(low)) return { tool: 'biz_tax_summary', args: {} };
  if (/(аналитик|финансов\S* (сводк|отчет)|сводк\S* по деньгам|отчет по деньгам|как (идут )?дела с деньгами|прибыл|сколько (я )?заработал|прогноз (дохода|на год))/.test(low)) return { tool: 'biz_analytics', args: {} };
  if (/(субсид|грант|господдерж|меры поддержк|поддержк[ауи] (бизнес|самозанят|ип))/.test(low)) return { tool: 'biz_find_support', args: {} };
  return null;
}

export function describeBizResult(tool: string, result: ToolResult): string {
  const booking = describeBookingResult(tool, result);
  if (booking !== null) return booking;
  if (!result.success) return `⚠️ ${result.error || 'Не получилось'}`;
  const d = result.data ?? {};
  switch (tool) {
    case 'biz_set_profile': return `✅ Профиль: ${d.regime}${d.region ? `, ${d.region}` : ''}.`;
    case 'biz_add_income':
      return `✅ Доход ${formatRub(d.amount)}${d.client ? ` от ${d.client}` : ''} записан${d.linked ? ' и добавлен в историю клиента' : ''}.`
        + (d.receipt === 'pending' ? `\n🧾 Не забудьте чек в «Мой налог» (${d.payerType === 'company' ? 'юрлицо/ИП, 6%' : 'физлицо, 4%'}).` : '');
    case 'biz_add_expense': return `✅ Расход ${formatRub(d.amount)}${d.description ? ` (${d.description})` : ''} записан.`;
    case 'biz_create_document': {
      const label = d.type === 'act' ? 'Акт' : d.type === 'contract' ? 'Договор' : 'Счёт';
      return `✅ ${label} № ${d.number} для «${d.client}» на ${formatRub(d.total)} готов. Распечатать или сохранить в PDF: кнопка «Бизнес» → Документы.`;
    }
    case 'biz_check_inn': return `🔍 ${d.text}`;
    case 'biz_analytics': return d.text;
    case 'biz_mark_paid': return `✅ Счёт № ${d.number} (${d.client}) оплачен, доход ${formatRub(d.total)} записан.`;
    case 'biz_receivables':
      return d.items?.length
        ? `💸 Должны ${formatRub(d.total)}:\n${d.items.map((i: any) => `• ${i.client}: ${formatRub(i.total)}, счёт № ${i.number}${i.daysOverdue ? `, просрочка ${i.daysOverdue} дн.` : ''}`).join('\n')}`
        : '👍 Неоплаченных счетов нет.';
    case 'biz_tax_summary': {
      const dl = d.deadlines?.length ? `\nБлижайшие сроки: ${d.deadlines.map((x: any) => `${x.date} ${x.title}`).join('; ')}.` : '';
      if (d.regime === 'npd') {
        const cur = d.months?.[d.months.length - 1];
        const monthName = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };
        return `🧮 НПД ${d.year}: доход ${formatRub(d.income)}, налог за год ${formatRub(d.taxYear)}.`
          + (cur ? ` За ${monthName(cur.month)}: ${formatRub(cur.tax)}${cur.payable ? `, к оплате ${formatRub(cur.payable)} до ${new Date(cur.dueDate).toLocaleDateString('ru-RU')}` : ' (меньше 100 ₽ — перенесётся)'}.` : '')
          + ` До лимита 2,4 млн осталось ${formatRub(d.limitLeft)}, вычет ${formatRub(d.deductionLeft)}.`
          + (d.receiptsMissing ? ` Чеков не выбито: ${d.receiptsMissing}.` : '') + dl;
      }
      if (d.regime === 'usn6' || d.regime === 'usn15') {
        return `🧮 УСН ${d.regime === 'usn6' ? '6%' : '15%'} ${d.year}: доход ${formatRub(d.income)}${d.regime === 'usn15' ? `, расходы ${formatRub(d.expenses)}` : ''}, налог (оценка) ${formatRub(d.taxAfterContributions)}. Взносы: фикс. ${formatRub(d.contributionsFixed)} + 1% ${formatRub(d.contributionsExtra)}.${dl}`;
      }
      return `ℹ️ ${d.note}${dl}`;
    }
    case 'biz_find_support':
      return `🏛 Меры поддержки${d.region ? ` (${d.region})` : ''}:\n${d.measures.slice(0, 8).map((m: any) => `• ${m.title}${m.amount ? ` — ${m.amount}` : ''}${m.reasons?.length ? ` [${m.reasons.join('; ')}]` : ''}\n  ${m.url}`).join('\n')}`
        + `\nРегиональные программы: ${d.regionalSearch}\nУсловия меняются — сверяйте на официальном сайте.`
        + (d.regime === 'none' ? '\nУкажите налоговый режим и регион в профиле, подбор станет точнее.' : '');
    default: return '✅ Готово.';
  }
}

export function bizSystemPrompt(store: BizStore = bizStore): string {
  return `

БИЗНЕС. Ты помогаешь самозанятому/предпринимателю в России. Текущее состояние:
${store.summaryForAI()}
Действия (тем же форматом [CRM: {"tool": "...", "args": {...}}]):
- biz_set_profile {"regime": "npd|usn6|usn15|patent|ooo", "region": "...", "birthYear": 1990, "sectors": "tech,services", "flags": "lowIncome,unemployed"}
- biz_add_income {"amount": 5000, "client": "имя", "description": "за что", "payerType": "person|company"}
- biz_add_expense {"amount": 1000, "description": "..."}
- biz_create_document {"type": "invoice|act|contract", "client": "имя", "service": "...", "amount": 15000}
- biz_mark_paid {"invoice": "номер или клиент"}
- biz_receivables {}
- biz_tax_summary {}
- biz_find_support {"kind": "grant|subsidy|loan|...", "query": "..."}
- biz_check_inn {"inn": "10 или 12 цифр"} — проверить контрагента перед сделкой
- biz_analytics {} — финансовая сводка, топ клиентов, прогноз на год и советы
Правила: налоги считай только через biz_tax_summary; про субсидии называй только программы из biz_find_support и давай ссылки на официальные сайты; не выдумывай суммы, сроки и законы. Чек НПД выбивается в приложении «Мой налог» — напоминай об этом.${bookingPrompt()}`;
}
