// Пачка 18: «Бизнес» отдаёт копии. Изменить запись или счёт через полученный объект нельзя.
import { describe, it, expect } from 'vitest';
import { BizStore } from '../services/biz/BizStore';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
const NOW = new Date(2026, 9, 9, 12).getTime();

describe('BizStore returns copies', () => {
  it('entries cannot be changed through returned objects', () => {
    const s = new BizStore(memory(), () => NOW);
    const e = s.addEntry({ kind: 'income', amount: 1000, description: 'Урок' });
    e.amount = 1_000_000;
    s.listEntries()[0].description = 'подмена';
    s.setReceipt(e.id, '123').receiptNumber = 'подмена';
    const now = s.listEntries()[0];
    expect(now.amount).toBe(1000);
    expect(now.description).toBe('Урок');
    expect(now.receiptNumber).toBe('123');
  });

  it('documents and their items cannot be changed through returned objects', () => {
    const s = new BizStore(memory(), () => NOW);
    const d = s.createDocument({ type: 'invoice', clientName: 'Иванов', items: [{ name: 'Дизайн', qty: 1, price: 5000 }] });
    d.status = 'paid';
    d.items[0].price = 1;
    s.getDocument(d.id)!.total = 1;
    s.listDocuments()[0].items.push({ name: 'лишнее', qty: 1, price: 1 });
    s.receivables()[0].document.status = 'cancelled';
    const now = s.getDocument(d.id)!;
    expect(now.status).toBe('draft');
    expect(now.total).toBe(5000);
    expect(now.items).toEqual([{ name: 'Дизайн', qty: 1, price: 5000 }]);
    const paid = s.markPaid(d.id);
    paid.document.status = 'draft';
    paid.entry.amount = 1;
    expect(s.getDocument(d.id)!.status).toBe('paid');
    expect(s.listEntries({ kind: 'income' })[0].amount).toBe(5000);
  });
});
