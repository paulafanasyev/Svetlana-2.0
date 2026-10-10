// Svetlana Business: проверка контрагентов по ИНН и импорт выписки 1С
import { describe, it, expect } from 'vitest';
import { validateInn, checkCounterparty, lookupBank, reportText, type FetchLike } from '../services/biz/Counterparty';
import { parse1C, importStatement, decodeStatement } from '../services/biz/BankStatement';
import { BizStore } from '../services/biz/BizStore';
import { detectBizIntent } from '../services/biz/BizTools';
import type { KeyValueStorage } from '../services/crm/CRMStore';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

const NOW = new Date(2026, 9, 11, 12).getTime();
const IP_INN = '500301234503';

function mockFetch(routes: Record<string, any>, calls: string[] = []): FetchLike {
  return async (url, init) => {
    calls.push(`${url} ${init?.body ?? ''}`);
    const hit = Object.keys(routes).find(k => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const body = routes[hit];
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

describe('ИНН', () => {
  it('validates checksums', () => {
    expect(validateInn('7707083893')).toBe(true);   // ПАО Сбербанк
    expect(validateInn('7707083894')).toBe(false);
    expect(validateInn(IP_INN)).toBe(true);
    expect(validateInn('123')).toBe(false);
  });

  it('works offline: only checksum, with official links', async () => {
    const r = await checkCounterparty('7707083893', { now: NOW, key: '', fetchImpl: null });
    expect(r.validInn).toBe(true);
    expect(r.party).toBeUndefined();
    expect(r.links.some(l => l.url.includes('egrul.nalog.ru'))).toBe(true);
    expect(r.notes[0]).toContain('DaData');
  });

  it('flags an invalid INN as a risk', async () => {
    const r = await checkCounterparty('7707083894', { now: NOW, key: 'k', fetchImpl: null });
    expect(r.risks[0]).toContain('контрольной суммы');
  });

  it('reads company data from DaData and flags liquidation and young companies', async () => {
    const calls: string[] = [];
    const f = mockFetch({
      '/party': { suggestions: [{ value: 'ООО "РОМАШКА"', data: {
        inn: '7707083893', kpp: '773601001', ogrn: '1027700132195', type: 'LEGAL',
        name: { short_with_opf: 'ООО "РОМАШКА"', full_with_opf: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "РОМАШКА"' },
        address: { unrestricted_value: 'г Москва' }, management: { name: 'Иванов Иван', post: 'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР' },
        state: { status: 'LIQUIDATING', registration_date: NOW - 30 * 86_400_000 },
      } }] },
    }, calls);
    const r = await checkCounterparty('7707083893', { now: NOW, key: 'secret', fetchImpl: f });
    expect(r.party?.name).toBe('ООО "РОМАШКА"');
    expect(r.party?.manager).toContain('Иванов');
    expect(r.risks).toHaveLength(2);
    expect(reportText(r)).toContain('Ликвидируется');
    expect(calls[0]).toContain('"query":"7707083893"');
  });

  it('checks НПД status for a 12-digit INN that is not an ИП', async () => {
    const f = mockFetch({ '/party': { suggestions: [] }, statusnpd: { status: true, message: 'является' } });
    const r = await checkCounterparty(IP_INN, { now: NOW, key: 'k', fetchImpl: f });
    expect(r.selfEmployed).toBe(true);
    expect(reportText(r)).toContain('НПД');
  });

  it('reports a rejected DaData key', async () => {
    const r = await checkCounterparty('7707083893', { now: NOW, key: 'bad', fetchImpl: mockFetch({ '/party': 403 }) });
    expect(r.notes.join(' ')).toContain('ключ');
  });

  it('looks up a bank by БИК', async () => {
    const b = await lookupBank('044525225', { key: 'k', fetchImpl: mockFetch({ '/bank': { suggestions: [{ data: { bic: '044525225', correspondent_account: '30101810400000000225', name: { payment: 'ПАО Сбербанк' } } }] } }) });
    expect(b).toEqual({ bik: '044525225', name: 'ПАО Сбербанк', corrAccount: '30101810400000000225', address: undefined });
  });

  it('routes «проверь ИНН …» to the checker', () => {
    expect(detectBizIntent('Проверь ИНН 7707083893')).toEqual({ tool: 'biz_check_inn', args: { inn: '7707083893' } });
    expect(detectBizIntent('проверь контрагента 770708389')).toBeNull();
  });
});

const OWN = '40802810000000000001';
const STATEMENT = [
  '1CClientBankExchange', 'ВерсияФормата=1.03', 'Кодировка=Windows', 'ДатаНачала=01.10.2026', 'ДатаКонца=10.10.2026', `РасчСчет=${OWN}`,
  'СекцияДокумент=Платежное поручение', 'Номер=15', 'Дата=02.10.2026', 'Сумма=15000.00', 'ПлательщикСчет=40702810900000000002',
  'Плательщик=ИНН 7707083893 ООО "РОМАШКА"', 'Плательщик1=ООО "РОМАШКА"', 'ПлательщикИНН=7707083893', `ПолучательСчет=${OWN}`,
  'Получатель1=ИП Петров', 'ДатаПоступило=03.10.2026', 'НазначениеПлатежа=Оплата по счету № 1 за дизайн. Без НДС', 'КонецДокумента',
  'СекцияДокумент=Платежное поручение', 'Номер=7', 'Дата=05.10.2026', 'Сумма=2500.50', `ПлательщикСчет=${OWN}`, 'Плательщик1=ИП Петров',
  'ПолучательСчет=40702810000000000099', 'Получатель1=ООО "Реклама"', 'ПолучательИНН=7707083893', 'ДатаСписано=05.10.2026',
  'НазначениеПлатежа=Оплата рекламы', 'КонецДокумента',
  'СекцияДокумент=Банковский ордер', 'Номер=8', 'Дата=06.10.2026', 'Сумма=3000', 'ПлательщикСчет=40817810000000000003',
  'Плательщик1=Сидорова Анна Петровна', 'ПлательщикИНН=', `ПолучательСчет=${OWN}`, 'ДатаПоступило=06.10.2026',
  'НазначениеПлатежа=Перевод за консультацию', 'КонецДокумента', 'КонецФайла',
].join('\r\n');

describe('выписка 1С', () => {
  it('parses header and documents', () => {
    const p = parse1C(STATEMENT);
    expect(p.account).toBe(OWN);
    expect(p.docs).toHaveLength(3);
    expect(p.docs[0]).toMatchObject({ number: '15', amount: 15000, payerName: 'ООО "РОМАШКА"', payerInn: '7707083893' });
    expect(() => parse1C('просто текст')).toThrow();
  });

  it('decodes Windows-1251 files', () => {
    // «СекцияДокумент» in cp1251
    const cp1251 = new Uint8Array([0xd1, 0xe5, 0xea, 0xf6, 0xe8, 0xff, 0xc4, 0xee, 0xea, 0xf3, 0xec, 0xe5, 0xed, 0xf2]);
    expect(decodeStatement(cp1251)).toBe('СекцияДокумент');
  });

  it('imports incomes/expenses, closes the matching invoice and ignores re-imports', () => {
    const storage = memory();
    const store = new BizStore(storage, () => NOW);
    store.updateProfile({ regime: 'npd' });
    const inv = store.createDocument({ type: 'invoice', clientName: 'ООО «Ромашка»', items: [{ name: 'Дизайн', qty: 1, price: 15000 }] });
    const r = importStatement(parse1C(STATEMENT), { store, storage });
    expect(r).toMatchObject({ incomes: 2, expenses: 1, invoicesPaid: 1, duplicates: 0, skipped: 0 });
    expect(store.getDocument(inv.id)?.status).toBe('paid');
    const incomes = store.listEntries({ kind: 'income' });
    expect(incomes).toHaveLength(2);
    expect(incomes.find(e => e.amount === 15000)?.payerType).toBe('company');
    expect(incomes.find(e => e.amount === 3000)?.payerType).toBe('person');
    expect(store.listEntries({ kind: 'expense' })[0].amount).toBe(2500.5);
    const again = importStatement(parse1C(STATEMENT), { store, storage });
    expect(again.duplicates).toBe(3);
    expect(store.listEntries()).toHaveLength(3);
  });
});
