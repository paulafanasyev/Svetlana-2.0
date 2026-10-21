// Svetlana Business — запись клиентов: услуги, рабочие часы, свободные окна, записи, напоминания. Local-first.
// Сохранение «всё или ничего»: если записать на диск не удалось, изменение отменяется и в памяти
// (иначе запись «есть» до перезапуска и молча пропадает после него).
// Статус меняется только по правилам (canSetStatus): состоявшийся визит с доходом не отменить и не перенести,
// отменённый не «завершить»: иначе книга доходов и записи описывают разное.
// Данные с диска и от ИИ проверяются: шаг сетки, время ЧЧ:ММ, длительность 5–720 минут, цена не отрицательная
// (иначе нулевой шаг вешал страницу, а запись с отрицательной длительностью ломала сетку и выручку).
import { safeJsonParse, stripControl, MAX_BYTES } from '../security/SafeData';
import type { KeyValueStorage } from '../crm/CRMStore';

export type BookingStatus = 'booked' | 'done' | 'cancelled' | 'noshow';

export interface Service { id: string; name: string; durationMin: number; price: number }
export interface WorkDay { enabled: boolean; start: string; end: string } // 'HH:MM'
export interface Schedule {
  days: WorkDay[];      // 0 = понедельник … 6 = воскресенье
  breakStart: string;   // '' = без перерыва
  breakEnd: string;
  stepMin: number;      // шаг сетки окон
  bufferMin: number;    // пауза между клиентами
}
export interface Appointment {
  id: string;
  start: number;
  end: number;
  serviceId?: string;
  serviceName: string;
  price: number;
  clientName: string;
  contactId?: string;
  phone?: string;
  note: string;
  status: BookingStatus;
  incomeEntryId?: string;
  createdAt: number;
  updatedAt: number;
}
interface BookingData { version: 1; services: Service[]; schedule: Schedule; appointments: Appointment[] }

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = { booked: 'Записан', done: 'Пришёл', cancelled: 'Отменена', noshow: 'Не пришёл' };
export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const BOOKING_SAVE_FAILED = 'Не удалось сохранить запись: память устройства переполнена или недоступна. Изменение отменено.';
export const BOOKING_DONE_LOCKED = 'Визит уже отмечен как состоявшийся, доход записан: отменить или перенести его нельзя. Если деньги вернули, запишите возврат в финансах.';
export const BOOKING_CANCELLED_LOCKED = 'Запись отменена. Чтобы вернуть клиента, запишите его заново или перенесите запись на другое время.';
export const BOOKING_DURATION_RANGE = 'Длительность: от 5 минут до 12 часов';
export const BOOKING_PRICE_RANGE = 'Цена должна быть числом не меньше нуля';

/** Куда можно перейти из каждого статуса. «Не пришёл» → «Пришёл»: клиент опоздал, а отметили рано. */
const NEXT_STATUS: Record<BookingStatus, readonly BookingStatus[]> = {
  booked: ['done', 'cancelled', 'noshow'],
  noshow: ['done', 'cancelled'],
  cancelled: [],
  done: [],
};
export function canSetStatus(from: BookingStatus, to: BookingStatus): boolean {
  return NEXT_STATUS[from]?.includes(to) ?? false;
}
/** Понятная причина, почему статус не меняется. */
export function statusChangeError(from: BookingStatus, to: BookingStatus): string {
  if (from === 'done') return BOOKING_DONE_LOCKED;
  if (from === 'cancelled') return to === 'cancelled' ? 'Запись уже отменена.' : BOOKING_CANCELLED_LOCKED;
  if (from === to) return `Запись уже в статусе «${BOOKING_STATUS_LABELS[to]}».`;
  return `Нельзя сменить статус «${BOOKING_STATUS_LABELS[from]}» на «${BOOKING_STATUS_LABELS[to]}».`;
}

const STORAGE_KEY = 'svetlana_booking_v1';
const MIN = 60_000;
const DAY = 86_400_000;

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}
function defaultStorage(): KeyValueStorage {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* privacy mode */ }
  return memoryStorage();
}
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSchedule(): Schedule {
  const work = { enabled: true, start: '10:00', end: '19:00' };
  return {
    days: [work, work, work, work, work, { enabled: false, start: '11:00', end: '16:00' }, { enabled: false, start: '11:00', end: '16:00' }].map(d => ({ ...d })),
    breakStart: '14:00', breakEnd: '15:00', stepMin: 30, bufferMin: 0,
  };
}

function emptyData(): BookingData {
  return { version: 1, services: [{ id: newId('svc'), name: 'Консультация', durationMin: 60, price: 0 }], schedule: defaultSchedule(), appointments: [] };
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export function toMinutes(hhmm: string): number {
  const m = hhmm.trim().match(HHMM);
  if (!m) throw new Error(`Время «${hhmm}» не в формате ЧЧ:ММ`);
  return Number(m[1]) * 60 + Number(m[2]);
}
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
/** Начало дня через n календарных дней (перевод часов не сдвигает дату). */
export function addDays(t: number, n: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}
export function weekdayIndex(t: number): number {
  return (new Date(t).getDay() + 6) % 7;
}
export function timeOf(t: number): string {
  const d = new Date(t);
  return hhmm(d.getHours() * 60 + d.getMinutes());
}
export function dayLabel(t: number, now: number): string {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === 2) return 'послезавтра';
  return new Date(t).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}
function at(day: number, minutes: number): number {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
}

/** Длительность в минутах (5–720) или null. */
export function validDuration(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 5 && n <= 720 ? n : null;
}
/** Цена: конечное число от 0, до копеек; иначе null. */
export function validPrice(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? Math.round(n * 100) / 100 : null;
}
function validTime(v: unknown): string | null {
  return typeof v === 'string' && HHMM.test(v.trim()) ? v.trim() : null;
}
function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function sanitizeSchedule(raw: any, base: Schedule): Schedule {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days) || raw.days.length !== 7) return base;
  const days = raw.days.map((d: any, i: number) => {
    const def = base.days[i];
    const start = validTime(d?.start) ?? def.start;
    const end = validTime(d?.end) ?? def.end;
    const ok = toMinutes(end) > toMinutes(start);
    return { enabled: d?.enabled === true && ok, start: ok ? start : def.start, end: ok ? end : def.end };
  });
  let breakStart = validTime(raw.breakStart) ?? '';
  let breakEnd = validTime(raw.breakEnd) ?? '';
  if (!breakStart || !breakEnd || toMinutes(breakEnd) <= toMinutes(breakStart)) { breakStart = ''; breakEnd = ''; }
  return { days, breakStart, breakEnd, stepMin: intIn(raw.stepMin, 5, 240, base.stepMin), bufferMin: intIn(raw.bufferMin, 0, 240, base.bufferMin) };
}

function sanitize(raw: any): BookingData {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  const services = Array.isArray(raw.services)
    ? raw.services
      .filter((s: any) => s && typeof s.id === 'string' && typeof s.name === 'string' && s.name.trim())
      .map((s: any) => ({ id: s.id, name: s.name, durationMin: validDuration(s.durationMin) ?? 60, price: validPrice(s.price) ?? 0 }))
    : base.services;
  return {
    version: 1,
    services,
    schedule: sanitizeSchedule(raw.schedule, base.schedule),
    appointments: Array.isArray(raw.appointments)
      ? raw.appointments
        .filter((a: any) => a && a.id && Number.isFinite(a.start) && Number.isFinite(a.end) && a.end > a.start)
        .map((a: any) => ({ ...a, price: validPrice(a.price) ?? 0 }))
      : [],
  };
}

// ---------- русские даты: «завтра в 15:00», «в пятницу в 10», «12.10 в 9:30», «15 октября в 7 вечера» ----------
const WEEKDAY_RE: [RegExp, number][] = [
  [/понедельник/, 0], [/вторник/, 1], [/сред[ау]/, 2], [/четверг/, 3], [/пятниц[ау]/, 4], [/суббот[ау]/, 5], [/воскресень[ея]/, 6],
];
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTH_RE = /(\d{1,2})\s+(январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])/;

export interface ParsedWhen { day?: number; minutes?: number; rest: string }

export function parseWhen(text: string, now: number): ParsedWhen {
  let s = ` ${text.toLowerCase().replace(/ё/g, 'е')} `;
  let day: number | undefined;
  const today = startOfDay(now);
  const cut = (re: RegExp) => { s = s.replace(re, ' '); };

  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { day = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime(); cut(/(?:на\s+)?\d{4}-\d{2}-\d{2}/); }
  if (day === undefined) {
    const rel = s.match(/\s(?:на\s+)?(послезавтра|завтра|сегодня)\s/);
    if (rel) { day = addDays(today, rel[1] === 'сегодня' ? 0 : rel[1] === 'завтра' ? 1 : 2); cut(/\s(?:на\s+)?(послезавтра|завтра|сегодня)\s/); }
  }
  if (day === undefined) {
    const dm = s.match(/\s(?:на\s+)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/);
    if (dm) {
      const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : new Date(now).getFullYear();
      let t = new Date(y, Number(dm[2]) - 1, Number(dm[1])).getTime();
      if (!dm[3] && t < today) t = new Date(y + 1, Number(dm[2]) - 1, Number(dm[1])).getTime();
      day = t;
      cut(/\s(?:на\s+)?\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?=\s)/);
    }
  }
  if (day === undefined) {
    const mm = s.match(MONTH_RE);
    if (mm) {
      const month = MONTHS.findIndex(p => mm[2].startsWith(p));
      const y = new Date(now).getFullYear();
      let t = new Date(y, month, Number(mm[1])).getTime();
      if (t < today) t = new Date(y + 1, month, Number(mm[1])).getTime();
      day = t;
      cut(new RegExp(String.raw`(?:на\s+)?${MONTH_RE.source}`));
    }
  }
  if (day === undefined) {
    for (const [re, idx] of WEEKDAY_RE) {
      const m = s.match(new RegExp(String.raw`\s(?:в|во|на)?\s*(?:следующ\S*\s+)?(${re.source})\s`));
      if (m) {
        const delta = ((idx - weekdayIndex(now) + 7) % 7) || 7;
        day = addDays(today, delta);
        s = s.replace(m[0], ' ');
        break;
      }
    }
  }
  let minutes: number | undefined;
  const tm = s.match(/\s(?:в|на|к|с)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:час\S*|ч\.?))?(?:\s+(утра|дня|вечера|ночи))?(?=\s)/)
    ?? s.match(/\s(\d{1,2})[:](\d{2})(?:\s+(утра|дня|вечера|ночи))?(?=\s)/);
  if (tm) {
    let h = Number(tm[1]);
    const m = Number(tm[2] ?? 0);
    const part = tm[3];
    if ((part === 'дня' || part === 'вечера') && h < 12) h += 12;
    if (h <= 23 && m <= 59) { minutes = h * 60 + m; s = s.replace(tm[0], ' '); }
  }
  return { day, minutes, rest: s.replace(/\s+/g, ' ').trim() };
}

/** «Иванову» → «Иванов», «Петровой» → «Петрова» (дательный/творительный падеж фамилий). */
export function normalizeClientName(name: string): string {
  return name.trim().split(/\s+/).map(w => {
    const rules: [RegExp, string][] = [[/(ов|ев|ин)у$/i, '$1'], [/(ов|ев|ин)ой$/i, '$1а'], [/(ов|ев|ин)ым$/i, '$1']];
    for (const [re, to] of rules) if (re.test(w)) return w.replace(re, to);
    return w;
  }).join(' ');
}

export class BookingStore {
  private readonly storage: KeyValueStorage;
  private readonly clock: () => number;
  private data: BookingData;
  /** Последнее успешно сохранённое состояние: к нему откатываемся, если запись на диск не удалась. */
  private saved: string;
  private listeners = new Set<() => void>();

  constructor(storage: KeyValueStorage = defaultStorage(), clock: () => number = Date.now) {
    this.storage = storage;
    this.clock = clock;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      this.data = raw ? sanitize(safeJsonParse(raw, MAX_BYTES.storage)) : emptyData();
    } catch {
      this.data = emptyData();
    }
    this.saved = JSON.stringify(this.data);
  }

  private commit(): void {
    const next = JSON.stringify(this.data);
    try {
      this.storage.setItem(STORAGE_KEY, next);
    } catch {
      try { this.data = sanitize(JSON.parse(this.saved)); } catch { this.data = emptyData(); }
      throw new Error(BOOKING_SAVE_FAILED);
    }
    this.saved = next;
    for (const l of [...this.listeners]) {
      try { l(); } catch { /* ошибка подписчика не отменяет сохранение */ }
    }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  now(): number { return this.clock(); }

  // ---------- услуги ----------
  listServices(): Service[] { return this.data.services.map(s => ({ ...s })); }
  addService(input: { name: string; durationMin: number; price?: number }): Service {
    const name = input.name.trim();
    if (!name) throw new Error('Название услуги пустое');
    const durationMin = validDuration(input.durationMin);
    if (durationMin === null) throw new Error(BOOKING_DURATION_RANGE);
    const price = input.price === undefined ? 0 : validPrice(input.price);
    if (price === null) throw new Error(BOOKING_PRICE_RANGE);
    const s: Service = { id: newId('svc'), name, durationMin, price };
    this.data.services.push(s);
    this.commit();
    return { ...s };
  }
  updateService(id: string, patch: Partial<Omit<Service, 'id'>>): Service {
    const s = this.data.services.find(x => x.id === id);
    if (!s) throw new Error('Услуга найдена не была');
    const next: Service = { ...s };
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw new Error('Название услуги пустое');
      next.name = name;
    }
    if (patch.durationMin !== undefined) {
      const d = validDuration(patch.durationMin);
      if (d === null) throw new Error(BOOKING_DURATION_RANGE);
      next.durationMin = d;
    }
    if (patch.price !== undefined) {
      const p = validPrice(patch.price);
      if (p === null) throw new Error(BOOKING_PRICE_RANGE);
      next.price = p;
    }
    const prev = { ...s };
    Object.assign(s, next);
    try { this.commit(); } catch (e) { Object.assign(s, prev); throw e; }
    return { ...s };
  }
  deleteService(id: string): void {
    this.data.services = this.data.services.filter(s => s.id !== id);
    this.commit();
  }
  /** «стрижку», «на маникюр» → услуга «Стрижка», «Маникюр». */
  findService(query: string | undefined): Service | undefined {
    if (!query?.trim()) return undefined;
    const q = query.toLowerCase().replace(/ё/g, 'е').trim();
    const list = this.data.services;
    const exact = list.find(s => s.name.toLowerCase() === q);
    if (exact) return { ...exact };
    const stems = q.split(/\s+/).filter(w => w.length >= 3).map(w => (w.length > 4 ? w.slice(0, -1) : w));
    const hit = stems.length ? list.find(s => stems.every(st => s.name.toLowerCase().replace(/ё/g, 'е').includes(st))) : undefined;
    return hit ? { ...hit } : undefined;
  }

  // ---------- расписание ----------
  getSchedule(): Schedule { return { ...this.data.schedule, days: this.data.schedule.days.map(d => ({ ...d })) }; }
  updateSchedule(patch: Partial<Schedule>): Schedule {
    const next = { ...this.data.schedule, ...patch, days: (patch.days ?? this.data.schedule.days).map(d => ({ ...d })) };
    if (next.days.length !== 7) throw new Error('Нужно 7 дней недели');
    next.days.forEach(d => { if (d.enabled && toMinutes(d.end) <= toMinutes(d.start)) throw new Error('Конец рабочего дня раньше начала'); });
    if (next.breakStart && next.breakEnd && toMinutes(next.breakEnd) <= toMinutes(next.breakStart)) throw new Error('Перерыв задан неверно');
    if (!Number.isFinite(next.stepMin) || next.stepMin < 5 || next.stepMin > 240) throw new Error('Шаг сетки от 5 до 240 минут');
    if (!Number.isFinite(next.bufferMin) || next.bufferMin < 0 || next.bufferMin > 240) throw new Error('Пауза между клиентами от 0 до 240 минут');
    next.stepMin = Math.round(next.stepMin);
    next.bufferMin = Math.round(next.bufferMin);
    this.data.schedule = next;
    this.commit();
    return this.getSchedule();
  }
  workingHours(day: number): { start: number; end: number } | null {
    const wd = this.data.schedule.days[weekdayIndex(day)];
    return wd?.enabled ? { start: toMinutes(wd.start), end: toMinutes(wd.end) } : null;
  }

  // ---------- записи ----------
  getAppointment(id: string): Appointment | undefined {
    const a = this.data.appointments.find(x => x.id === id);
    return a ? { ...a } : undefined;
  }
  listAppointments(filter: { from?: number; to?: number; status?: BookingStatus; contactId?: string; client?: string } = {}): Appointment[] {
    const q = filter.client?.toLowerCase().trim();
    return this.data.appointments
      .filter(a => filter.from === undefined || a.end > filter.from)
      .filter(a => filter.to === undefined || a.start < filter.to)
      .filter(a => !filter.status || a.status === filter.status)
      .filter(a => !filter.contactId || a.contactId === filter.contactId)
      .filter(a => !q || a.clientName.toLowerCase().includes(q))
      .sort((a, b) => a.start - b.start)
      .map(a => ({ ...a }));
  }
  dayAgenda(day: number): Appointment[] {
    const from = startOfDay(day);
    return this.listAppointments({ from, to: addDays(from, 1) }).filter(a => a.status !== 'cancelled');
  }
  isFree(start: number, end: number, excludeId?: string): boolean {
    const buf = this.data.schedule.bufferMin * MIN;
    return !this.data.appointments.some(a => a.id !== excludeId && a.status === 'booked' && start < a.end + buf && end + buf > a.start);
  }
  /** Свободные окна дня для услуги длительностью durationMin. */
  freeSlots(day: number, durationMin: number): number[] {
    const hours = this.workingHours(day);
    const dur = validDuration(durationMin);
    if (!hours || dur === null) return [];
    const { breakStart, breakEnd } = this.data.schedule;
    // Шаг всегда не меньше 5 минут: нулевой или испорченный шаг не должен зациклить страницу.
    const stepMin = intIn(this.data.schedule.stepMin, 5, 240, 30);
    const bs = breakStart && breakEnd ? toMinutes(breakStart) : -1;
    const be = breakStart && breakEnd ? toMinutes(breakEnd) : -1;
    const now = this.clock();
    const out: number[] = [];
    for (let m = hours.start; m + dur <= hours.end; m += stepMin) {
      if (bs >= 0 && m < be && m + dur > bs) continue;
      const start = at(day, m);
      if (start < now) continue;
      if (this.isFree(start, start + dur * MIN)) out.push(start);
    }
    return out;
  }
  /** Ближайшие свободные окна начиная с дня `from` на `days` дней вперёд. */
  nextFreeSlots(from: number, durationMin: number, days = 7, perDay = 99): { day: number; slots: number[] }[] {
    const out: { day: number; slots: number[] }[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(startOfDay(from), i) + 12 * 3_600_000; // полдень: устойчиво к переводу часов
      const slots = this.freeSlots(day, durationMin).slice(0, perDay);
      if (slots.length) out.push({ day: startOfDay(day), slots });
    }
    return out;
  }

  book(input: { clientName: string; start: number; serviceId?: string; serviceName?: string; durationMin?: number; price?: number; contactId?: string; phone?: string; note?: string; force?: boolean }): Appointment {
    const clientName = input.clientName.trim();
    if (!clientName) throw new Error('Укажите клиента');
    if (!Number.isFinite(input.start)) throw new Error('Не понятна дата и время записи');
    const svc = input.serviceId ? this.data.services.find(s => s.id === input.serviceId) : this.findService(input.serviceName);
    // Длительность и цена проверяются и при «принудительной» записи: иначе конец раньше начала и отрицательная выручка.
    const durationMin = validDuration(input.durationMin ?? svc?.durationMin ?? 60);
    if (durationMin === null) throw new Error(BOOKING_DURATION_RANGE);
    const price = validPrice(input.price ?? svc?.price ?? 0);
    if (price === null) throw new Error(BOOKING_PRICE_RANGE);
    const end = input.start + durationMin * MIN;
    if (!input.force) {
      if (input.start < this.clock() - 5 * MIN) throw new Error('Это время уже прошло');
      const hours = this.workingHours(input.start);
      const sm = new Date(input.start).getHours() * 60 + new Date(input.start).getMinutes();
      if (!hours) throw new Error(`${WEEKDAY_LABELS[weekdayIndex(input.start)]} — выходной. Можно записать принудительно.`);
      if (sm < hours.start || sm + durationMin > hours.end) throw new Error(`Вне рабочих часов (${hhmm(hours.start)}–${hhmm(hours.end)})`);
      if (!this.isFree(input.start, end)) {
        const busy = this.data.appointments.find(a => a.status === 'booked' && input.start < a.end && end > a.start);
        throw new Error(`Это время занято${busy ? `: ${busy.clientName}, ${timeOf(busy.start)}–${timeOf(busy.end)}` : ''}`);
      }
    }
    const t = this.clock();
    const a: Appointment = {
      id: newId('apt'), start: input.start, end, serviceId: svc?.id, serviceName: svc?.name ?? (input.serviceName?.trim() || 'Приём'),
      price, clientName, contactId: input.contactId, phone: input.phone, note: input.note?.trim() ?? '',
      status: 'booked', createdAt: t, updatedAt: t,
    };
    this.data.appointments.push(a);
    this.commit();
    return { ...a };
  }
  /** Перенос на другое время (отменённая и «не пришёл» снова становятся записью). Состоявшийся визит не переносится. */
  reschedule(id: string, start: number, force = false): Appointment {
    const a = this.data.appointments.find(x => x.id === id);
    if (!a) throw new Error('Запись не найдена');
    if (a.status === 'done') throw new Error(BOOKING_DONE_LOCKED);
    if (!Number.isFinite(start)) throw new Error('Не понятна дата и время записи');
    const dur = a.end - a.start;
    if (!force && !this.isFree(start, start + dur, id)) throw new Error('Новое время занято');
    a.start = start; a.end = start + dur; a.status = 'booked'; a.updatedAt = this.clock();
    this.commit();
    return { ...a };
  }
  setStatus(id: string, status: BookingStatus, incomeEntryId?: string): Appointment {
    const a = this.data.appointments.find(x => x.id === id);
    if (!a) throw new Error('Запись не найдена');
    if (!canSetStatus(a.status, status)) throw new Error(statusChangeError(a.status, status));
    a.status = status; a.updatedAt = this.clock();
    if (incomeEntryId) a.incomeEntryId = incomeEntryId;
    this.commit();
    return { ...a };
  }
  deleteAppointment(id: string): void {
    this.data.appointments = this.data.appointments.filter(a => a.id !== id);
    this.commit();
  }
  /** Ближайшая будущая (или сегодняшняя) запись клиента. */
  findUpcoming(client: string): Appointment | undefined {
    const q = normalizeClientName(client).toLowerCase();
    const from = startOfDay(this.clock());
    return this.listAppointments({ from, status: 'booked' }).find(a => a.clientName.toLowerCase().includes(q) || q.includes(a.clientName.toLowerCase()));
  }

  // ---------- тексты ----------
  reminderText(a: Appointment, businessName = ''): string {
    return `Здравствуйте, ${a.clientName}! Напоминаю: вы записаны ${dayLabel(a.start, this.clock())} в ${timeOf(a.start)} — ${a.serviceName}.`
      + ' Если планы изменились, пожалуйста, предупредите заранее.' + (businessName ? `\n${businessName}` : '');
  }
  /** Напоминания на завтра (или на указанный день). */
  reminders(day: number = this.clock() + DAY): { appointment: Appointment; text: string }[] {
    return this.dayAgenda(day).filter(a => a.status === 'booked').map(a => ({ appointment: a, text: this.reminderText(a) }));
  }
  /** Текст со свободными окнами, чтобы отправить клиенту. */
  slotsText(from: number, durationMin: number, days = 7): string {
    const list = this.nextFreeSlots(from, durationMin, days, 6);
    if (!list.length) return 'Свободных окон в ближайшие дни нет.';
    return 'Свободное время для записи:\n' + list.map(d => `• ${dayLabel(d.day + 12 * 3_600_000, this.clock())}: ${d.slots.map(timeOf).join(', ')}`).join('\n');
  }
  stats(from: number, to: number): { booked: number; done: number; noshow: number; cancelled: number; revenue: number } {
    const list = this.listAppointments({ from, to });
    return {
      booked: list.filter(a => a.status === 'booked').length,
      done: list.filter(a => a.status === 'done').length,
      noshow: list.filter(a => a.status === 'noshow').length,
      cancelled: list.filter(a => a.status === 'cancelled').length,
      revenue: list.filter(a => a.status === 'done').reduce((s, a) => s + a.price, 0),
    };
  }
}

/** iCalendar-событие, чтобы добавить запись в календарь телефона. */
/** Свёртка строки iCalendar по 75 октетов UTF-8 (RFC 5545, 3.1). */
function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function toICS(a: Appointment): string {
  const f = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // Экранирование RFC 5545: \\ ; , и переводы строк (CR и LF); прочие управляющие символы удаляются.
  const esc = (s: string) => stripControl(s).replace(/[\\;,]/g, m => `\\${m}`).replace(/\r\n|\r|\n/g, '\\n');
  const uid = String(a.id).replace(/[^A-Za-z0-9_-]/g, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Svetlana//Booking//RU', 'BEGIN:VEVENT', `UID:${uid}@svetlana`, `DTSTAMP:${f(a.createdAt)}`,
    `DTSTART:${f(a.start)}`, `DTEND:${f(a.end)}`, `SUMMARY:${esc(`${a.serviceName}: ${a.clientName}`)}`,
    `DESCRIPTION:${esc([a.phone, a.note].filter(Boolean).join('\n'))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Запись через час', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].map(foldIcsLine).join('\r\n');
}

export const bookingStore = new BookingStore();
