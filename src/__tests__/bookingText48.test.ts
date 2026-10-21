// Понятный текст ошибки: услуги нет — «Услуга не найдена».
import { describe, it, expect } from 'vitest';
import { BookingStore, BOOKING_SERVICE_NOT_FOUND } from '../services/biz/Booking';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('booking service errors', () => {
  it('a missing service is reported plainly', () => {
    const store = new BookingStore(mem(), () => 0);
    expect(BOOKING_SERVICE_NOT_FOUND).toBe('Услуга не найдена');
    expect(() => store.updateService('nope', { price: 100 })).toThrow('Услуга не найдена');
  });
});
