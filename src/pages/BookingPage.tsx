// Svetlana Business — запись клиентов: день, новая запись по свободным окнам, напоминания, услуги и рабочие часы.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Check, X, UserX, Copy, Bell, Plus, Trash2, Download, Settings } from 'lucide-react';
import { bookingStore, startOfDay, timeOf, dayLabel, toICS, toMinutes, WEEKDAY_LABELS, BOOKING_STATUS_LABELS, type Appointment, type WorkDay } from '../services/biz/Booking';
import { bizStore, formatRub } from '../services/biz/BizStore';
import { crmStore } from '../services/crm/CRMStore';

const DAY = 86_400_000;
const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10`;
const card = 'rounded-xl bg-white/5 border border-white/10 p-4 space-y-3';

function isoDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromIso(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}
function downloadIcs(a: Appointment) {
  const blob = new Blob([toICS(a)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `zapis-${isoDate(a.start)}-${timeOf(a.start).replace(':', '')}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function phoneLinks(phone: string | undefined, text: string) {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
  if (!digits) return null;
  const t = encodeURIComponent(text);
  return (
    <>
      <a className={btnGhost} href={`https://wa.me/${digits}?text=${t}`} target="_blank" rel="noreferrer">WhatsApp</a>
      <a className={btnGhost} href={`sms:+${digits}?body=${t}`}>SMS</a>
    </>
  );
}

export default function BookingPage() {
  const [version, setVersion] = useState(0);
  useEffect(() => bookingStore.subscribe(() => setVersion(v => v + 1)), []);
  const now = bookingStore.now();
  const [day, setDay] = useState(startOfDay(now));
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const services = useMemo(() => { void version; return bookingStore.listServices(); }, [version]);
  const agenda = useMemo(() => { void version; return bookingStore.dayAgenda(day); }, [version, day]);
  const reminders = useMemo(() => { void version; return bookingStore.reminders(now + DAY); }, [version, now]);

  // форма новой записи
  const [client, setClient] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(isoDate(now));
  const [time, setTime] = useState('');
  const svc = services.find(s => s.id === serviceId) ?? services[0];
  const slots = useMemo(() => { void version; return bookingStore.freeSlots(fromIso(date) + 12 * 3_600_000, svc?.durationMin ?? 60); }, [version, date, svc]);
  const contacts = useMemo(() => { void version; return crmStore.listContacts().slice(0, 300); }, [version]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const [h, m] = time.split(':').map(Number);
      const d = new Date(fromIso(date));
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
      const contact = crmStore.findContactByName(client);
      const a = bookingStore.book({ clientName: contact?.name ?? client, contactId: contact?.id, phone: contact?.phones[0], start, serviceId: svc?.id });
      if (contact) crmStore.addActivity({ type: 'meeting', text: `Запись: ${a.serviceName}, ${dayLabel(a.start, now)} в ${timeOf(a.start)}`, contactId: contact.id });
      setMsg(`Записала: ${a.clientName}, ${dayLabel(a.start, now)} в ${timeOf(a.start)}`);
      setClient(''); setTime(''); setDay(startOfDay(a.start));
    } catch (err: any) { setMsg(err?.message || 'Не получилось записать'); }
  };

  const complete = (a: Appointment) => {
    let entryId: string | undefined;
    if (a.price > 0) entryId = bizStore.addEntry({ kind: 'income', amount: a.price, description: a.serviceName, counterparty: a.clientName, contactId: a.contactId, payerType: 'person', date: Math.min(Date.now(), a.end) }).id;
    bookingStore.setStatus(a.id, 'done', entryId);
    setMsg(a.price > 0 ? `${a.clientName}: доход ${formatRub(a.price)} записан` : `${a.clientName}: визит отмечен`);
  };

  return (
    <div className="space-y-4 text-white">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} lg:col-span-2`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold flex items-center gap-2"><CalendarClock className="w-4 h-4 text-indigo-300" />{dayLabel(day + 12 * 3_600_000, now).replace(/^./, c => c.toUpperCase())}</h3>
            <div className="flex gap-1">
              <button className={btnGhost} onClick={() => setDay(startOfDay(day - DAY + 12 * 3_600_000))} aria-label="Предыдущий день"><ChevronLeft className="w-4 h-4" /></button>
              <button className={btnGhost} onClick={() => setDay(startOfDay(now))}>Сегодня</button>
              <button className={btnGhost} onClick={() => setDay(startOfDay(day + DAY + 12 * 3_600_000))} aria-label="Следующий день"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
          {agenda.length ? agenda.map(a => (
            <div key={a.id} className={`rounded-lg p-3 border ${a.status === 'booked' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-white/5 border-white/10 opacity-70'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{timeOf(a.start)}–{timeOf(a.end)} · {a.clientName}</p>
                  <p className="text-xs text-slate-400">{a.serviceName}{a.price ? ` · ${formatRub(a.price)}` : ''}{a.phone ? ` · ${a.phone}` : ''}{a.status !== 'booked' ? ` · ${BOOKING_STATUS_LABELS[a.status]}` : ''}</p>
                </div>
                {a.status === 'booked' && (
                  <div className="flex flex-wrap gap-1">
                    <button className={btnGhost} onClick={() => complete(a)} title="Пришёл и оплатил"><Check className="w-4 h-4 text-emerald-300" /></button>
                    <button className={btnGhost} onClick={() => bookingStore.setStatus(a.id, 'noshow')} title="Не пришёл"><UserX className="w-4 h-4 text-amber-300" /></button>
                    <button className={btnGhost} onClick={() => bookingStore.setStatus(a.id, 'cancelled')} title="Отменить"><X className="w-4 h-4 text-red-300" /></button>
                    <button className={btnGhost} onClick={() => downloadIcs(a)} title="В календарь телефона"><Download className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
          )) : <p className="text-sm text-slate-500">Записей нет.{bookingStore.workingHours(day + 12 * 3_600_000) ? '' : ' Выходной.'}</p>}
        </div>

        <form className={card} onSubmit={submit}>
          <h3 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-300" />Новая запись</h3>
          <input className={input} list="booking-clients" placeholder="Клиент" value={client} onChange={e => setClient(e.target.value)} required />
          <datalist id="booking-clients">{contacts.map(c => <option key={c.id} value={c.name} />)}</datalist>
          <select className={input} value={svc?.id ?? ''} onChange={e => { setServiceId(e.target.value); setTime(''); }}>
            {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} мин{s.price ? ` · ${formatRub(s.price)}` : ''}</option>)}
          </select>
          <input className={input} type="date" value={date} min={isoDate(now)} onChange={e => { setDate(e.target.value); setTime(''); }} />
          <div className="flex flex-wrap gap-1.5">
            {slots.length ? slots.map(t => (
              <button type="button" key={t} onClick={() => setTime(timeOf(t))} className={`px-2.5 py-1 rounded-md text-xs ${time === timeOf(t) ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{timeOf(t)}</button>
            )) : <p className="text-xs text-slate-500">В этот день свободных окон нет.</p>}
          </div>
          <button className={btnPrimary} disabled={!client.trim() || !time || !svc}>Записать</button>
          <button type="button" className={btnGhost} onClick={() => { copy(bookingStore.slotsText(now, svc?.durationMin ?? 60, 7)); setMsg('Свободные окна скопированы: отправьте клиенту'); }}>
            <Copy className="w-4 h-4" />Скопировать свободные окна
          </button>
          {msg && <p className="text-sm text-indigo-200">{msg}</p>}
        </form>
      </div>

      <div className={card}>
        <h3 className="font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-amber-300" />Напоминания на завтра</h3>
        {reminders.length ? reminders.map(r => (
          <div key={r.appointment.id} className="rounded-lg bg-black/20 p-3 space-y-2">
            <p className="text-sm">{r.text}</p>
            <div className="flex flex-wrap gap-2">
              <button className={btnGhost} onClick={() => copy(r.text)}><Copy className="w-4 h-4" />Копировать</button>
              {phoneLinks(r.appointment.phone, r.text)}
            </div>
          </div>
        )) : <p className="text-sm text-slate-500">На завтра записей нет.</p>}
      </div>

      <button className={btnGhost} onClick={() => setShowSettings(s => !s)}><Settings className="w-4 h-4" />{showSettings ? 'Скрыть настройки' : 'Услуги и рабочие часы'}</button>
      {showSettings && <BookingSettings version={version} />}
    </div>
  );
}

function BookingSettings({ version }: { version: number }) {
  const services = useMemo(() => { void version; return bookingStore.listServices(); }, [version]);
  const [schedule, setSchedule] = useState(() => bookingStore.getSchedule());
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('60');
  const [price, setPrice] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const setDayField = (i: number, patch: Partial<WorkDay>) => setSchedule(s => ({ ...s, days: s.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const save = () => {
    try { bookingStore.updateSchedule(schedule); setMsg('Рабочие часы сохранены'); } catch (e: any) { setMsg(e?.message || 'Ошибка'); }
  };
  const addService = (e: FormEvent) => {
    e.preventDefault();
    try { bookingStore.addService({ name, durationMin: Number(duration), price: Number(price) || 0 }); setName(''); setPrice(''); setMsg(null); } catch (err: any) { setMsg(err?.message || 'Ошибка'); }
  };
  const valid = (v: string) => { try { toMinutes(v); return true; } catch { return false; } };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className={card}>
        <h3 className="font-semibold">Услуги</h3>
        {services.map(s => (
          <div key={s.id} className="flex items-center justify-between text-sm">
            <span>{s.name} · {s.durationMin} мин{s.price ? ` · ${formatRub(s.price)}` : ''}</span>
            <button className={btnGhost} onClick={() => bookingStore.deleteService(s.id)} aria-label="Удалить услугу"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <form className="grid grid-cols-6 gap-2" onSubmit={addService}>
          <input className={`${input} col-span-3`} placeholder="Услуга" value={name} onChange={e => setName(e.target.value)} required />
          <input className={`${input} col-span-1`} type="number" min={5} step={5} title="Минут" value={duration} onChange={e => setDuration(e.target.value)} />
          <input className={`${input} col-span-2`} type="number" min={0} placeholder="Цена, ₽" value={price} onChange={e => setPrice(e.target.value)} />
          <button className={`${btnPrimary} col-span-6 justify-center`}><Plus className="w-4 h-4" />Добавить услугу</button>
        </form>
      </div>
      <div className={card}>
        <h3 className="font-semibold">Рабочие часы</h3>
        {schedule.days.map((d, i) => (
          <div key={WEEKDAY_LABELS[i]} className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2 w-14"><input type="checkbox" checked={d.enabled} onChange={e => setDayField(i, { enabled: e.target.checked })} />{WEEKDAY_LABELS[i]}</label>
            <input className={input} type="time" value={d.start} disabled={!d.enabled} onChange={e => setDayField(i, { start: e.target.value })} />
            <input className={input} type="time" value={d.end} disabled={!d.enabled} onChange={e => setDayField(i, { end: e.target.value })} />
          </div>
        ))}
        <div className="flex items-center gap-2 text-sm">
          <span className="w-14">Обед</span>
          <input className={input} type="time" value={schedule.breakStart} onChange={e => setSchedule(s => ({ ...s, breakStart: e.target.value }))} />
          <input className={input} type="time" value={schedule.breakEnd} onChange={e => setSchedule(s => ({ ...s, breakEnd: e.target.value }))} />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="whitespace-nowrap">Шаг, мин</span>
          <input className={input} type="number" min={5} step={5} value={schedule.stepMin} onChange={e => setSchedule(s => ({ ...s, stepMin: Number(e.target.value) }))} />
          <span className="whitespace-nowrap">Пауза</span>
          <input className={input} type="number" min={0} step={5} value={schedule.bufferMin} onChange={e => setSchedule(s => ({ ...s, bufferMin: Number(e.target.value) }))} />
        </div>
        <button className={btnPrimary} onClick={save} disabled={schedule.days.some(d => d.enabled && (!valid(d.start) || !valid(d.end)))}>Сохранить</button>
        <p className="text-xs text-slate-500">Сейчас: {schedule.days.filter(d => d.enabled).length} рабочих дней, {schedule.breakStart && schedule.breakEnd ? `обед ${schedule.breakStart}–${schedule.breakEnd}` : 'без обеда'}, сетка {schedule.stepMin} мин.</p>
        {msg && <p className="text-sm text-indigo-200">{msg}</p>}
      </div>
    </div>
  );
}
