// Бизнес: сбой хранилища не оставляет «призрачных» доходов, неверные даты и сроки отклоняются,
// оплата счёта сохраняется одной записью.
import { describe, it, expect } from 'vitest';
import { BizStore, BIZ_SAVE_FAILED } from '../services/biz/BizStore';

function flakyStorage() {
  const map = new Map<string, string>();
  const s = { fail: false, writes: 0, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { if (s.fail) throw new Error('QuotaExceededError'); s.writes++; map.set(k, v); } };
  return s;
}

describe('BizStore all-or-nothing', () => {
  it('rolls back an income when storage is full', () => {
    const st = flakyStorage();
    const store = new BizStore(st, () => Date.UTC(2026, 9, 1));
    let notified = 0;
    store.subscribe(() => { notified++; });
    st.fail = true;
    expect(() => store.addEntry({ kind: 'income', amount: 5000, description: 'Урок' })).toThrow(BIZ_SAVE_FAILED);
    expect(store.listEntries()).toHaveLength(0);
    expect(notified).toBe(0);
    st.fail = false;
    store.addEntry({ kind: 'income', amount: 5000, description: 'Урок' });
    expect(store.listEntries()).toHaveLength(1);
    expect(notified).toBe(1);
  });

  it('rejects bad dates, due days and profile numbers', () => {
    const store = new BizStore(flakyStorage(), () => Date.UTC(2026, 9, 1));
    const doc = { type: 'invoice' as const, clientName: 'Иванов', items: [{ name: 'Дизайн', qty: 1, price: 1000 }] };
    expect(() => store.createDocument({ ...doc, dueDays: Number.NaN })).toThrow();
    expect(() => store.createDocument({ ...doc, dueDays: 9999 })).toThrow();
    expect(() => store.createDocument({ ...doc, date: Number.NaN })).toThrow();
    expect(() => store.addEntry({ kind: 'income', amount: 100, description: '', date: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => store.updateProfile({ patentCost: Number.NaN })).toThrow();
    expect(() => store.updateProfile({ fixedContributions: -1 })).toThrow();
    expect(store.updateProfile({ birthYear: 0 }).birthYear).toBeUndefined();
    expect(store.listDocuments()).toHaveLength(0);
  });

  it('marks an invoice paid with a single write', () => {
    const st = flakyStorage();
    const store = new BizStore(st, () => Date.UTC(2026, 9, 1));
    const d = store.createDocument({ type: 'invoice', clientName: 'Иванов', items: [{ name: 'Дизайн', qty: 1, price: 1000 }] });
    const before = st.writes;
    const r = store.markPaid(d.id);
    expect(st.writes - before).toBe(1);
    expect(r.document.status).toBe('paid');
    expect(store.markPaid(d.id).entry.id).toBe(r.entry.id);
    expect(store.listEntries({ kind: 'income' })).toHaveLength(1);
  });
});
