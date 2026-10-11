// Налоговые правила 2026: взносы, производственный календарь, НДС на УСН, сроки, документы
import { describe, it, expect, beforeEach } from 'vitest';
import { BizStore } from '../services/biz/BizStore';
import {
  contributionsFor, onePercent, isWorkingDay, dueDate, npdReceiptDeadline, vatExemptThreshold, vatStatusUsn, patentPayments,
} from '../services/biz/TaxRules';
import { rublesInWords, paymentString, renderDocumentHTML } from '../services/biz/DocTemplates';
import { findSupport } from '../services/biz/SupportCatalog';
import type { KeyValueStorage } from '../services/crm/CRMStore';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

let now = day(2026, 10, 11);
let store: BizStore;
beforeEach(() => { now = day(2026, 10, 11); store = new BizStore(memory(), () => now); });

describe('contributions', () => {
  it('knows 2024–2026 and caps the 1%', () => {
    expect(contributionsFor(2026)).toMatchObject({ fixed: 57_390, cap1: 321_818, known: true });
    expect(contributionsFor(2030).known).toBe(false);
    expect(onePercent(1_300_000, 2026)).toBe(10_000);
    expect(onePercent(200_000, 2026)).toBe(0);
    expect(onePercent(1e12, 2026)).toBe(321_818);
  });
  it('defaults the profile to the current-year fixed amount', () => {
    expect(store.getProfile().fixedContributions).toBe(57_390);
  });
});

describe('production calendar', () => {
  it('treats holidays and transfers', () => {
    expect(isWorkingDay(day(2026, 1, 9))).toBe(false);
    expect(isWorkingDay(day(2026, 5, 11))).toBe(false);
    expect(isWorkingDay(day(2026, 10, 12))).toBe(true);
    expect(isWorkingDay(day(2025, 11, 1))).toBe(true);
  });
  it('moves deadlines off weekends', () => {
    // 28.11.2026 — суббота → 30.11
    expect(ymd(dueDate(2026, 10, 28))).toBe('2026-11-30');
    // 9.11.2026 — понедельник
    expect(ymd(npdReceiptDeadline(day(2026, 10, 20)))).toBe('2026-11-9');
  });
});

describe('VAT on УСН', () => {
  it('uses the yearly thresholds', () => {
    expect(vatExemptThreshold(2026)).toBe(20_000_000);
    expect(vatExemptThreshold(2027)).toBe(15_000_000);
    expect(vatExemptThreshold(2028)).toBe(10_000_000);
  });
  it('starts VAT from the month after the threshold is crossed', () => {
    const months = Array(12).fill(0); months[0] = 15_000_000; months[2] = 6_000_000;
    const v = vatStatusUsn(2026, 0, months);
    expect(v.status).toBe('vat'); expect(v.rate).toBe(5); expect(v.fromMonth).toBe(3);
  });
  it('applies VAT all year when last year was over the threshold', () => {
    expect(vatStatusUsn(2026, 25_000_000, Array(12).fill(0))).toMatchObject({ status: 'vat', fromMonth: 0 });
    expect(vatStatusUsn(2026, 25_000_000, Array(12).fill(0), true).rate).toBe(22);
    expect(vatStatusUsn(2026, 0, Array(12).fill(1_000_000)).status).toBe('exempt');
  });
});

describe('УСН summary', () => {
  it('УСН 6%: fixed + previous-year 1% reduce the tax, 50% cap with employees', () => {
    store.updateProfile({ regime: 'usn6' });
    store.addEntry({ kind: 'income', amount: 1_300_000, description: 'прошлый год', date: day(2025, 6, 1) });
    store.addEntry({ kind: 'income', amount: 2_000_000, description: 'этот год', date: day(2026, 3, 1) });
    const u = store.usnSummary(2026);
    expect(u.taxGross).toBe(120_000);
    expect(u.contributionsPrevExtra).toBe(10_000);
    expect(u.contributionsExtra).toBe(17_000);
    expect(u.contributionsDeducted).toBe(67_390);
    expect(u.taxAfterContributions).toBe(52_610);
    store.updateProfile({ hasEmployees: true });
    expect(store.usnSummary(2026).taxAfterContributions).toBe(60_000);
  });
  it('УСН 15%: contributions are expenses, 1% base is income − expenses, minimum tax 1%', () => {
    store.updateProfile({ regime: 'usn15' });
    store.addEntry({ kind: 'income', amount: 1_000_000, description: 'доход', date: day(2026, 2, 1) });
    store.addEntry({ kind: 'expense', amount: 200_000, description: 'аренда', date: day(2026, 2, 2) });
    const u = store.usnSummary(2026);
    expect(u.contributionsExtra).toBe(5_000);
    expect(u.base).toBe(737_610);
    expect(u.taxAfterContributions).toBe(110_641.5);
    store.addEntry({ kind: 'expense', amount: 790_000, description: 'закупка', date: day(2026, 2, 3) });
    expect(store.usnSummary(2026).taxAfterContributions).toBe(10_000);
  });
  it('skips non-taxable entries', () => {
    store.updateProfile({ regime: 'usn6' });
    const e = store.addEntry({ kind: 'income', amount: 500_000, description: 'перевод себе', date: day(2026, 3, 1) });
    store.setTaxable(e.id, false);
    expect(store.usnSummary(2026).income).toBe(0);
  });
});

describe('deadlines', () => {
  it('НПД: receipts on the 9th and tax on the 28th, shifted to working days', () => {
    store.updateProfile({ regime: 'npd' });
    const dl = store.deadlines(60).map(d => `${ymd(d.date)} ${d.title}`);
    expect(dl).toContain('2026-10-28 Налог НПД');
    expect(dl).toContain('2026-11-9 Чеки НПД');
    expect(dl).toContain('2026-11-30 Налог НПД');
  });
  it('ИП на УСН: advance in October, fixed contributions in December, 1% on 1 July', () => {
    store.updateProfile({ regime: 'usn6' });
    const dl = store.deadlines(300).map(d => `${ymd(d.date)} ${d.title}`);
    expect(dl).toContain('2026-10-28 Аванс УСН за 9 месяцев');
    expect(dl).toContain('2026-12-28 Фиксированные взносы ИП');
    expect(dl).toContain('2027-7-1 Взнос 1% с дохода свыше 300 000 ₽');
    expect(dl.some(x => x.includes('Декларация УСН ИП'))).toBe(true);
  });
  it('ООО на УСН: declaration in March', () => {
    store.updateProfile({ regime: 'ooo', orgOnUsn: true });
    now = day(2027, 3, 1);
    expect(store.deadlines(40).map(d => d.title)).toContain('Декларация УСН (организация)');
  });
  it('patent payments: 1/3 within 90 days and the rest by the end', () => {
    const p = patentPayments(day(2026, 1, 12), day(2026, 12, 31), 60_000);
    expect(p).toHaveLength(2);
    expect(p[0].amount).toBe(20_000);
    expect(patentPayments(day(2026, 1, 12), day(2026, 3, 31), 9_000)).toHaveLength(1);
  });
});

describe('documents', () => {
  it('blocks paying cancelled invoices and invalid transitions', () => {
    const d = store.createDocument({ type: 'invoice', clientName: 'Клиент', items: [{ name: 'Услуга', qty: 1, price: 1000 }] });
    store.setDocumentStatus(d.id, 'cancelled');
    expect(() => store.markPaid(d.id)).toThrow();
    expect(() => store.setDocumentStatus(d.id, 'paid')).toThrow();
  });
  it('prints VAT note, units and signature lines', () => {
    store.updateProfile({ regime: 'npd', fullName: 'Иванов И.И.' });
    const d = store.createDocument({ type: 'act', clientName: 'ООО Ромашка', items: [{ name: 'Услуга', qty: 2, price: 500 }] });
    const html = renderDocumentHTML(d, store.getProfile());
    expect(html).toContain('Без НДС (плательщик налога на профессиональный доход)');
    expect(html).toContain('<th>Ед.</th>');
    expect(html).toContain('расшифровка');
  });
  it('rublesInWords handles trillions and rejects absurd sums', () => {
    expect(rublesInWords(2e12)).toContain('Два триллиона');
    expect(() => rublesInWords(1e16)).toThrow();
  });
  it('payment string strips control chars and validates details', () => {
    store.updateProfile({ fullName: 'ИП\r\nПетров', account: '40802810000000000001', bik: '044525225', bankName: 'Банк', corrAccount: '30101810400000000225' });
    const s = paymentString(store.getProfile(), 100, 'Оплата\n№1|2');
    expect(s).toContain('Name=ИП Петров|');
    expect(s).toContain('Purpose=Оплата №1 2');
    expect(() => paymentString({ ...store.getProfile(), account: '123' }, 100, 'x')).toThrow();
    expect(() => paymentString(store.getProfile(), 0, 'x')).toThrow();
  });
});

describe('support catalog', () => {
  it('keeps borderline ages and drops НПД from Агростартап', () => {
    store.updateProfile({ regime: 'usn6', birthYear: 2001, sectors: ['agro'] });
    const ids = findSupport(store.getProfile(), now).map(m => m.measure.id);
    expect(ids).toContain('youth-grant');
    store.updateProfile({ regime: 'npd' });
    expect(findSupport(store.getProfile(), now).map(m => m.measure.id)).not.toContain('agro');
  });
});
