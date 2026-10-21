// Пачка 22: оборвавшийся импорт выписки не задваивает строки при повторе; сбой CRM не делает запись «неудачной».
import { describe, it, expect } from 'vitest';
import { BizStore } from '../services/biz/BizStore';
import { importStatement, type BankDoc, type ParsedStatement } from '../services/biz/BankStatement';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function memory() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
const NOW = new Date(2026, 9, 9, 12).getTime();
const doc = (n: string, amount: number): BankDoc => ({
  type: 'Платежное поручение', number: n, date: NOW, amount, payerAccount: '40817810000000000001', payerName: 'Иванов Иван',
  payerInn: '', payeeAccount: '40802810000000000002', payeeName: '', payeeInn: '', purpose: `Оплата ${n}`,
});
const statement: ParsedStatement = { account: '40802810000000000002', docs: [doc('1', 100), doc('2', 200), doc('3', 300)] };

describe('bank statement import resume', () => {
  it('a failed marker save rolls the row back, and a retry finishes without duplicates', () => {
    const store = new BizStore(memory(), () => NOW);
    const marks = memory();
    let calls = 0;
    const flaky = { getItem: marks.getItem, setItem: (k: string, v: string) => { calls++; if (calls === 2) throw new Error('QuotaExceededError'); marks.setItem(k, v); } };
    expect(() => importStatement(statement, { store, storage: flaky })).toThrow(/внесено строк 1 из 3/);
    expect(store.listEntries({ kind: 'income' })).toHaveLength(1);
    const r = importStatement(statement, { store, storage: marks });
    expect(r).toMatchObject({ incomes: 2, duplicates: 1 });
    expect(store.listEntries({ kind: 'income' }).map(e => e.amount).sort((a, b) => a - b)).toEqual([100, 200, 300]);
    expect(importStatement(statement, { store, storage: marks }).duplicates).toBe(3);
  });

  it('booking keeps the appointment when only the CRM note fails', () => {
    const tools = readFileSync(resolve(__dirname, '../services/biz/BookingTools.ts'), 'utf8');
    expect(tools).toContain('catch { crmNoteFailed = true; }');
    expect(tools).toContain('BOOKING_CRM_NOTE_FAILED');
  });
});
