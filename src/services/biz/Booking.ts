// Svetlana Business — запись клиентов: услуги, рабочие часы, свободные окна, записи, напоминания. Local-first.
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

function sanitize(raw: any): BookingData {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  const sch = raw.schedule && Array.isArray(raw.schedule.days) && raw.schedule.days.length === 7 ? { ...base.schedule, ...raw.schedule } : base.schedule;
  return {
    version: 1,
    services: Array.isArray(raw.services) ? raw.services.filter((s: any) => s && s.id && s.name) : base.services,
    schedule: sch,
    appointments: Array.isArray(raw.appointments) ? raw.appointments.filter((a: any) => a && a.id && Number.isFinite(a.start) && Number.isFinite(a.end)) : [],
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
    if (rel) { day = today + (rel[1] === 'сегодня' ? 0 : rel[1] === 'завтра' ? 1 : 2) * DAY; cut(/\s(?:на\s+)?(послезавтра|завтра|сегодня)\s/); }
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
        day = today + delta * DAY;
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
  private listeners = new Set<() => void>();

  constructor(storage: KeyValueStorage = defaultStorage(), clock: () => number = Date.now) {
    this.storage = storage;
    this.clock = clock;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      this.data = raw ? sanitize(JSON.parse(raw)) : emptyData();
    } catch {
      this.data = emptyData();
    }
  }

  private commit(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    this.listeners.forEach(l => l());
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
    const durationMin = Math.round(Number(input.durationMin));
    if (!Number.isFinite(durationMin) || durationMin < 5 || durationMin > 720) throw new Error('Длительность: от 5 минут до 12 часов');
    const s: Service = { id: newId('svc'), name, durationMin, price: Math.max(0, Number(input.price) || 0) };
    this.data.services.push(s);
    this.commit();
    return { ...s };
  }
  updateService(id: string, patch: Partial<Omit<Service, 'id'>>): Service {
    const s = this.data.services.find(x => x.id === id);
    if (!s) throw new Error('Услуга не найдена');
    Object.assign(s, patch);
    this.commit();
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
    if (!Number.isFinite(next.stepMin) || next.stepMin < 5) throw new Error('Шаг сетки от 5 минут');
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
    return this.listAppointments({ from, to: from + DAY }).filter(a => a.status !== 'cancelled');
  }
  isFree(start: number, end: number, excludeId?: string): boolean {
    const buf = this.data.schedule.bufferMin * MIN;
    return !this.data.appointments.some(a => a.id !== excludeId && a.status === 'booked' && start < a.end + buf && end + buf > a.start);
  }
  /** Свободные окна дня для услуги длительностью durationMin. */
  freeSlots(day: number, durationMin: number): number[] {
    const hours = this.workingHours(day);
    if (!hours) return [];
    const { stepMin, breakStart, breakEnd } = this.data.schedule;
    const bs = breakStart && breakEnd ? toMinutes(breakStart) : -1;
    const be = breakStart && breakEnd ? toMinutes(breakEnd) : -1;
    const now = this.clock();
    const out: number[] = [];
    for (let m = hours.start; m + durationMin <= hours.end; m += stepMin) {
      if (bs >= 0 && m < be && m + durationMin > bs) continue;
      const start = at(day, m);
      if (start < now) continue;
      if (this.isFree(start, start + durationMin * MIN)) out.push(start);
    }
    return out;
  }
  /** Ближайшие свободные окна начиная с дня `from` на `days` дней вперёд. */
  nextFreeSlots(from: number, durationMin: number, days = 7, perDay = 99): { day: number; slots: number[] }[] {
    const out: { day: number; slots: number[] }[] = [];
    for (let i = 0; i < days; i++) {
      const day = startOfDay(from) + i * DAY + 12 * 3_600_000; // полдень: устойчиво к переводу часов
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
    const durationMin = Math.round(input.durationMin ?? svc?.durationMin ?? 60);
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
      price: input.price ?? svc?.price ?? 0, clientName, contactId: input.contactId, phone: input.phone, note: input.note?.trim() ?? '',
      status: 'booked', createdAt: t, updatedAt: t,
    };
    this.data.appointments.push(a);
    this.commit();
    return { ...a };
  }
  reschedule(id: string, start: number, force = false): Appointment {
    const a = this.data.appointments.find(x => x.id === id);
    if (!a) throw new Error('Запись не найдена');
    const dur = a.end - a.start;
    if (!force && !this.isFree(start, start + dur, id)) throw new Error('Новое время занято');
    a.start = start; a.end = start + dur; a.status = 'booked'; a.updatedAt = this.clock();
    this.commit();
    return { ...a };
  }
  setStatus(id: string, status: BookingStatus, incomeEntryId?: string): Appointment {
    const a = this.data.appointments.find(x => x.id === id);
    if (!a) throw new Error('Запись не найдена');
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
export function toICS(a: Appointment): string {
  const f = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Svetlana//Booking//RU', 'BEGIN:VEVENT', `UID:${a.id}@svetlana`, `DTSTAMP:${f(a.createdAt)}`,
    `DTSTART:${f(a.start)}`, `DTEND:${f(a.end)}`, `SUMMARY:${esc(`${a.serviceName}: ${a.clientName}`)}`,
    `DESCRIPTION:${esc([a.phone, a.note].filter(Boolean).join('\n'))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Запись через час', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export const bookingStore = new BookingStore();
