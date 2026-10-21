// Статусы записей меняются только по правилам: книга доходов и записи не расходятся.
import { describe, it, expect } from 'vitest';
import { BookingStore, canSetStatus, BOOKING_DONE_LOCKED, BOOKING_CANCELLED_LOCKED } from '../services/biz/Booking';
import { BizStore } from '../services/biz/BizStore';
import { completeAppointment, createBookingTools } from '../services/biz/BookingTools';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
// Понедельник, 9:00: рабочий день по умолчанию с 10 до 19.
const NOW = new Date(2026, 9, 19, 9, 0).getTime();
const at = (h: number) => new Date(2026, 9, 19, h, 0).getTime();

function setup() {
  const store = new BookingStore(mem(), () => NOW);
  const biz = new BizStore(mem() as any);
  const a = store.book({ clientName: 'Петрова', start: at(11), price: 1500 });
  return { store, biz, a };
}
const incomes = (biz: BizStore) => biz.listEntries().filter((e: any) => e.kind === 'income').length;

describe('booking status transitions', () => {
  it('the rules', () => {
    expect(canSetStatus('booked', 'done')).toBe(true);
    expect(canSetStatus('booked', 'cancelled')).toBe(true);
    expect(canSetStatus('booked', 'noshow')).toBe(true);
    expect(canSetStatus('noshow', 'done')).toBe(true); // опоздал, а отметили рано
    expect(canSetStatus('done', 'cancelled')).toBe(false);
    expect(canSetStatus('done', 'noshow')).toBe(false);
    expect(canSetStatus('cancelled', 'done')).toBe(false);
    expect(canSetStatus('cancelled', 'noshow')).toBe(false);
  });

  it('a completed visit with income cannot be cancelled or moved', () => {
    const { store, biz, a } = setup();
    completeAppointment(a, undefined, store, biz);
    expect(incomes(biz)).toBe(1);
    expect(() => store.setStatus(a.id, 'cancelled')).toThrow(BOOKING_DONE_LOCKED);
    expect(() => store.reschedule(a.id, at(15))).toThrow(BOOKING_DONE_LOCKED);
    expect(store.getAppointment(a.id)?.status).toBe('done');
  });

  it('a cancelled booking cannot be completed and writes no income', () => {
    const { store, biz, a } = setup();
    store.setStatus(a.id, 'cancelled');
    expect(() => completeAppointment(a, undefined, store, biz)).toThrow(BOOKING_CANCELLED_LOCKED);
    expect(incomes(biz)).toBe(0);
    expect(store.getAppointment(a.id)?.status).toBe('cancelled');
  });

  it('a cancelled booking can be moved back to a booking', () => {
    const { store, a } = setup();
    store.setStatus(a.id, 'cancelled');
    expect(store.reschedule(a.id, at(15)).status).toBe('booked');
  });

  it('the AI tools refuse a wrong transition with a clear message', async () => {
    const { store, biz, a } = setup();
    const tools = createBookingTools(store, () => undefined, biz);
    const complete = tools.find(t => t.id === 'biz_complete_booking')!;
    const cancel = tools.find(t => t.id === 'biz_cancel_booking')!;
    expect((await complete.execute({ id: a.id })).success).toBe(true);
    const r = await cancel.execute({ id: a.id });
    expect(r.success).toBe(false);
    expect(r.error).toBe(BOOKING_DONE_LOCKED);
    expect(incomes(biz)).toBe(1);
  });
});
