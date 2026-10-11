// Svetlana Business: запись клиентов
import { describe, it, expect } from 'vitest';
import { BookingStore, parseWhen, normalizeClientName, toICS, timeOf } from '../services/biz/Booking';
import { createBookingTools, detectBookingIntent, describeBookingResult } from '../services/biz/BookingTools';
import { BizStore } from '../services/biz/BizStore';
import type { KeyValueStorage } from '../services/crm/CRMStore';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

// Пятница, 9 октября 2026, 09:00
const NOW = new Date(2026, 9, 9, 9, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

function store(): BookingStore {
  const s = new BookingStore(memory(), () => NOW);
  s.addService({ name: 'Стрижка', durationMin: 60, price: 1500 });
  s.addService({ name: 'Маникюр', durationMin: 90, price: 2000 });
  return s;
}

describe('даты по-русски', () => {
  it('parses relative days, weekdays, dates and times', () => {
    expect(parseWhen('завтра в 15:00', NOW)).toMatchObject({ day: new Date(2026, 9, 10).getTime(), minutes: 900 });
    expect(parseWhen('в понедельник в 10', NOW)).toMatchObject({ day: new Date(2026, 9, 12).getTime(), minutes: 600 });
    expect(parseWhen('в пятницу в 7 вечера', NOW)).toMatchObject({ day: new Date(2026, 9, 16).getTime(), minutes: 19 * 60 });
    expect(parseWhen('12.10 в 9:30', NOW)).toMatchObject({ day: new Date(2026, 9, 12).getTime(), minutes: 570 });
    expect(parseWhen('15 октября в 11', NOW)).toMatchObject({ day: new Date(2026, 9, 15).getTime(), minutes: 660 });
    expect(parseWhen('1.01 в 12', NOW).day).toBe(new Date(2027, 0, 1).getTime());
    expect(parseWhen('Иванову на стрижку завтра в 15', NOW).rest).toBe('иванову на стрижку');
  });

  it('normalizes surnames from dative', () => {
    expect(normalizeClientName('Иванову')).toBe('Иванов');
    expect(normalizeClientName('Петровой')).toBe('Петрова');
    expect(normalizeClientName('Анна')).toBe('Анна');
  });
});

describe('расписание и окна', () => {
  it('lists free slots inside working hours, skipping the break and past time', () => {
    const s = store();
    const slots = s.freeSlots(at(9, 12), 60).map(timeOf);
    expect(slots[0]).toBe('10:00');
    expect(slots).toContain('13:00');
    expect(slots.includes('13:30')).toBe(false); // заходит на перерыв 14–15
    expect(slots.includes('14:00')).toBe(false);
    expect(slots[slots.length - 1]).toBe('18:00');
    expect(s.freeSlots(at(10, 12), 60)).toHaveLength(0); // суббота выходной
  });

  it('books, prevents double booking and frees the time after cancel', () => {
    const s = store();
    const a = s.book({ clientName: 'Иванов', start: at(9, 15), serviceName: 'стрижку' });
    expect(a).toMatchObject({ serviceName: 'Стрижка', price: 1500, status: 'booked' });
    expect(a.end - a.start).toBe(3_600_000);
    expect(() => s.book({ clientName: 'Петрова', start: at(9, 15, 30), serviceName: 'Маникюр' })).toThrow();
    expect(() => s.book({ clientName: 'Петрова', start: at(10, 12) })).toThrow(); // выходной
    expect(() => s.book({ clientName: 'Петрова', start: at(9, 18, 30), serviceName: 'Маникюр' })).toThrow(); // после 19:00
    expect(s.freeSlots(at(9, 12), 60).map(timeOf).includes('15:00')).toBe(false);
    s.setStatus(a.id, 'cancelled');
    expect(s.freeSlots(at(9, 12), 60).map(timeOf)).toContain('15:00');
  });

  it('builds reminders, slots text and an .ics event', () => {
    const s = store();
    s.book({ clientName: 'Иванов', start: at(12, 11), serviceName: 'Стрижка' });
    const r = s.reminders(at(12, 0));
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain('в 11:00');
    expect(s.slotsText(NOW, 60, 4)).toContain('Свободное время');
    const ics = toICS(s.dayAgenda(at(12, 0))[0]);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Стрижка: Иванов');
  });
});

describe('инструменты и чат', () => {
  it('books through the tool and records income when the client came', async () => {
    const s = store();
    const biz = new BizStore(memory(), () => NOW);
    const tools = createBookingTools(s, () => undefined, biz);
    const book = tools.find(t => t.id === 'biz_book')!;
    const r = await book.execute({ client: 'Иванову', service: 'стрижку', date: '2026-10-09', time: '15:00' });
    expect(r.success).toBe(true);
    expect(describeBookingResult('biz_book', r)).toContain('Иванов, Стрижка, сегодня в 15:00');
    const busy = await book.execute({ client: 'Петрова', service: 'стрижку', date: '2026-10-09', time: '15:00' });
    expect(busy.success).toBe(false);
    expect(busy.error).toContain('Свободно в этот день');
    const done = await tools.find(t => t.id === 'biz_complete_booking')!.execute({ client: 'Иванов' });
    expect(done.success).toBe(true);
    expect(biz.listEntries({ kind: 'income' })[0]).toMatchObject({ amount: 1500, counterparty: 'Иванов' });
  });

  it('understands chat commands', () => {
    const s = store();
    expect(detectBookingIntent('Запиши Иванову на стрижку завтра в 15:00', s)).toEqual({ tool: 'biz_book', args: { client: 'Иванову', service: 'стрижку', date: '2026-10-10', time: '15:00' } });
    expect(detectBookingIntent('запиши Петрову на понедельник', s)).toEqual({ tool: 'biz_free_slots', args: { date: '2026-10-12', service: undefined } });
    expect(detectBookingIntent('Какие свободные окна в понедельник?', s)).toEqual({ tool: 'biz_free_slots', args: { date: '2026-10-12' } });
    expect(detectBookingIntent('что у меня завтра', s)).toEqual({ tool: 'biz_agenda', args: { date: '2026-10-10' } });
    expect(detectBookingIntent('отмени запись Иванова', s)).toEqual({ tool: 'biz_cancel_booking', args: { client: 'Иванова' } });
    expect(detectBookingIntent('Ответ пришёл', s)).toBeNull();
    s.book({ clientName: 'Петров', start: at(9, 11) });
    expect(detectBookingIntent('Петров пришёл', s)).toEqual({ tool: 'biz_complete_booking', args: { client: 'Петров' } });
    expect(detectBookingIntent('Петров не пришёл', s)).toEqual({ tool: 'biz_complete_booking', args: { client: 'Петров', noshow: true } });
  });
});
