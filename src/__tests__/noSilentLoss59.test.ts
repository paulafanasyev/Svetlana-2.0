// Пачка 59: ничего не теряется молча: ни сказанная фраза, ни лишний доход в книге.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { completeAppointment } from '../services/biz/BookingTools';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const appt = () => ({ id: 'a1', status: 'booked', price: 1500, serviceName: 'Стрижка', clientName: 'Иванова', start: Date.now() - 3_600_000, end: Date.now() }) as any;
const store = (fail: boolean) => ({
  getAppointment: () => appt(),
  now: () => Date.now(),
  setStatus: (_id: string, status: string, entryId?: string) => { if (fail) throw new Error('Запись не сохранилась'); return { ...appt(), status, incomeEntryId: entryId }; },
}) as any;

describe('booking income is never left behind silently', () => {
  it('income is rolled back when the visit cannot be saved', () => {
    const removed: string[] = [];
    const biz = { addEntry: () => ({ id: 'in_1' }), deleteEntry: (id: string) => { removed.push(id); } } as any;
    expect(() => completeAppointment(appt(), undefined, store(true), biz)).toThrow('Запись не сохранилась');
    expect(removed).toEqual(['in_1']);
  });

  it('if the rollback fails too, the person is told the income is still in the ledger', () => {
    const biz = { addEntry: () => ({ id: 'in_1' }), deleteEntry: () => { throw new Error('quota'); } } as any;
    expect(() => completeAppointment(appt(), undefined, store(true), biz)).toThrow(/уже записан в книгу/);
  });

  it('normal visit records income once', () => {
    const biz = { addEntry: () => ({ id: 'in_2' }), deleteEntry: () => undefined } as any;
    const r = completeAppointment(appt(), 2000, store(false), biz);
    expect(r.income).toBe(2000);
    expect(r.appointment.incomeEntryId).toBe('in_2');
  });
});

describe('hands-free does not drop a phrase silently', () => {
  it('a phrase over the recognition queue limit is reported', () => {
    const s = src('services/voice/SpeechEngine.ts');
    expect(s).toContain('export const STT_BUSY_TEXT');
    expect(s).toMatch(/pending >= MAX_PENDING\) \{[^}]*STT_BUSY_TEXT/);
  });
});
