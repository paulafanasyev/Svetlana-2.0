// Svetlana Business — инструменты записи клиентов для ИИ и офлайн-команды чата.
import type { Tool, ToolResult } from '../ToolRegistry';
import type { CRMContact } from '../crm/CRMStore';
import { crmStore } from '../crm/CRMStore';
import { bizStore, BizStore, formatRub } from './BizStore';
import { bookingStore, BookingStore, parseWhen, normalizeClientName, startOfDay, timeOf, dayLabel, BOOKING_STATUS_LABELS, type Appointment } from './Booking';

type Resolve = (name: string | undefined) => CRMContact | undefined;

function ok(data: unknown): ToolResult { return { success: true, data }; }
function fail(error: string): ToolResult { return { success: false, error }; }

const DAY = 86_400_000;

function resolveDay(value: unknown, now: number): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return parseWhen(value, now).day;
}

function resolveStart(p: Record<string, any>, now: number): number {
  const when = parseWhen(`${p.date ?? ''} ${p.time ? `в ${p.time}` : ''}`, now);
  if (when.day === undefined) throw new Error('Не понятна дата. Скажите, например: «завтра», «в пятницу», «12.10».');
  if (when.minutes === undefined) throw new Error('Не понятно время. Скажите, например: «в 15:00».');
  const d = new Date(when.day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(when.minutes / 60), when.minutes % 60).getTime();
}

function brief(a: Appointment, now: number): Record<string, unknown> {
  return { id: a.id, client: a.clientName, service: a.serviceName, day: dayLabel(a.start, now), time: timeOf(a.start), end: timeOf(a.end), price: a.price, status: a.status };
}

export function createBookingTools(store: BookingStore = bookingStore, resolve: Resolve = () => undefined, biz: BizStore = bizStore): Tool[] {
  const always = async () => true;
  const findAppt = (p: Record<string, any>): Appointment | undefined =>
    (p.id ? store.getAppointment(p.id) : undefined) ?? (p.client ? store.findUpcoming(resolve(p.client)?.name ?? String(p.client)) : undefined);
  return [
    {
      id: 'biz_book', name: 'Booking: book a client', category: 'data', riskLevel: 'low',
      description: 'Book a client for a service at a date/time. Checks working hours and conflicts.',
      inputSchema: { type: 'object', properties: {
        client: { type: 'string', description: 'Client name' },
        service: { type: 'string', description: 'Service name' },
        date: { type: 'string', description: 'YYYY-MM-DD or «завтра», «в пятницу», «12.10»' },
        time: { type: 'string', description: 'HH:MM' },
        durationMin: { type: 'number', description: 'Duration, default from service' },
        note: { type: 'string', description: 'Comment' },
      }, required: ['client', 'date', 'time'] },
      async execute(p) {
        try {
          const now = store.now();
          const start = resolveStart(p, now);
          const contact = resolve(p.client) ?? resolve(normalizeClientName(String(p.client)));
          const name = contact?.name ?? normalizeClientName(String(p.client));
          try {
            const a = store.book({ clientName: name, start, serviceName: p.service, durationMin: p.durationMin, contactId: contact?.id, phone: contact?.phones[0], note: p.note });
            if (contact) crmStore.addActivity({ type: 'meeting', text: `Запись: ${a.serviceName}, ${dayLabel(a.start, now)} в ${timeOf(a.start)}`, contactId: contact.id });
            return ok({ ...brief(a, now), linked: !!contact });
          } catch (e: any) {
            const svc = store.findService(p.service);
            const slots = store.freeSlots(start, p.durationMin ?? svc?.durationMin ?? 60).slice(0, 6).map(timeOf);
            return fail(`${e?.message || 'Не получилось записать'}${slots.length ? `. Свободно в этот день: ${slots.join(', ')}` : ''}`);
          }
        } catch (e: any) { return fail(e?.message || 'Не получилось записать'); }
      },
      isAvailable: always,
    },
    {
      id: 'biz_free_slots', name: 'Booking: free slots', category: 'data', riskLevel: 'low',
      description: 'Free time slots for a day (or the next 7 days) and a ready text to send to a client.',
      inputSchema: { type: 'object', properties: {
        date: { type: 'string', description: 'Day, optional' },
        service: { type: 'string', description: 'Service (for duration)' },
      } },
      async execute(p) {
        const now = store.now();
        const svc = store.findService(p.service);
        const dur = svc?.durationMin ?? store.listServices()[0]?.durationMin ?? 60;
        const day = resolveDay(p.date, now);
        if (day !== undefined) {
          const slots = store.freeSlots(day + 12 * 3_600_000, dur);
          return ok({ day: dayLabel(day, now), service: svc?.name, slots: slots.map(timeOf), text: slots.length ? `Свободно ${dayLabel(day, now)}: ${slots.map(timeOf).join(', ')}` : `${dayLabel(day, now)} свободных окон нет.` });
        }
        return ok({ service: svc?.name, text: store.slotsText(now, dur, 7) });
      },
      isAvailable: always,
    },
    {
      id: 'biz_agenda', name: 'Booking: agenda', category: 'data', riskLevel: 'low',
      description: 'Bookings for a day (default today).',
      inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'Day, default today' } } },
      async execute(p) {
        const now = store.now();
        const day = resolveDay(p.date, now) ?? startOfDay(now);
        return ok({ day: dayLabel(day, now), items: store.dayAgenda(day).map(a => brief(a, now)) });
      },
      isAvailable: always,
    },
    {
      id: 'biz_cancel_booking', name: 'Booking: cancel', category: 'data', riskLevel: 'low',
      description: 'Cancel the nearest upcoming booking of a client.',
      inputSchema: { type: 'object', properties: { client: { type: 'string', description: 'Client name' }, id: { type: 'string', description: 'Booking id' } } },
      async execute(p) {
        const a = findAppt(p);
        if (!a) return fail(`Не нашла предстоящую запись: ${p.client ?? p.id}`);
        return ok(brief(store.setStatus(a.id, 'cancelled'), store.now()));
      },
      isAvailable: always,
    },
    {
      id: 'biz_complete_booking', name: 'Booking: client came and paid', category: 'data', riskLevel: 'low',
      description: 'Mark a booking as done; by default records the income in the business ledger.',
      inputSchema: { type: 'object', properties: {
        client: { type: 'string', description: 'Client name' }, id: { type: 'string', description: 'Booking id' },
        amount: { type: 'number', description: 'Paid amount, default service price' },
        noshow: { type: 'boolean', description: 'true = client did not come' },
      } },
      async execute(p) {
        const a = findAppt(p);
        if (!a) return fail(`Не нашла запись: ${p.client ?? p.id}`);
        if (p.noshow) return ok(brief(store.setStatus(a.id, 'noshow'), store.now()));
        const amount = Number(p.amount ?? a.price);
        let entryId: string | undefined;
        if (amount > 0) {
          const e = biz.addEntry({ kind: 'income', amount, description: a.serviceName, counterparty: a.clientName, contactId: a.contactId, payerType: 'person', date: Math.min(store.now(), a.end) });
          entryId = e.id;
        }
        return ok({ ...brief(store.setStatus(a.id, 'done', entryId), store.now()), income: amount > 0 ? amount : 0 });
      },
      isAvailable: always,
    },
    {
      id: 'biz_booking_reminders', name: 'Booking: reminders', category: 'data', riskLevel: 'low',
      description: 'Ready reminder texts for clients booked tomorrow.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const r = store.reminders(store.now() + DAY);
        return ok({ items: r.map(x => ({ client: x.appointment.clientName, phone: x.appointment.phone, text: x.text })) });
      },
      isAvailable: always,
    },
  ];
}

export interface BookingAction { tool: string; args: Record<string, any> }

/** «запиши Иванову на стрижку завтра в 15:00», «свободные окна в пятницу», «что у меня завтра», «отмени запись Петрова», «Петров пришёл». */
export function detectBookingIntent(text: string, store: BookingStore = bookingStore): BookingAction | null {
  const now = store.now();
  const low = text.toLowerCase().replace(/ё/g, 'е').trim().replace(/[.!?]+$/, '');
  const book = low.match(/^(?:запиши|записать|запишите|запись)\s+(.+)$/);
  if (book) {
    const when = parseWhen(book[1], now);
    if (when.day !== undefined || when.minutes !== undefined) {
      const rest = text.trim().replace(/[.!?]+$/, '');
      const orig = parseWhen(rest.replace(/^\S+\s+/, ''), now).rest; // lowercase rest without date/time
      const [clientPart, ...svc] = orig.split(/\s+на\s+/);
      const client = restoreCase(text, clientPart.replace(/\s+на$/, '').trim());
      const service = svc.join(' на ').trim();
      if (client && when.day !== undefined && when.minutes !== undefined) {
        return { tool: 'biz_book', args: { client, service: service || undefined, date: isoDay(when.day), time: `${String(Math.floor(when.minutes / 60)).padStart(2, '0')}:${String(when.minutes % 60).padStart(2, '0')}` } };
      }
      if (when.day !== undefined) return { tool: 'biz_free_slots', args: { date: isoDay(when.day), service: service || undefined } };
    }
  }
  if (/(свободн\S*\s+(окн|врем|слот|час)|когда (я )?свобод|есть (ли )?(окн|свободн)|окна на)/.test(low)) {
    const when = parseWhen(low, now);
    return { tool: 'biz_free_slots', args: when.day !== undefined ? { date: isoDay(when.day) } : {} };
  }
  if (/((что|кто) у меня|мои записи|расписание|записи)\s*(на\s+)?(сегодня|завтра|послезавтра|в?\s*(понедельник|вторник|сред|четверг|пятниц|суббот|воскресен)|\d)/.test(low)) {
    const when = parseWhen(low, now);
    return { tool: 'biz_agenda', args: when.day !== undefined ? { date: isoDay(when.day) } : {} };
  }
  const cancel = text.trim().match(/^(?:отмени(?:ть)?|удали)\s+запись\s+(?:для\s+|у\s+)?(.+?)[.!]?$/i);
  if (cancel) return { tool: 'biz_cancel_booking', args: { client: normalizeClientName(cancel[1]) } };
  // «Петров пришёл» срабатывает только если у Петрова действительно есть запись — иначе это обычная фраза для ИИ.
  const noshow = text.trim().match(/^(.+?)\s+не\s+приш(?:ел|ёл|ла|ли)[.!]?$/i);
  if (noshow && store.findUpcoming(noshow[1])) return { tool: 'biz_complete_booking', args: { client: normalizeClientName(noshow[1]), noshow: true } };
  const came = text.trim().match(/^(.+?)\s+приш(?:ел|ёл|ла|ли)(?:\s+и\s+(?:оплатил[аи]?|заплатил[аи]?))?(?:\s+(\d[\d\s]*))?[.!]?$/i);
  if (came && store.findUpcoming(came[1])) return { tool: 'biz_complete_booking', args: { client: normalizeClientName(came[1]), ...(came[2] ? { amount: Number(came[2].replace(/\s/g, '')) } : {}) } };
  if (/напомина\S*\s+(клиентам|о записи|на завтра)/.test(low)) return { tool: 'biz_booking_reminders', args: {} };
  return null;
}

function isoDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Возвращает фрагмент lower в исходном регистре из original. */
function restoreCase(original: string, lower: string): string {
  if (!lower) return '';
  const i = original.toLowerCase().replace(/ё/g, 'е').indexOf(lower);
  return i >= 0 ? original.slice(i, i + lower.length) : lower;
}

export function describeBookingResult(tool: string, result: ToolResult): string | null {
  if (!tool.startsWith('biz_book') && !['biz_free_slots', 'biz_agenda', 'biz_cancel_booking', 'biz_complete_booking'].includes(tool)) return null;
  if (!result.success) return `⚠️ ${result.error || 'Не получилось'}`;
  const d = result.data ?? {};
  switch (tool) {
    case 'biz_book': return `📅 Записала: ${d.client}, ${d.service}, ${d.day} в ${d.time}–${d.end}${d.price ? ` (${formatRub(d.price)})` : ''}.${d.linked ? ' Отметка в CRM есть.' : ''}`;
    case 'biz_free_slots': return `🕐 ${d.text}`;
    case 'biz_agenda':
      return d.items?.length
        ? `📋 ${d.day[0].toUpperCase()}${d.day.slice(1)}:\n${d.items.map((a: any) => `• ${a.time}–${a.end} ${a.client}, ${a.service}${a.status !== 'booked' ? ` (${BOOKING_STATUS_LABELS[a.status as keyof typeof BOOKING_STATUS_LABELS]})` : ''}`).join('\n')}`
        : `📋 ${d.day[0].toUpperCase()}${d.day.slice(1)} записей нет.`;
    case 'biz_cancel_booking': return `❌ Запись отменена: ${d.client}, ${d.day} в ${d.time}.`;
    case 'biz_complete_booking':
      return d.status === 'noshow' ? `🚫 Отметила: ${d.client} не пришёл.` : `✅ ${d.client}: визит отмечен${d.income ? `, доход ${formatRub(d.income)} записан` : ''}.`;
    case 'biz_booking_reminders':
      return d.items?.length ? `🔔 Напоминания на завтра:\n${d.items.map((i: any) => `• ${i.client}${i.phone ? ` (${i.phone})` : ''}: ${i.text}`).join('\n')}` : '🔔 На завтра записей нет.';
    default: return null;
  }
}

export function bookingPrompt(store: BookingStore = bookingStore): string {
  const now = store.now();
  const today = store.dayAgenda(now).filter(a => a.status === 'booked');
  const services = store.listServices().map(s => `${s.name} (${s.durationMin} мин${s.price ? `, ${s.price} ₽` : ''})`).join('; ');
  return `
ЗАПИСЬ КЛИЕНТОВ. Услуги: ${services || 'не заданы'}. Сегодня записей: ${today.length}${today.length ? ` (${today.map(a => `${timeOf(a.start)} ${a.clientName}`).join(', ')})` : ''}.
- biz_book {"client": "имя", "service": "...", "date": "ГГГГ-ММ-ДД", "time": "ЧЧ:ММ"}
- biz_free_slots {"date": "ГГГГ-ММ-ДД", "service": "..."}
- biz_agenda {"date": "ГГГГ-ММ-ДД"}
- biz_cancel_booking {"client": "имя"}
- biz_complete_booking {"client": "имя", "amount": 0, "noshow": false}
- biz_booking_reminders {}
Сегодня ${new Date(now).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
}
