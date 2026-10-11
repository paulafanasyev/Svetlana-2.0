// Svetlana Business: money, НПД/УСН, documents, receivables, state support, chat commands
import { describe, it, expect, beforeEach } from 'vitest';
import { BizStore, NPD_LIMIT } from '../services/biz/BizStore';
import { rublesInWords, paymentString, renderDocumentHTML, plural } from '../services/biz/DocTemplates';
import { findSupport, regionalSearchUrl } from '../services/biz/SupportCatalog';
import { createBizTools, detectBizIntent, describeBizResult, findContactFuzzy, guessPayerType } from '../services/biz/BizTools';
import { detectCRMIntent, parseCRMActions, crmSystemPrompt } from '../services/crm/CRMTools';
import { crmStore, type KeyValueStorage } from '../services/crm/CRMStore';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

const OCT_11 = new Date(2026, 9, 11, 12).getTime();
let now = OCT_11;
let storage: KeyValueStorage;
let store: BizStore;

beforeEach(() => {
  now = OCT_11;
  storage = memory();
  store = new BizStore(storage, () => now);
});

describe('НПД', () => {
  it('applies 4%/6% rates and the 10 000 ₽ deduction (1%/2%)', () => {
    store.updateProfile({ regime: 'npd' });
    store.addEntry({ kind: 'income', amount: 1000, description: 'урок', payerType: 'person', date: new Date(2026, 7, 3).getTime() });
    store.addEntry({ kind: 'income', amount: 100_000, description: 'сайт', payerType: 'company', date: new Date(2026, 8, 15).getTime() });
    const s = store.npdSummary(2026);
    const aug = s.months.find(m => m.month === '2026-08')!;
    const sep = s.months.find(m => m.month === '2026-09')!;
    expect(aug.tax).toBe(30);          // 4% − 1%
    expect(aug.payable).toBe(0);       // < 100 ₽ carried forward
    expect(sep.tax).toBe(4000);        // 6% − 2%
    expect(sep.carriedIn).toBe(30);
    expect(sep.payable).toBe(4030);
    expect(new Date(sep.dueDate).getDate()).toBe(28);
    expect(new Date(sep.dueDate).getMonth()).toBe(9);
    expect(s.deductionLeft).toBe(10_000 - 10 - 2000);
    expect(s.receiptsMissing).toBe(2);
  });

  it('stops the deduction when it is used up and flags the 2.4M limit', () => {
    store.updateProfile({ regime: 'npd' });
    store.addEntry({ kind: 'income', amount: 600_000, description: 'a', payerType: 'company', date: new Date(2026, 0, 10).getTime() });
    store.addEntry({ kind: 'income', amount: 1_900_000, description: 'b', payerType: 'company', date: new Date(2026, 1, 10).getTime() });
    const s = store.npdSummary(2026);
    expect(s.months[0].deductionUsed).toBe(10_000);       // 2% of 600k = 12k, capped at 10k
    expect(s.months[1].tax).toBe(114_000);
    expect(s.limitExceeded).toBe(true);
    expect(s.income).toBeGreaterThan(NPD_LIMIT);
  });

  it('records receipt numbers', () => {
    store.updateProfile({ regime: 'npd' });
    const e = store.addEntry({ kind: 'income', amount: 500, description: 'x' });
    expect(e.receipt).toBe('pending');
    expect(store.setReceipt(e.id, '20abc').receipt).toBe('issued');
    expect(store.npdSummary().receiptsMissing).toBe(0);
  });
});

describe('УСН', () => {
  it('reduces УСН 6% by contributions for an ИП without employees', () => {
    store.updateProfile({ regime: 'usn6', fixedContributions: 50_000 });
    store.addEntry({ kind: 'income', amount: 1_000_000, description: 'x', date: new Date(2026, 1, 1).getTime() });
    const u = store.usnSummary(2026);
    expect(u.taxGross).toBe(60_000);
    expect(u.contributionsExtra).toBe(7_000);
    // 1% за 2026 год платится до 1 июля 2027 и уменьшает налог 2027 года
    expect(u.taxAfterContributions).toBe(10_000);
  });

  it('applies the 1% minimum tax on УСН 15%', () => {
    store.updateProfile({ regime: 'usn15' });
    store.addEntry({ kind: 'income', amount: 500_000, description: 'x', date: new Date(2026, 1, 1).getTime() });
    store.addEntry({ kind: 'expense', amount: 490_000, description: 'y', date: new Date(2026, 1, 2).getTime() });
    const u = store.usnSummary(2026);
    expect(u.taxGross).toBe(0); // взносы за себя тоже в расходах
    expect(u.minTax).toBe(5_000);
    expect(u.taxAfterContributions).toBe(5_000);
  });

  it('lists upcoming deadlines for the regime', () => {
    store.updateProfile({ regime: 'usn6' });
    const titles = store.deadlines(90).map(d => d.title);
    expect(titles).toContain('Аванс УСН за 9 месяцев');
    store.updateProfile({ regime: 'npd' });
    expect(store.deadlines(40)[0].title).toBe('Налог НПД');
  });
});

describe('documents and receivables', () => {
  it('numbers invoices, tracks overdue and records income once when paid', () => {
    const a = store.createDocument({ type: 'invoice', clientName: 'ООО «Ромашка»', items: [{ name: 'Дизайн', qty: 2, price: 7500 }] });
    const b = store.createDocument({ type: 'invoice', clientName: 'Иван', items: [{ name: 'Урок', qty: 1, price: 1000 }] });
    expect([a.number, b.number]).toEqual(['1', '2']);
    expect(a.total).toBe(15_000);
    now += 10 * 86_400_000;
    const rec = store.receivables();
    expect(rec).toHaveLength(2);
    expect(rec[0].daysOverdue).toBe(5);
    expect(store.reminderText(a.id)).toContain('№ 1');
    const paid = store.markPaid(a.id);
    expect(paid.entry.payerType).toBe('company');
    store.markPaid(a.id);
    expect(store.listEntries({ kind: 'income' })).toHaveLength(1);
    expect(store.receivables()).toHaveLength(1);
  });

  it('validates documents and profile details', () => {
    expect(() => store.createDocument({ type: 'act', clientName: '', items: [{ name: 'x', qty: 1, price: 1 }] })).toThrow();
    expect(() => store.createDocument({ type: 'act', clientName: 'A', items: [] })).toThrow();
    expect(() => store.updateProfile({ inn: '123' })).toThrow();
    expect(() => store.updateProfile({ account: '42' })).toThrow();
  });

  it('renders printable HTML with amount in words and escapes input', () => {
    store.updateProfile({ regime: 'npd', fullName: 'Иванов <b>Иван</b>', inn: '123456789012' });
    const d = store.createDocument({ type: 'contract', clientName: 'Клиент', items: [{ name: 'Услуга', qty: 1, price: 2001 }] });
    const html = renderDocumentHTML(d, store.getProfile());
    expect(html).toContain('Две тысячи один рубль 00 копеек');
    expect(html).toContain('Налог на профессиональный доход');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>Иван</b>');
  });

  it('builds a ГОСТ Р 56042 payment string', () => {
    store.updateProfile({ fullName: 'ИП Петров|X', account: '40802810000000000001', bik: '044525225', bankName: 'Банк', corrAccount: '30101810400000000225' });
    const s = paymentString(store.getProfile(), 1500.5, 'Оплата');
    expect(s.startsWith('ST00012|Name=ИП Петров X|')).toBe(true);
    expect(s).toContain('Sum=150050');
  });

  it('exports a ledger CSV safe for spreadsheets', () => {
    store.addEntry({ kind: 'income', amount: 100, description: '=cmd()' });
    expect(store.exportLedgerCSV(2026)).toContain("'=cmd()");
  });
});

describe('rubles in words', () => {
  it('handles Russian plural forms', () => {
    expect(rublesInWords(1)).toBe('Один рубль 00 копеек');
    expect(rublesInWords(22.03)).toBe('Двадцать два рубля 03 копейки');
    expect(rublesInWords(1_234_567.89)).toBe('Один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь рублей 89 копеек');
    expect(rublesInWords(11)).toBe('Одиннадцать рублей 00 копеек');
    expect(plural(21, 'a', 'b', 'c')).toBe('a');
  });
});

describe('state support', () => {
  it('matches measures by regime, age and flags', () => {
    store.updateProfile({ regime: 'npd', region: 'Республика Татарстан', birthYear: 2003, flags: ['lowIncome'] });
    const ids = findSupport(store.getProfile(), now).map(m => m.measure.id);
    expect(ids).toContain('social-contract');
    expect(ids).toContain('rosmol');
    expect(ids).toContain('moy-biznes');
    expect(ids).not.toContain('youth-grant');   // ИП/ООО only
    store.updateProfile({ regime: 'usn6' });
    expect(findSupport(store.getProfile(), now).map(m => m.measure.id)).toContain('youth-grant');
  });

  it('builds a regional search link', () => {
    store.updateProfile({ regime: 'npd', region: 'Республика Татарстан' });
    expect(decodeURIComponent(regionalSearchUrl(store.getProfile(), now))).toContain('самозанятых Республика Татарстан 2026');
  });
});

describe('business chat commands', () => {
  it('parses money, documents and questions', () => {
    expect(detectBizIntent('Получил 5000 от Петрова за урок')).toEqual({ tool: 'biz_add_income', args: { amount: 5000, client: 'Петрова', description: 'урок' } });
    expect(detectBizIntent('пришло 15 тыс от ООО «Ромашка» за дизайн')?.args.amount).toBe(15_000);
    expect(detectBizIntent('выстави счёт Иванову на 15000 за дизайн')).toMatchObject({ tool: 'biz_create_document', args: { type: 'invoice', client: 'Иванову', amount: 15_000 } });
    expect(detectBizIntent('потратил 2500 на рекламу')?.tool).toBe('biz_add_expense');
    expect(detectBizIntent('кто мне должен?')?.tool).toBe('biz_receivables');
    expect(detectBizIntent('сколько налог платить?')?.tool).toBe('biz_tax_summary');
    expect(detectBizIntent('какие есть субсидии')?.tool).toBe('biz_find_support');
    expect(detectBizIntent('оплатил 500 за интернет')).toBeNull();
    expect(detectCRMIntent('кто мне должен?')?.tool).toBe('biz_receivables');
  });

  it('matches CRM contacts in any case form', () => {
    const c = crmStore.addContact({ name: 'Сергей Петров-Тест' });
    expect(findContactFuzzy('Петрову')?.id).toBe(c.id);
    crmStore.deleteContact(c.id);
    expect(guessPayerType('ООО «Ромашка»')).toBe('company');
    expect(guessPayerType('Анна')).toBe('person');
  });

  it('runs tools end to end', async () => {
    store.updateProfile({ regime: 'npd' });
    const tools = Object.fromEntries(createBizTools(store).map(t => [t.id, t]));
    const inc = await tools.biz_add_income.execute({ amount: 5000, client: 'Анна', description: 'урок' });
    expect(describeBizResult('biz_add_income', inc)).toContain('Мой налог');
    const doc = await tools.biz_create_document.execute({ client: 'ООО Альфа', service: 'Сайт', amount: 30000 });
    expect(guessPayerType('ООО Альфа')).toBe('company');
    expect(doc.data.number).toBe('1');
    expect((await tools.biz_mark_paid.execute({ invoice: '1' })).success).toBe(true);
    const tax = await tools.biz_tax_summary.execute({});
    expect(describeBizResult('biz_tax_summary', tax)).toContain('НПД');
    const sup = await tools.biz_find_support.execute({ kind: 'consulting' });
    expect(describeBizResult('biz_find_support', sup)).toContain('мойбизнес.рф');
  });

  it('accepts biz_ actions from the AI and adds business context to the prompt', () => {
    const { actions } = parseCRMActions('Ок [CRM: {"tool":"biz_add_income","args":{"amount":100}}]');
    expect(actions[0].tool).toBe('biz_add_income');
    expect(crmSystemPrompt()).toContain('БИЗНЕС');
  });
});
