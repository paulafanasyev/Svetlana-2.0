// Пачка 60: два окна не стирают записи клиентов друг друга.
import { describe, it, expect } from 'vitest';
import { BookingStore, BOOKING_CHANGED_ELSEWHERE, BOOKING_SAVE_FAILED } from '../services/biz/Booking';
import type { KeyValueStorage } from '../services/crm/CRMStore';

function shared(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}
const DAY = 86_400_000;
// Ближайший будний день в будущем, 11:00 и 12:00 (внутри рабочих часов по умолчанию).
function slot(hour: number): number {
  const d = new Date(Date.now() + 2 * DAY);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0).getTime();
}

describe('bookings in two windows', () => {
  it('an old copy does not overwrite a booking made in the other window', () => {
    const disk = shared();
    const a = new BookingStore(disk);
    a.listServices(); // оба окна открыты до первой записи
    const b = new BookingStore(disk);
    a.book({ clientName: 'Иванова', start: slot(11) });
    expect(() => b.book({ clientName: 'Петров', start: slot(12) })).toThrow(BOOKING_CHANGED_ELSEWHERE);
    expect(b.listAppointments().map(x => x.clientName)).toEqual(['Иванова']);
    b.book({ clientName: 'Петров', start: slot(12) });
    expect(new BookingStore(disk).listAppointments().map(x => x.clientName)).toEqual(['Иванова', 'Петров']);
  });

  it('the other window cannot double-book a time it did not see', () => {
    const disk = shared();
    const a = new BookingStore(disk);
    const b = new BookingStore(disk);
    a.book({ clientName: 'Иванова', start: slot(11) });
    expect(() => b.book({ clientName: 'Петров', start: slot(11) })).toThrow(BOOKING_CHANGED_ELSEWHERE);
    expect(() => b.book({ clientName: 'Петров', start: slot(11) })).toThrow(/занято/);
  });

  it('a failed save still rolls back', () => {
    let fail = false;
    const m = new Map<string, string>();
    const disk: KeyValueStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => { if (fail) throw new Error('quota'); m.set(k, v); } };
    const s = new BookingStore(disk);
    s.book({ clientName: 'Есть', start: slot(11) });
    fail = true;
    expect(() => s.book({ clientName: 'Нет', start: slot(12) })).toThrow(BOOKING_SAVE_FAILED);
    expect(s.listAppointments()).toHaveLength(1);
    fail = false;
    s.book({ clientName: 'Потом', start: slot(12) });
    expect(new BookingStore(disk).listAppointments()).toHaveLength(2);
  });
});
