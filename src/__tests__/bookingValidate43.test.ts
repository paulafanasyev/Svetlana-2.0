import { describe, it, expect } from 'vitest';
import { BookingStore, addDays, startOfDay, parseWhen, BOOKING_DURATION_RANGE, BOOKING_PRICE_RANGE } from '../services/biz/Booking';

function mem(init?: unknown) {
  const m = new Map<string, string>();
  if (init !== undefined) m.set('svetlana_booking_v1', JSON.stringify(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
const NOW = new Date(2026, 9, 19, 8, 0).getTime(); // понедельник, 8:00
const days = Array.from({ length: 7 }, () => ({ enabled: true, start: '10:00', end: '12:00' }));

describe('Booking: данные с диска проверяются', () => {
  it('нулевой шаг не зацикливает сетку окон', () => {
    const s = new BookingStore(mem({ services: [], schedule: { days, breakStart: '', breakEnd: '', stepMin: 0, bufferMin: -5 }, appointments: [] }), () => NOW);
    expect(s.getSchedule().stepMin).toBe(30);
    expect(s.getSchedule().bufferMin).toBe(0);
    expect(s.freeSlots(NOW, 30).length).toBe(4);
  });

  it('испорченное время дня и перерыв заменяются безопасными', () => {
    const bad = days.map((d, i) => (i === 0 ? { enabled: true, start: '25:00', end: 'x' } : d));
    const s = new BookingStore(mem({ services: [], schedule: { days: bad, breakStart: '15:00', breakEnd: '14:00', stepMin: 30, bufferMin: 0 }, appointments: [] }), () => NOW);
    const sch = s.getSchedule();
    expect(sch.days[0].start).toMatch(/^\d{2}:\d{2}$/);
    expect(sch.breakStart).toBe('');
    expect(() => s.freeSlots(NOW, 30)).not.toThrow();
  });

  it('услуги с неверной длительностью и ценой исправляются, записи с end <= start отбрасываются', () => {
    const s = new BookingStore(mem({
      services: [{ id: 's1', name: 'X', durationMin: -60, price: -100 }],
      schedule: { days, breakStart: '', breakEnd: '', stepMin: 30, bufferMin: 0 },
      appointments: [{ id: 'a1', start: 10, end: 5, status: 'booked', clientName: 'A', serviceName: 'X', price: 0, note: '' }],
    }), () => NOW);
    expect(s.listServices()[0].durationMin).toBe(60);
    expect(s.listServices()[0].price).toBe(0);
    expect(s.listAppointments().length).toBe(0);
  });
});

describe('Booking: длительность и цена при записи', () => {
  const store = () => new BookingStore(mem({ services: [], schedule: { days, breakStart: '', breakEnd: '', stepMin: 30, bufferMin: 0 }, appointments: [] }), () => NOW);
  const start = new Date(2026, 9, 19, 10, 0).getTime();

  it('нулевая и отрицательная длительность отклоняются даже при force', () => {
    expect(() => store().book({ clientName: 'A', start, durationMin: 0, force: true })).toThrow(BOOKING_DURATION_RANGE);
    expect(() => store().book({ clientName: 'A', start, durationMin: -60, force: true })).toThrow(BOOKING_DURATION_RANGE);
  });

  it('отрицательная и бесконечная цена отклоняются', () => {
    expect(() => store().book({ clientName: 'A', start, durationMin: 30, price: -1 })).toThrow(BOOKING_PRICE_RANGE);
    expect(() => store().book({ clientName: 'A', start, durationMin: 30, price: Infinity })).toThrow(BOOKING_PRICE_RANGE);
  });

  it('updateService проверяет поля', () => {
    const s = store();
    const svc = s.addService({ name: 'Стрижка', durationMin: 45, price: 1000 });
    expect(() => s.updateService(svc.id, { durationMin: 0 })).toThrow(BOOKING_DURATION_RANGE);
    expect(() => s.updateService(svc.id, { price: -5 })).toThrow(BOOKING_PRICE_RANGE);
    expect(s.updateService(svc.id, { price: 1200 }).price).toBe(1200);
    expect(s.listServices().find(x => x.id === svc.id)?.durationMin).toBe(45);
  });

  it('updateSchedule отклоняет отрицательную паузу', () => {
    expect(() => store().updateSchedule({ bufferMin: -10 })).toThrow();
  });
});

describe('календарные дни', () => {
  it('addDays даёт следующую дату, а не +24 часа', () => {
    const d = startOfDay(new Date(2026, 9, 25, 15).getTime());
    const next = new Date(addDays(d, 1));
    expect(next.getDate()).toBe(26);
    expect(next.getHours()).toBe(0);
  });
  it('«завтра» — следующий календарный день', () => {
    const r = parseWhen('завтра в 15:00', NOW);
    expect(new Date(r.day as number).getDate()).toBe(20);
    expect(r.minutes).toBe(15 * 60);
  });
});
