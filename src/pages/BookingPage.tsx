// Svetlana Business — запись клиентов: день, новая запись по свободным окнам, напоминания, услуги и рабочие часы.
// Доступность: у полей есть подписи, выбранное время — aria-pressed, результат действия читается как статус, ошибка — как alert.
// Визит отмечается через completeAppointment: доход записывается один раз и убирается, если отметка не сохранилась.
// Ошибки показываются через safeErrorText: наши русские тексты как есть, технические заменяются понятной фразой.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Check, X, UserX, Copy, Bell, Plus, Trash2, Download, Settings } from 'lucide-react';
import { bookingStore, startOfDay, timeOf, dayLabel, toICS, toMinutes, WEEKDAY_LABELS, BOOKING_STATUS_LABELS, type Appointment, type WorkDay, type BookingStatus } from '../services/biz/Booking';
import { formatRub } from '../services/biz/BizStore';
import { completeAppointment } from '../services/biz/BookingTools';
import { crmStore } from '../services/crm/CRMStore';
import { askConfirm, showCopyText } from '../components/ConfirmDialog';
import { safeErrorText } from '../services/safeErrorText';

const DAY = 86_400_000;
const input = 'w-full min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10`;
const card = 'rounded-xl bg-white/5 border border-white/10 p-4 space-y-3';
/** Строка расписания: подпись и два поля времени в сетке, на узком экране не вылезает за край. */
const scheduleRow = 'grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-sm';

type Msg = { text: string; error: boolean } | null;

function isoDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromIso(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
/** Копирует в буфер; если буфер недоступен, показывает текст в окне, чтобы его можно было скопировать вручную. */
async function copy(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    await showCopyText('Скопируйте текст:', text);
    return false;
  }
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
function MsgLine({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role={msg.error ? 'alert' : 'status'} className={`text-sm ${msg.error ? 'text-red-300' : 'text-indigo-200'}`}>{msg.text}</p>;
}

export default function BookingPage() {
  const [version, setVersion] = useState(0);
  useEffect(() => bookingStore.subscribe(() => setVersion(v => v + 1)), []);
  const now = bookingStore.now();
  const [day, setDay] = useState(startOfDay(now));
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [dayMsg, setDayMsg] = useState<Msg>(null);

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
      if (!Number.isFinite(start)) throw new Error('Выберите дату и время');
      const contact = crmStore.findContactByName(client);
      const a = bookingStore.book({ clientName: contact?.name ?? client, contactId: contact?.id, phone: contact?.phones[0], start, serviceId: svc?.id });
      let note = '';
      if (contact) {
        try { crmStore.addActivity({ type: 'meeting', text: `Запись: ${a.serviceName}, ${dayLabel(a.start, now)} в ${timeOf(a.start)}`, contactId: contact.id }); }
        catch { note = ' (в CRM не отметила)'; }
      }
      setMsg({ text: `Записала: ${a.clientName}, ${dayLabel(a.start, now)} в ${timeOf(a.start)}${note}`, error: false });
      setClient(''); setTime(''); setDay(startOfDay(a.start));
    } catch (err) { setMsg({ text: safeErrorText(err, 'Не получилось записать'), error: true }); }
  };

  const complete = (a: Appointment) => {
    setDayMsg(null);
    try {
      const r = completeAppointment(a, undefined);
      setDayMsg({ text: r.income > 0 ? `${a.clientName}: доход ${formatRub(r.income)} записан` : `${a.clientName}: визит отмечен`, error: false });
    } catch (err) { setDayMsg({ text: safeErrorText(err, 'Не удалось отметить визит'), error: true }); }
  };

  const setStatus = (a: Appointment, status: BookingStatus, done: string) => {
    setDayMsg(null);
    try { bookingStore.setStatus(a.id, status); setDayMsg({ text: `${a.clientName}: ${done}`, error: false }); }
    catch (err) { setDayMsg({ text: safeErrorText(err, 'Не удалось изменить запись'), error: true }); }
  };

  const cancel = async (a: Appointment) => {
    const ok = await askConfirm(`Отменить запись: ${a.clientName}, ${timeOf(a.start)}?`, { okText: 'Отменить запись' });
    if (ok) setStatus(a, 'cancelled', 'запись отменена');
  };

  const dayTitle = dayLabel(day + 12 * 3_600_000, now).replace(/^./, c => c.toUpperCase());

  return (
    <div className="space-y-4 text-white">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${card} lg:col-span-2`} aria-label={`Записи: ${dayTitle}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold flex items-center gap-2"><CalendarClock className="w-4 h-4 text-indigo-300" aria-hidden="true" />{dayTitle}</h3>
            <div className="flex gap-1">
              <button className={btnGhost} onClick={() => setDay(startOfDay(day - DAY + 12 * 3_600_000))} aria-label="Предыдущий день"><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button>
              <button className={btnGhost} onClick={() => setDay(startOfDay(now))}>Сегодня</button>
              <button className={btnGhost} onClick={() => setDay(startOfDay(day + DAY + 12 * 3_600_000))} aria-label="Следующий день"><ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
            </div>
          </div>
          <MsgLine msg={dayMsg} />
          {agenda.length ? agenda.map(a => (
            <div key={a.id} className={`rounded-lg p-3 border ${a.status === 'booked' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-white/5 border-white/10 text-slate-300'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{timeOf(a.start)}–{timeOf(a.end)} · {a.clientName}</p>
                  <p className="text-xs text-slate-400 break-words">{a.serviceName}{a.price ? ` · ${formatRub(a.price)}` : ''}{a.phone ? ` · ${a.phone}` : ''}{a.status !== 'booked' ? ` · ${BOOKING_STATUS_LABELS[a.status]}` : ''}</p>
                </div>
                {a.status === 'booked' && (
                  <div className="flex flex-wrap gap-1">
                    <button className={btnGhost} onClick={() => complete(a)} title="Пришёл и оплатил" aria-label={`${a.clientName}, ${timeOf(a.start)}: пришёл и оплатил`}><Check className="w-4 h-4 text-emerald-300" aria-hidden="true" /></button>
                    <button className={btnGhost} onClick={() => setStatus(a, 'noshow', 'отмечено, что не пришёл')} title="Не пришёл" aria-label={`${a.clientName}, ${timeOf(a.start)}: не пришёл`}><UserX className="w-4 h-4 text-amber-300" aria-hidden="true" /></button>
                    <button className={btnGhost} onClick={() => { void cancel(a); }} title="Отменить" aria-label={`${a.clientName}, ${timeOf(a.start)}: отменить запись`}><X className="w-4 h-4 text-red-300" aria-hidden="true" /></button>
                    <button className={btnGhost} onClick={() => downloadIcs(a)} title="В календарь телефона" aria-label={`${a.clientName}, ${timeOf(a.start)}: добавить в календарь телефона`}><Download className="w-4 h-4" aria-hidden="true" /></button>
                  </div>
                )}
              </div>
            </div>
          )) : <p className="text-sm text-slate-400">Записей нет.{bookingStore.workingHours(day + 12 * 3_600_000) ? '' : ' Выходной.'}</p>}
        </section>

        <form className={card} onSubmit={submit} aria-label="Новая запись">
          <h3 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-300" aria-hidden="true" />Новая запись</h3>
          <input className={input} list="booking-clients" placeholder="Клиент" aria-label="Клиент" value={client} onChange={e => setClient(e.target.value)} required />
          <datalist id="booking-clients">{contacts.map(c => <option key={c.id} value={c.name} />)}</datalist>
          <select className={input} aria-label="Услуга" value={svc?.id ?? ''} onChange={e => { setServiceId(e.target.value); setTime(''); }}>
            {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} мин{s.price ? ` · ${formatRub(s.price)}` : ''}</option>)}
          </select>
          <input className={input} type="date" aria-label="Дата записи" value={date} min={isoDate(now)} onChange={e => { setDate(e.target.value); setTime(''); }} />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Свободное время">
            {slots.length ? slots.map(t => (
              <button type="button" key={t} onClick={() => setTime(timeOf(t))} aria-pressed={time === timeOf(t)} className={`px-3 py-2 min-h-9 rounded-md text-xs ${time === timeOf(t) ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{timeOf(t)}</button>
            )) : <p className="text-xs text-slate-400">В этот день свободных окон нет.</p>}
          </div>
          <button className={btnPrimary} disabled={!client.trim() || !time || !svc}>Записать</button>
          <button type="button" className={btnGhost} onClick={async () => {
            if (await copy(bookingStore.slotsText(now, svc?.durationMin ?? 60, 7))) setMsg({ text: 'Свободные окна скопированы: отправьте клиенту', error: false });
          }}>
            <Copy className="w-4 h-4" aria-hidden="true" />Скопировать свободные окна
          </button>
          <MsgLine msg={msg} />
        </form>
      </div>

      <section className={card} aria-label="Напоминания на завтра">
        <h3 className="font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-amber-300" aria-hidden="true" />Напоминания на завтра</h3>
        {reminders.length ? reminders.map(r => (
          <div key={r.appointment.id} className="rounded-lg bg-black/20 p-3 space-y-2">
            <p className="text-sm break-words">{r.text}</p>
            <div className="flex flex-wrap gap-2">
              <button className={btnGhost} onClick={async () => { if (await copy(r.text)) setDayMsg({ text: `Напоминание для ${r.appointment.clientName} скопировано`, error: false }); }} aria-label={`Скопировать напоминание для ${r.appointment.clientName}`}><Copy className="w-4 h-4" aria-hidden="true" />Копировать</button>
              {phoneLinks(r.appointment.phone, r.text)}
            </div>
          </div>
        )) : <p className="text-sm text-slate-400">На завтра записей нет.</p>}
      </section>

      <button className={btnGhost} onClick={() => setShowSettings(s => !s)} aria-expanded={showSettings} aria-controls="booking-settings"><Settings className="w-4 h-4" aria-hidden="true" />{showSettings ? 'Скрыть настройки' : 'Услуги и рабочие часы'}</button>
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
  const [msg, setMsg] = useState<Msg>(null);

  const setDayField = (i: number, patch: Partial<WorkDay>) => setSchedule(s => ({ ...s, days: s.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const save = () => {
    if (!Number.isFinite(schedule.stepMin) || schedule.stepMin < 5 || !Number.isFinite(schedule.bufferMin) || schedule.bufferMin < 0) {
      setMsg({ text: 'Шаг — не меньше 5 минут, пауза — не меньше 0', error: true }); return;
    }
    try { bookingStore.updateSchedule(schedule); setMsg({ text: 'Рабочие часы сохранены', error: false }); } catch (e) { setMsg({ text: safeErrorText(e, 'Не удалось сохранить рабочие часы'), error: true }); }
  };
  const addService = (e: FormEvent) => {
    e.preventDefault();
    const minutes = Number(duration);
    const cost = price.trim() ? Number(price.replace(/\s/g, '').replace(',', '.')) : 0;
    if (!Number.isFinite(minutes) || minutes < 5) { setMsg({ text: 'Длительность — не меньше 5 минут', error: true }); return; }
    if (!Number.isFinite(cost) || cost < 0) { setMsg({ text: 'Цену укажите цифрами, например 1500', error: true }); return; }
    try { bookingStore.addService({ name, durationMin: minutes, price: cost }); setName(''); setPrice(''); setMsg({ text: `Услуга «${name.trim()}» добавлена`, error: false }); } catch (err) { setMsg({ text: safeErrorText(err, 'Не удалось добавить услугу'), error: true }); }
  };
  const removeService = async (id: string, title: string) => {
    const ok = await askConfirm(`Удалить услугу «${title}»? Уже сделанные записи останутся.`, { okText: 'Удалить' });
    if (!ok) return;
    try { bookingStore.deleteService(id); setMsg({ text: `Услуга «${title}» удалена`, error: false }); } catch (err) { setMsg({ text: safeErrorText(err, 'Не удалось удалить услугу'), error: true }); }
  };
  const valid = (v: string) => { try { toMinutes(v); return true; } catch { return false; } };

  return (
    <div id="booking-settings" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section className={card} aria-label="Услуги">
        <h3 className="font-semibold">Услуги</h3>
        {services.map(s => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-words">{s.name} · {s.durationMin} мин{s.price ? ` · ${formatRub(s.price)}` : ''}</span>
            <button className={btnGhost} onClick={() => { void removeService(s.id, s.name); }} aria-label={`Удалить услугу ${s.name}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        ))}
        <form className="grid grid-cols-6 gap-2" onSubmit={addService} aria-label="Новая услуга">
          <input className={`${input} col-span-6 sm:col-span-3`} placeholder="Услуга" aria-label="Название услуги" value={name} onChange={e => setName(e.target.value)} required />
          <input className={`${input} col-span-3 sm:col-span-1`} type="number" min={5} step={5} title="Минут" aria-label="Длительность, минут" value={duration} onChange={e => setDuration(e.target.value)} />
          <input className={`${input} col-span-3 sm:col-span-2`} inputMode="decimal" placeholder="Цена, ₽" aria-label="Цена в рублях" value={price} onChange={e => setPrice(e.target.value)} />
          <button className={`${btnPrimary} col-span-6 justify-center`}><Plus className="w-4 h-4" aria-hidden="true" />Добавить услугу</button>
        </form>
      </section>
      <section className={card} aria-label="Рабочие часы">
        <h3 className="font-semibold">Рабочие часы</h3>
        {schedule.days.map((d, i) => (
          <div key={WEEKDAY_LABELS[i]} className={scheduleRow}>
            <label className="flex items-center gap-2 min-w-0"><input type="checkbox" checked={d.enabled} onChange={e => setDayField(i, { enabled: e.target.checked })} aria-label={`${WEEKDAY_LABELS[i]}: рабочий день`} />{WEEKDAY_LABELS[i]}</label>
            <input className={input} type="time" value={d.start} disabled={!d.enabled} onChange={e => setDayField(i, { start: e.target.value })} aria-label={`${WEEKDAY_LABELS[i]}: начало`} />
            <input className={input} type="time" value={d.end} disabled={!d.enabled} onChange={e => setDayField(i, { end: e.target.value })} aria-label={`${WEEKDAY_LABELS[i]}: конец`} />
          </div>
        ))}
        <div className={scheduleRow}>
          <span>Обед</span>
          <input className={input} type="time" value={schedule.breakStart} onChange={e => setSchedule(s => ({ ...s, breakStart: e.target.value }))} aria-label="Обед: начало" />
          <input className={input} type="time" value={schedule.breakEnd} onChange={e => setSchedule(s => ({ ...s, breakEnd: e.target.value }))} aria-label="Обед: конец" />
        </div>
        {/* На узком экране две колонки «подпись над полем», а не одна строка из четырёх элементов. */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="space-y-1 min-w-0">
            <span className="block text-slate-300">Шаг, мин</span>
            <input className={input} type="number" min={5} step={5} value={schedule.stepMin} onChange={e => setSchedule(s => ({ ...s, stepMin: Number(e.target.value) }))} />
          </label>
          <label className="space-y-1 min-w-0">
            <span className="block text-slate-300">Пауза, мин</span>
            <input className={input} type="number" min={0} step={5} value={schedule.bufferMin} onChange={e => setSchedule(s => ({ ...s, bufferMin: Number(e.target.value) }))} />
          </label>
        </div>
        <button className={btnPrimary} onClick={save} disabled={schedule.days.some(d => d.enabled && (!valid(d.start) || !valid(d.end)))}>Сохранить</button>
        <p className="text-xs text-slate-400">Сейчас: {schedule.days.filter(d => d.enabled).length} рабочих дней, {schedule.breakStart && schedule.breakEnd ? `обед ${schedule.breakStart}–${schedule.breakEnd}` : 'без обеда'}, сетка {schedule.stepMin} мин.</p>
        <MsgLine msg={msg} />
      </section>
    </div>
  );
}
