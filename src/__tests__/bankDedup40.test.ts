import { describe, it, expect } from 'vitest';
import { importStatement, statementRowKey, type ParsedStatement, type BankDoc } from '../services/biz/BankStatement';

const OWN = '40802810000000000001';

function fakeStore() {
  const entries: { id: string; kind: string; amount: number }[] = [];
  let n = 0;
  const store: any = {
    getProfile: () => ({ account: OWN }),
    receivables: () => [],
    markPaid: () => { throw new Error('no invoices'); },
    addEntry: (e: any) => { const x = { ...e, id: `e${++n}` }; entries.push(x); return x; },
    deleteEntry: (id: string) => { const i = entries.findIndex((x) => x.id === id); if (i >= 0) entries.splice(i, 1); },
  };
  return { store, entries };
}

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
}

const row = (over: Partial<BankDoc> = {}): BankDoc => ({
  type: 'Платежное поручение', number: '', date: 1700000000000, amount: 500,
  payerAccount: '40817810000000000009', payerName: 'Иванов И.', payerInn: '',
  payeeAccount: OWN, payeeName: 'Я', payeeInn: '', purpose: 'Перевод', ...over,
});

describe('bank statement dedup', () => {
  it('two identical rows without number are both imported, repeat import adds nothing', () => {
    const { store, entries } = fakeStore();
    const s = mem();
    const parsed: ParsedStatement = { account: OWN, docs: [row(), row()] };
    const r1 = importStatement(parsed, { store, storage: s as any });
    expect(r1.incomes).toBe(2);
    expect(entries.length).toBe(2);
    const r2 = importStatement(parsed, { store, storage: s as any });
    expect(r2.duplicates).toBe(2);
    expect(entries.length).toBe(2);
  });

  it('different counterparty account gives a different key', () => {
    const a = statementRowKey(OWN, row(), true, 0);
    const b = statementRowKey(OWN, row({ payerAccount: '40817810000000000010' }), true, 0);
    expect(a).not.toBe(b);
  });

  it('row imported by the old key format is not duplicated', () => {
    const { store, entries } = fakeStore();
    const s = mem();
    const d = row({ number: '17' });
    const legacy = [OWN, d.number, d.date ?? '', d.amount.toFixed(2), d.payerInn, 'in'].join('|');
    s.setItem('svetlana_bank_imported_v1', JSON.stringify([legacy]));
    const r = importStatement({ account: OWN, docs: [d] }, { store, storage: s as any });
    expect(r.duplicates).toBe(1);
    expect(entries.length).toBe(0);
  });

  it('NaN amount is skipped', () => {
    const { store } = fakeStore();
    const r = importStatement({ account: OWN, docs: [row({ amount: Number.NaN })] }, { store, storage: null });
    expect(r.skipped).toBe(1);
  });
});
