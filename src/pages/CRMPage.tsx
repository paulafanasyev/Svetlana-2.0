// Svetlana CRM — contacts, deals pipeline, tasks, summary, import/export.
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Users, Briefcase, CheckSquare, BarChart3, Database, Plus, Search, Trash2, Smartphone,
  X, Phone, Mail, ChevronLeft, ChevronRight, Download, Upload, Pencil,
} from 'lucide-react';
import {
  crmStore, DEAL_STAGES, STAGE_LABELS, STATUS_LABELS, ACTIVITY_LABELS,
  type ActivityType, type ContactStatus, type CRMContact, type CRMDeal,
} from '../services/crm/CRMStore';
import { importPhoneContacts } from '../services/crm/CRMTools';

type Tab = 'contacts' | 'deals' | 'tasks' | 'summary' | 'data';
const STATUSES: ContactStatus[] = ['lead', 'client', 'partner', 'other'];
const LOG_TYPES: ActivityType[] = ['note', 'call', 'meeting', 'message'];

const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10`;
const card = 'rounded-xl bg-white/5 border border-white/10';

function useCRMVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => crmStore.subscribe(() => setVersion(v => v + 1)), []);
  return version;
}

function money(value: number, currency = 'RUB'): string {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString('ru-RU')} ${currency}`;
  }
}

function date(ts?: number): string {
  return ts ? new Date(ts).toLocaleDateString('ru-RU') : '';
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function splitList(value: string): string[] {
  return value.split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

// ---------------- contacts ----------------

interface ContactDraft { name: string; phones: string; emails: string; company: string; position: string; status: ContactStatus; tags: string; notes: string }

function draftOf(c?: CRMContact): ContactDraft {
  return {
    name: c?.name ?? '', phones: c?.phones.join(', ') ?? '', emails: c?.emails.join(', ') ?? '',
    company: c?.company ?? '', position: c?.position ?? '', status: c?.status ?? 'lead',
    tags: c?.tags.join(', ') ?? '', notes: c?.notes ?? '',
  };
}

function ContactForm({ contact, onDone }: { contact?: CRMContact; onDone: (id?: string) => void }) {
  const [draft, setDraft] = useState<ContactDraft>(draftOf(contact));
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof ContactDraft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft(d => ({ ...d, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const fields = {
      name: draft.name, phones: splitList(draft.phones), emails: splitList(draft.emails),
      company: draft.company, position: draft.position, status: draft.status,
      tags: splitList(draft.tags), notes: draft.notes,
    };
    try {
      if (contact) {
        crmStore.updateContact(contact.id, fields);
        onDone(contact.id);
      } else {
        const dup = crmStore.findDuplicate({ phones: fields.phones, emails: fields.emails });
        if (dup) { setError(`Такой номер или e-mail уже есть у «${dup.name}»`); return; }
        onDone(crmStore.addContact({ ...fields, source: 'manual' }).id);
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось сохранить');
    }
  };

  return (
    <form onSubmit={submit} className={`${card} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{contact ? 'Редактировать контакт' : 'Новый контакт'}</h3>
        <button type="button" onClick={() => onDone(contact?.id)} className="p-1 text-slate-400 hover:text-white" aria-label="Закрыть"><X className="w-4 h-4" /></button>
      </div>
      <input className={input} placeholder="Имя *" value={draft.name} onChange={set('name')} autoFocus />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input className={input} placeholder="Телефоны (через запятую)" value={draft.phones} onChange={set('phones')} />
        <input className={input} placeholder="E-mail (через запятую)" value={draft.emails} onChange={set('emails')} />
        <input className={input} placeholder="Компания" value={draft.company} onChange={set('company')} />
        <input className={input} placeholder="Должность" value={draft.position} onChange={set('position')} />
        <select className={input} value={draft.status} onChange={set('status')}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <input className={input} placeholder="Теги (через запятую)" value={draft.tags} onChange={set('tags')} />
      </div>
      <textarea className={`${input} min-h-[70px]`} placeholder="Заметки" value={draft.notes} onChange={set('notes')} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" className={btnPrimary} disabled={!draft.name.trim()}>Сохранить</button>
    </form>
  );
}

function ContactDetail({ contact, onEdit, onDeleted }: { contact: CRMContact; onEdit: () => void; onDeleted: () => void }) {
  const [logType, setLogType] = useState<ActivityType>('note');
  const [logText, setLogText] = useState('');
  const activities = crmStore.listActivities({ contactId: contact.id });
  const deals = crmStore.listDeals({ contactId: contact.id });

  const addLog = (e: FormEvent) => {
    e.preventDefault();
    if (!logText.trim()) return;
    crmStore.addActivity({ type: logType, text: logText, contactId: contact.id });
    setLogText('');
  };

  const remove = () => {
    if (window.confirm(`Удалить контакт «${contact.name}»? Сделки и история останутся без привязки.`)) {
      crmStore.deleteContact(contact.id);
      onDeleted();
    }
  };

  return (
    <div className={`${card} p-4 space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{contact.name}</h3>
          <p className="text-sm text-slate-400">
            {[contact.position, contact.company].filter(Boolean).join(' · ') || 'Без компании'} · {STATUS_LABELS[contact.status]}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className={btnGhost}><Pencil className="w-4 h-4" />Изменить</button>
          <button onClick={remove} className={`${btnGhost} text-red-300`} aria-label="Удалить"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="space-y-1 text-sm">
        {contact.phones.map(p => <a key={p} href={`tel:${p}`} className="flex items-center gap-2 text-indigo-300 hover:underline"><Phone className="w-4 h-4" />{p}</a>)}
        {contact.emails.map(m => <a key={m} href={`mailto:${m}`} className="flex items-center gap-2 text-indigo-300 hover:underline"><Mail className="w-4 h-4" />{m}</a>)}
      </div>
      {contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{contact.tags.map(t => <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-indigo-500/15 text-indigo-200">{t}</span>)}</div>
      )}
      {contact.notes && <p className="text-sm text-slate-300 whitespace-pre-wrap">{contact.notes}</p>}

      {deals.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-2">Сделки</h4>
          <div className="space-y-1">
            {deals.map(d => <div key={d.id} className="flex justify-between text-sm"><span>{d.title}</span><span className="text-slate-400">{STAGE_LABELS[d.stage]} · {money(d.amount, d.currency)}</span></div>)}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-slate-300 mb-2">История</h4>
        <form onSubmit={addLog} className="flex gap-2 mb-3">
          <select className={`${input} w-36`} value={logType} onChange={e => setLogType(e.target.value as ActivityType)}>
            {LOG_TYPES.map(t => <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>)}
          </select>
          <input className={input} placeholder="Что было?" value={logText} onChange={e => setLogText(e.target.value)} />
          <button type="submit" className={btnPrimary} disabled={!logText.trim()}><Plus className="w-4 h-4" /></button>
        </form>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {activities.length === 0 && <p className="text-sm text-slate-500">Пока пусто</p>}
          {activities.map(a => (
            <div key={a.id} className="text-sm border-l-2 border-indigo-500/40 pl-3">
              <span className="text-slate-400">{date(a.createdAt)} · {ACTIVITY_LABELS[a.type]}{a.type === 'task' && a.done ? ' ✓' : ''}</span>
              <p className="text-slate-200">{a.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactsTab() {
  useCRMVersion();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ContactStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'new' | 'edit'>('view');
  const contacts = crmStore.listContacts({ query, status: status || undefined });
  const selected = selectedId ? crmStore.getContact(selectedId) : undefined;
  const visible = contacts.slice(0, 300);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input className={`${input} pl-9`} placeholder="Поиск: имя, телефон, компания, тег" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button className={btnPrimary} onClick={() => { setMode('new'); setSelectedId(null); }}><Plus className="w-4 h-4" />Контакт</button>
        </div>
        <select className={input} value={status} onChange={e => setStatus(e.target.value as ContactStatus | '')}>
          <option value="">Все статусы</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <p className="text-xs text-slate-500">Найдено: {contacts.length}{contacts.length > visible.length ? ` (показаны первые ${visible.length}, уточните поиск)` : ''}</p>
        <div className={`${card} divide-y divide-white/5 max-h-[60vh] overflow-y-auto`}>
          {visible.length === 0 && <p className="p-4 text-sm text-slate-500">Контактов нет. Добавьте вручную или импортируйте с телефона на вкладке «Данные».</p>}
          {visible.map(c => (
            <button key={c.id} onClick={() => { setSelectedId(c.id); setMode('view'); }}
              className={`w-full text-left px-4 py-2.5 hover:bg-white/5 ${selectedId === c.id ? 'bg-indigo-500/10' : ''}`}>
              <div className="flex justify-between gap-2">
                <span className="font-medium truncate">{c.name}</span>
                <span className="text-xs text-slate-500 shrink-0">{STATUS_LABELS[c.status]}</span>
              </div>
              <p className="text-xs text-slate-400 truncate">{[c.phones[0], c.company].filter(Boolean).join(' · ')}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="lg:col-span-3">
        {mode === 'new' && <ContactForm onDone={id => { setMode('view'); if (id) setSelectedId(id); }} />}
        {mode === 'edit' && selected && <ContactForm contact={selected} onDone={() => setMode('view')} />}
        {mode === 'view' && selected && <ContactDetail contact={selected} onEdit={() => setMode('edit')} onDeleted={() => setSelectedId(null)} />}
        {mode === 'view' && !selected && <div className={`${card} p-8 text-center text-slate-500`}>Выберите контакт слева</div>}
      </div>
    </div>
  );
}

// ---------------- deals ----------------

function DealsTab() {
  useCRMVersion();
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const contacts = crmStore.listContacts();
  const deals = crmStore.listDeals();
  const contactName = (id?: string) => (id ? crmStore.getContact(id)?.name : undefined);

  const add = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      crmStore.addDeal({ title, contactId: contactId || undefined, amount: amount ? Number(amount.replace(',', '.')) : 0 });
      setTitle(''); setAmount(''); setContactId('');
    } catch (err: any) { setError(err?.message || 'Не удалось создать сделку'); }
  };

  const move = (deal: CRMDeal, dir: -1 | 1) => {
    const idx = DEAL_STAGES.indexOf(deal.stage) + dir;
    if (idx >= 0 && idx < DEAL_STAGES.length) crmStore.moveDeal(deal.id, DEAL_STAGES[idx]);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className={`${card} p-4 grid grid-cols-1 md:grid-cols-4 gap-3`}>
        <input className={input} placeholder="Название сделки *" value={title} onChange={e => setTitle(e.target.value)} />
        <select className={input} value={contactId} onChange={e => setContactId(e.target.value)}>
          <option value="">Без контакта</option>
          {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className={input} placeholder="Сумма, ₽" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        <button type="submit" className={btnPrimary} disabled={!title.trim()}><Plus className="w-4 h-4" />Сделка</button>
        {error && <p className="md:col-span-4 text-sm text-red-400">{error}</p>}
      </form>
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {DEAL_STAGES.map(stage => {
          const items = deals.filter(d => d.stage === stage);
          const total = items.reduce((s, d) => s + d.amount, 0);
          return (
            <div key={stage} className={`${card} p-3 min-h-[200px]`}>
              <div className="mb-3">
                <h4 className={`text-sm font-semibold ${stage === 'won' ? 'text-emerald-300' : stage === 'lost' ? 'text-red-300' : ''}`}>{STAGE_LABELS[stage]}</h4>
                <p className="text-xs text-slate-500">{items.length} · {money(total)}</p>
              </div>
              <div className="space-y-2">
                {items.map(d => (
                  <div key={d.id} className="rounded-lg bg-slate-900/60 border border-white/10 p-2.5 text-sm">
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs text-slate-400">{contactName(d.contactId) ?? 'Без контакта'}</p>
                    <p className="text-xs text-slate-300 mt-1">{money(d.amount, d.currency)}</p>
                    <div className="flex justify-between mt-2">
                      <button onClick={() => move(d, -1)} disabled={stage === DEAL_STAGES[0]} className="p-1 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Назад"><ChevronLeft className="w-4 h-4" /></button>
                      <button onClick={() => { if (window.confirm(`Удалить сделку «${d.title}»?`)) crmStore.deleteDeal(d.id); }} className="p-1 text-slate-500 hover:text-red-300" aria-label="Удалить"><Trash2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => move(d, 1)} disabled={stage === DEAL_STAGES[DEAL_STAGES.length - 1]} className="p-1 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Вперёд"><ChevronRight className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- tasks ----------------

function TasksTab() {
  useCRMVersion();
  const [text, setText] = useState('');
  const [contactId, setContactId] = useState('');
  const [due, setDue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const contacts = crmStore.listContacts();
  const now = Date.now();
  const tasks = showDone ? crmStore.listActivities({ type: 'task' }) : crmStore.listActivities({ openTasks: true });

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    crmStore.addActivity({ type: 'task', text, contactId: contactId || undefined, dueAt: due ? new Date(`${due}T09:00`).getTime() : undefined });
    setText(''); setDue('');
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <form onSubmit={add} className={`${card} p-4 grid grid-cols-1 md:grid-cols-4 gap-3`}>
        <input className={`${input} md:col-span-2`} placeholder="Что сделать? *" value={text} onChange={e => setText(e.target.value)} />
        <select className={input} value={contactId} onChange={e => setContactId(e.target.value)}>
          <option value="">Без контакта</option>
          {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" className={input} value={due} onChange={e => setDue(e.target.value)} />
        <button type="submit" className={`${btnPrimary} md:col-span-4 justify-center`} disabled={!text.trim()}><Plus className="w-4 h-4" />Добавить задачу</button>
      </form>
      <label className="flex items-center gap-2 text-sm text-slate-400">
        <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />Показывать выполненные
      </label>
      <div className={`${card} divide-y divide-white/5`}>
        {tasks.length === 0 && <p className="p-4 text-sm text-slate-500">Задач нет</p>}
        {tasks.map(t => {
          const overdue = !t.done && t.dueAt !== undefined && t.dueAt < now;
          const who = t.contactId ? crmStore.getContact(t.contactId)?.name : undefined;
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <input type="checkbox" checked={t.done} onChange={e => crmStore.setActivityDone(t.id, e.target.checked)} aria-label="Выполнено" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${t.done ? 'line-through text-slate-500' : ''}`}>{t.text}</p>
                <p className={`text-xs ${overdue ? 'text-red-400' : 'text-slate-500'}`}>{[who, t.dueAt ? `до ${date(t.dueAt)}` : '', overdue ? 'просрочено' : ''].filter(Boolean).join(' · ')}</p>
              </div>
              <button onClick={() => crmStore.deleteActivity(t.id)} className="p-1 text-slate-500 hover:text-red-300" aria-label="Удалить"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- summary ----------------

function SummaryTab() {
  useCRMVersion();
  const s = crmStore.stats();
  const maxStage = Math.max(1, ...DEAL_STAGES.map(st => s.byStage[st].amount));
  const tiles: { label: string; value: string; tone?: string }[] = [
    { label: 'Контакты', value: String(s.contacts) },
    { label: 'Клиенты', value: String(s.byStatus.client) },
    { label: 'Лиды', value: String(s.byStatus.lead) },
    { label: 'Открытые сделки', value: `${s.openDeals} · ${money(s.pipelineValue)}` },
    { label: 'Выиграно', value: `${s.wonDeals} · ${money(s.wonValue)}`, tone: 'text-emerald-300' },
    { label: 'Задачи', value: `${s.openTasks}${s.overdueTasks ? ` (просрочено ${s.overdueTasks})` : ''}`, tone: s.overdueTasks ? 'text-red-300' : undefined },
  ];
  const closed = s.wonDeals + s.lostDeals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {tiles.map(t => (
          <div key={t.label} className={`${card} p-4`}>
            <p className="text-xs text-slate-400">{t.label}</p>
            <p className={`text-lg font-semibold mt-1 ${t.tone ?? ''}`}>{t.value}</p>
          </div>
        ))}
      </div>
      <div className={`${card} p-4 space-y-2`}>
        <h4 className="text-sm font-semibold">Воронка</h4>
        {DEAL_STAGES.map(st => (
          <div key={st} className="flex items-center gap-3 text-sm">
            <span className="w-32 text-slate-400">{STAGE_LABELS[st]}</span>
            <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
              <div className={`h-full ${st === 'lost' ? 'bg-red-400/60' : st === 'won' ? 'bg-emerald-400/70' : 'bg-indigo-400/70'}`} style={{ width: `${(s.byStage[st].amount / maxStage) * 100}%` }} />
            </div>
            <span className="w-40 text-right text-slate-300">{s.byStage[st].count} · {money(s.byStage[st].amount)}</span>
          </div>
        ))}
        <p className="text-xs text-slate-500 pt-2">Конверсия закрытых сделок: {closed ? Math.round((s.wonDeals / closed) * 100) : 0}%</p>
      </div>
    </div>
  );
}

// ---------------- data ----------------

function DataTab() {
  useCRMVersion();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fromPhone = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await importPhoneContacts();
      setMessage(`Готово: добавлено ${r.added}, обновлено ${r.merged}, без изменений ${r.skipped} из ${r.total}.`);
    } catch (err: any) {
      setMessage(err?.message || 'Импорт не удался');
    } finally { setBusy(false); }
  };

  const readFile = (handler: (text: string) => string) => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { setMessage(handler(await file.text())); } catch (err: any) { setMessage(err?.message || 'Не удалось прочитать файл'); }
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
      <div className={`${card} p-4 space-y-2`}>
        <h4 className="font-semibold flex items-center gap-2"><Smartphone className="w-4 h-4" />Контакты с телефона</h4>
        <p className="text-sm text-slate-400">Нужен подключённый телефон (страница «Телефон»). Дубли по номеру объединяются.</p>
        <button className={btnPrimary} onClick={fromPhone} disabled={busy}>{busy ? 'Импортирую…' : 'Импортировать с телефона'}</button>
      </div>
      <div className={`${card} p-4 space-y-2`}>
        <h4 className="font-semibold">CSV (Excel, Google Таблицы)</h4>
        <p className="text-sm text-slate-400">Колонки: Имя, Телефоны, E-mail, Компания.</p>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => download(`crm-contacts-${stamp}.csv`, '\uFEFF' + crmStore.exportContactsCSV(), 'text/csv;charset=utf-8')}><Download className="w-4 h-4" />Экспорт</button>
          <label className={`${btnGhost} cursor-pointer`}><Upload className="w-4 h-4" />Импорт
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={readFile(text => { const r = crmStore.importContactsCSV(text); return `CSV: добавлено ${r.added}, обновлено ${r.merged}, пропущено ${r.skipped}.`; })} />
          </label>
        </div>
      </div>
      <div className={`${card} p-4 space-y-2`}>
        <h4 className="font-semibold">Резервная копия</h4>
        <p className="text-sm text-slate-400">Все контакты, сделки и задачи одним файлом. Восстановление заменяет текущие данные.</p>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => download(`crm-backup-${stamp}.json`, crmStore.exportJSON(), 'application/json')}><Download className="w-4 h-4" />Сохранить</button>
          <label className={`${btnGhost} cursor-pointer`}><Upload className="w-4 h-4" />Восстановить
            <input type="file" accept=".json,application/json" className="hidden" onChange={readFile(text => {
              if (!window.confirm('Заменить все данные CRM содержимым файла?')) return 'Отменено';
              const r = crmStore.importJSON(text);
              return `Восстановлено: контактов ${r.contacts}, сделок ${r.deals}, записей ${r.activities}.`;
            })} />
          </label>
        </div>
      </div>
      <div className={`${card} p-4 space-y-2`}>
        <h4 className="font-semibold text-red-300">Очистить CRM</h4>
        <p className="text-sm text-slate-400">Удалит все данные на этом устройстве. Сначала сделайте резервную копию.</p>
        <button className={`${btnGhost} text-red-300`} onClick={() => { if (window.confirm('Удалить ВСЕ данные CRM?')) { crmStore.clearAll(); setMessage('CRM очищена'); } }}><Trash2 className="w-4 h-4" />Очистить</button>
      </div>
      {message && <p className="md:col-span-2 text-sm text-indigo-200">{message}</p>}
    </div>
  );
}

// ---------------- page ----------------

export default function CRMPage({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>('contacts');
  const version = useCRMVersion();
  const stats = useMemo(() => crmStore.stats(), [version]);
  const tabs: { id: Tab; label: string; icon: typeof Users; badge?: number }[] = [
    { id: 'contacts', label: 'Контакты', icon: Users, badge: stats.contacts },
    { id: 'deals', label: 'Сделки', icon: Briefcase, badge: stats.openDeals },
    { id: 'tasks', label: 'Задачи', icon: CheckSquare, badge: stats.openTasks },
    { id: 'summary', label: 'Сводка', icon: BarChart3 },
    { id: 'data', label: 'Данные', icon: Database },
  ];

  return (
    <div className="space-y-5 text-white">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6 text-indigo-400" />CRM Светланы</h2>
          <p className="text-sm text-slate-400">Данные хранятся только на этом устройстве. Светлана управляет CRM из чата.</p>
        </div>
        {onClose && <button onClick={onClose} className={btnGhost} aria-label="Закрыть CRM"><X className="w-4 h-4" />Закрыть</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`${btn} ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            <t.icon className="w-4 h-4" />{t.label}
            {t.badge ? <span className="ml-1 px-1.5 rounded-full bg-black/30 text-xs">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'deals' && <DealsTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'summary' && <SummaryTab />}
      {tab === 'data' && <DataTab />}
    </div>
  );
}
