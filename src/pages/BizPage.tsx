// Svetlana Business — деньги, документы, должники, налоги, господдержка, профиль.
// Доступность: у каждого поля есть подпись, ошибки читаются сразу (role=alert).
// Подтверждения и ввод номера чека — своё окно: в приложении системные confirm/prompt могут молча не сработать.
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Wallet, FileText, AlertTriangle, Calculator, Landmark, UserCog, Plus, Trash2, Printer, Download,
  Copy, Check, ExternalLink, Send, Receipt,
} from 'lucide-react';
import {
  bizStore, REGIME_LABELS, DOC_LABELS, DOC_STATUS_LABELS, NPD_LIMIT, formatRub, isTaxable,
  type TaxRegime, type DocType, type PayerType, type EntryKind, type BizProfile,
} from '../services/biz/BizStore';
import { renderDocumentHTML, paymentString } from '../services/biz/DocTemplates';
import { PAY_METHOD_LABELS, USN_RATE_LIMITS, contributionsFor, type PayMethod } from '../services/biz/TaxRules';
import {
  findSupport, regionalSearchUrl, SUPPORT_KIND_LABELS, SECTOR_LABELS, FLAG_LABELS, RUSSIAN_REGIONS, type SupportKind,
} from '../services/biz/SupportCatalog';
import { crmStore } from '../services/crm/CRMStore';
import { askConfirm, askText, showCopyText } from '../components/ConfirmDialog';

type Tab = 'money' | 'docs' | 'debts' | 'taxes' | 'support' | 'profile';

const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10`;
const card = 'rounded-xl bg-white/5 border border-white/10';
const MY_TAX_URL = 'https://lknpd.nalog.ru';

function useBizVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => bizStore.subscribe(() => setV(x => x + 1)), []);
  return v;
}

function date(ts?: number): string { return ts ? new Date(ts).toLocaleDateString('ru-RU') : ''; }

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printHTML(html: string): void {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 2000); }, 300);
}

function CopyButton({ text, label = 'Копировать' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className={btnGhost} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { void showCopyText('Скопируйте текст:', text); }
    }}>{done ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}<span role={done ? 'status' : undefined}>{done ? 'Скопировано' : label}</span></button>
  );
}

/** Кнопка «Оплачен»: для самозанятого сначала спрашивает способ оплаты (от него зависит срок чека). */
function PaidButton({ docId, label = 'Оплачен' }: { docId: string; label?: string }) {
  const npd = bizStore.getProfile().regime === 'npd';
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [err, setErr] = useState<string | null>(null);
  const pay = () => {
    setErr(null);
    if (npd && !method) { setErr('Выберите, как заплатили'); return; }
    try { bizStore.markPaid(docId, { payMethod: method || undefined }); } catch (e: any) { setErr(e?.message || 'Не удалось отметить оплату'); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {npd && (
        <select className="px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white" aria-label="Способ оплаты" value={method} onChange={e => setMethod(e.target.value as PayMethod | '')}>
          <option value="">Как заплатили?</option>
          {(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map(m => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
        </select>
      )}
      <button className={btnPrimary} onClick={pay}><Check className="w-4 h-4" aria-hidden="true" />{label}</button>
      {err && <span role="alert" className="text-xs text-amber-300">{err}</span>}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className={`${card} p-4 min-w-0`}><p className="text-xs text-slate-400">{label}</p><p className={`text-lg font-semibold mt-1 break-words ${tone ?? ''}`}>{value}</p></div>;
}

// ---------------- money ----------------

function MoneyTab() {
  useBizVersion();
  const [kind, setKind] = useState<EntryKind>('income');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [client, setClient] = useState('');
  const [payerType, setPayerType] = useState<PayerType>('person');
  const [payMethod, setPayMethod] = useState<PayMethod>('transfer');
  const [day, setDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const profile = bizStore.getProfile();
  const o = bizStore.overview();
  const entries = bizStore.listEntries().slice(0, 200);
  const contacts = crmStore.listContacts();

  const add = (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      const contact = contacts.find(c => c.name === client.trim());
      bizStore.addEntry({
        kind, amount: Number(amount.replace(/\s/g, '').replace(',', '.')), description,
        date: day ? new Date(`${day}T12:00`).getTime() : undefined,
        payerType, counterparty: client, contactId: contact?.id, payMethod: kind === 'income' ? payMethod : undefined,
      });
      setAmount(''); setDescription(''); setClient('');
    } catch (err: any) { setError(err?.message || 'Не удалось сохранить'); }
  };

  const askReceipt = async (id: string) => {
    const n = await askText('Чек выбит в «Мой налог»? Номер чека (можно пусто):', { okText: 'Чек выбит', value: '' });
    if (n === null) return;
    setError(null);
    try { bizStore.setReceipt(id, n); } catch (err: any) { setError(err?.message || 'Не удалось сохранить чек'); }
  };

  const removeEntry = async (id: string, what: string) => {
    const ok = await askConfirm(`Удалить запись${what ? ` «${what}»` : ''}?`, { okText: 'Удалить' });
    if (!ok) return;
    setError(null);
    try { bizStore.deleteEntry(id); } catch (err: any) { setError(err?.message || 'Не удалось удалить запись'); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Доход за месяц" value={formatRub(o.monthIncome)} tone="text-emerald-300" />
        <Stat label="Расходы за месяц" value={formatRub(o.monthExpenses)} />
        <Stat label="Доход за год" value={formatRub(o.yearIncome)} />
        <Stat label="Прибыль за год" value={formatRub(o.profitYear)} />
      </div>
      <form onSubmit={add} className={`${card} p-4 grid grid-cols-1 md:grid-cols-6 gap-3`} aria-label="Новая запись дохода или расхода">
        <select className={input} aria-label="Доход или расход" value={kind} onChange={e => setKind(e.target.value as EntryKind)}>
          <option value="income">Доход</option><option value="expense">Расход</option>
        </select>
        <input className={input} placeholder="Сумма, ₽ *" aria-label="Сумма в рублях (обязательно)" aria-required="true" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        <input className={`${input} md:col-span-2`} placeholder="За что" aria-label="За что" value={description} onChange={e => setDescription(e.target.value)} />
        <input className={input} placeholder={kind === 'income' ? 'Клиент' : 'Кому'} aria-label={kind === 'income' ? 'Клиент' : 'Кому заплатили'} list="biz-clients" value={client} onChange={e => setClient(e.target.value)} />
        <input type="date" className={input} aria-label="Дата (пусто — сегодня)" value={day} onChange={e => setDay(e.target.value)} />
        <datalist id="biz-clients">{contacts.map(c => <option key={c.id} value={c.name} />)}</datalist>
        {kind === 'income' && (
          <select className={`${input} md:col-span-2`} aria-label="Кто платит" value={payerType} onChange={e => setPayerType(e.target.value as PayerType)}>
            <option value="person">Платит физлицо{profile.regime === 'npd' ? ' (НПД 4%)' : ''}</option>
            <option value="company">Платит юрлицо или ИП{profile.regime === 'npd' ? ' (НПД 6%)' : ''}</option>
          </select>
        )}
        {kind === 'income' && profile.regime === 'npd' && (
          <select className={`${input} md:col-span-2`} aria-label="Способ оплаты" value={payMethod} onChange={e => setPayMethod(e.target.value as PayMethod)}>
            {(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map(m => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}{m === 'transfer' ? ' (чек до 9-го числа)' : ' (чек в момент оплаты)'}</option>)}
          </select>
        )}
        <button type="submit" className={`${btnPrimary} justify-center`} disabled={!amount.trim()}><Plus className="w-4 h-4" aria-hidden="true" />Записать</button>
        {error && <p role="alert" className="md:col-span-6 text-sm text-red-400">{error}</p>}
      </form>
      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} onClick={() => download(`kudir-${new Date().getFullYear()}.csv`, '\uFEFF' + bizStore.exportLedgerCSV(new Date().getFullYear()), 'text/csv;charset=utf-8')}><Download className="w-4 h-4" aria-hidden="true" />Книга доходов и расходов (CSV)</button>
        {profile.regime === 'npd' && <a className={btnGhost} href={MY_TAX_URL} target="_blank" rel="noreferrer"><Receipt className="w-4 h-4" aria-hidden="true" />Открыть «Мой налог»</a>}
      </div>
      <div className={`${card} divide-y divide-white/5`}>
        {entries.length === 0 && <p className="p-4 text-sm text-slate-400">Пока пусто. Скажите Светлане: «Получил 5000 от Петрова за урок».</p>}
        {entries.map(e => (
          // На телефоне две строки: дата, описание и сумма сверху, пометки и удаление снизу. На широком экране одна.
          <div key={e.id} className="px-4 py-2.5 text-sm flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-center gap-3 min-w-0 sm:flex-1">
              <span className="w-20 sm:w-24 shrink-0 text-slate-400">{date(e.date)}</span>
              <span className={`flex-1 min-w-0 truncate ${isTaxable(e) ? '' : 'text-slate-400 line-through'}`}>{e.description}{e.counterparty ? ` · ${e.counterparty}` : ''}{isTaxable(e) ? '' : <span className="sr-only"> (не учитывается в налоге)</span>}</span>
              <span className={`shrink-0 sm:w-32 text-right font-medium ${e.kind === 'income' ? 'text-emerald-300' : 'text-red-300'}`}>{e.kind === 'income' ? '+' : '−'}{formatRub(e.amount)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 sm:shrink-0">
              <button className="py-1 text-xs text-slate-400 hover:underline" title="Перевод себе, займ, возврат и т.п. не учитываются в налоге" onClick={() => bizStore.setTaxable(e.id, !isTaxable(e))}>
                {isTaxable(e) ? (e.kind === 'income' ? 'не доход?' : 'не расход?') : 'учитывать'}
              </button>
              {e.kind === 'expense' && isTaxable(e) && profile.regime === 'usn15' && (
                <button className={`py-1 text-xs hover:underline ${e.noDocs ? 'text-amber-300' : 'text-slate-400'}`} aria-pressed={!e.noDocs} title="Расход уменьшает налог УСН 15% только при подтверждающих документах: чек, акт, накладная, выписка" onClick={() => bizStore.setNoDocs(e.id, !e.noDocs)}>
                  {e.noDocs ? 'нет документов' : 'есть документы'}
                </button>
              )}
              {e.kind === 'income' && isTaxable(e) && profile.regime === 'npd' && (
                e.receipt === 'issued'
                  ? <span className="text-xs text-emerald-300">чек {e.receiptNumber ?? 'выбит'}</span>
                  : <button className="py-1 text-xs text-amber-300 hover:underline" onClick={() => { void askReceipt(e.id); }}>нет чека</button>
              )}
              <button onClick={() => { void removeEntry(e.id, e.description); }} className="p-1.5 text-slate-400 hover:text-red-300" aria-label={`Удалить запись: ${e.description || formatRub(e.amount)}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- documents ----------------

function DocsTab() {
  useBizVersion();
  const [type, setType] = useState<DocType>('invoice');
  const [client, setClient] = useState('');
  const [details, setDetails] = useState('');
  const [service, setService] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [basis, setBasis] = useState('');
  const [error, setError] = useState<string | null>(null);
  const profile = bizStore.getProfile();
  const docs = bizStore.listDocuments();
  const contacts = crmStore.listContacts();

  const add = (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      const contact = contacts.find(c => c.name === client.trim());
      bizStore.createDocument({
        type, clientName: client, contactId: contact?.id,
        clientDetails: details || (contact ? [contact.company, contact.phones[0], contact.emails[0]].filter(Boolean).join(', ') : ''),
        items: [{ name: service, qty: Number(qty.replace(',', '.')), price: Number(price.replace(/\s/g, '').replace(',', '.')) }],
        basis: basis || undefined,
      });
      setService(''); setPrice(''); setQty('1');
    } catch (err: any) { setError(err?.message || 'Не удалось создать документ'); }
  };

  const removeDoc = async (id: string, title: string) => {
    const ok = await askConfirm(`Удалить ${title}?`, { okText: 'Удалить' });
    if (!ok) return;
    setError(null);
    try { bizStore.deleteDocument(id); } catch (err: any) { setError(err?.message || 'Не удалось удалить документ'); }
  };

  const markSent = (id: string) => {
    setError(null);
    try { bizStore.setDocumentStatus(id, 'sent'); } catch (err: any) { setError(err?.message || 'Не удалось изменить статус'); }
  };

  return (
    <div className="space-y-4">
      {!profile.fullName && <p className="text-sm text-amber-300">Заполните профиль (ФИО, ИНН, банк), чтобы реквизиты попали в документы.</p>}
      <form onSubmit={add} className={`${card} p-4 grid grid-cols-1 md:grid-cols-4 gap-3`} aria-label="Новый документ">
        <select className={input} aria-label="Вид документа" value={type} onChange={e => setType(e.target.value as DocType)}>
          <option value="invoice">Счёт на оплату</option><option value="act">Акт оказанных услуг</option><option value="contract">Договор оказания услуг</option>
        </select>
        <input className={input} placeholder="Клиент *" aria-label="Клиент (обязательно)" aria-required="true" list="biz-doc-clients" value={client} onChange={e => setClient(e.target.value)} />
        <datalist id="biz-doc-clients">{contacts.map(c => <option key={c.id} value={c.name} />)}</datalist>
        <input className={`${input} md:col-span-2`} placeholder="Реквизиты клиента (ИНН, адрес) — необязательно" aria-label="Реквизиты клиента, необязательно" value={details} onChange={e => setDetails(e.target.value)} />
        <input className={`${input} md:col-span-2`} placeholder="Услуга *" aria-label="Услуга (обязательно)" aria-required="true" value={service} onChange={e => setService(e.target.value)} />
        <input className={input} placeholder="Кол-во" aria-label="Количество" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />
        <input className={input} placeholder="Цена, ₽ *" aria-label="Цена в рублях (обязательно)" aria-required="true" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
        <input className={`${input} md:col-span-3`} placeholder="Основание (например, «Договор № 1 от 01.10.2026»)" aria-label="Основание, необязательно" value={basis} onChange={e => setBasis(e.target.value)} />
        <button type="submit" className={`${btnPrimary} justify-center`} disabled={!client.trim() || !service.trim() || !price.trim()}><Plus className="w-4 h-4" aria-hidden="true" />Создать</button>
        {error && <p role="alert" className="md:col-span-4 text-sm text-red-400">{error}</p>}
      </form>
      <div className={`${card} divide-y divide-white/5`}>
        {docs.length === 0 && <p className="p-4 text-sm text-slate-400">Документов нет. Скажите Светлане: «Выставь счёт Иванову на 15000 за дизайн».</p>}
        {docs.map(d => {
          const html = () => renderDocumentHTML(d, bizStore.getProfile());
          const title = `${DOC_LABELS[d.type]} № ${d.number} от ${date(d.date)}`;
          return (
            <div key={d.id} className="px-4 py-3 text-sm flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px]">
                <p className="font-medium">{title} · {d.clientName}</p>
                <p className="text-xs text-slate-400">{formatRub(d.total)} · {DOC_STATUS_LABELS[d.status]}{d.dueDate && d.status !== 'paid' ? ` · оплатить до ${date(d.dueDate)}` : ''}</p>
              </div>
              <button className={btnGhost} onClick={() => printHTML(html())} aria-label={`Печать или PDF: ${title}`}><Printer className="w-4 h-4" aria-hidden="true" />Печать / PDF</button>
              <button className={btnGhost} onClick={() => download(`${DOC_LABELS[d.type]}-${d.number}.html`, html(), 'text/html;charset=utf-8')} aria-label={`Скачать файл: ${title}`}><Download className="w-4 h-4" aria-hidden="true" />Файл</button>
              {d.type === 'invoice' && d.status !== 'cancelled' && profile.account && (() => { try { return <CopyButton text={paymentString(profile, d.total, `Оплата по счёту № ${d.number} от ${date(d.date)}`)} label="Строка для QR" />; } catch (err: any) { return <span className="text-xs text-amber-300">{err?.message}</span>; } })()}
              {d.type === 'invoice' && d.status === 'draft' && <button className={btnGhost} onClick={() => markSent(d.id)}><Send className="w-4 h-4" aria-hidden="true" />Отправлен</button>}
              {d.type === 'invoice' && d.status !== 'paid' && d.status !== 'cancelled' && <PaidButton docId={d.id} />}
              <button onClick={() => { void removeDoc(d.id, title); }} className="p-2 text-slate-400 hover:text-red-300" aria-label={`Удалить: ${title}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- debts ----------------

function DebtsTab() {
  useBizVersion();
  const list = bizStore.receivables();
  const total = list.reduce((s, r) => s + r.document.total, 0);
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Вам должны" value={formatRub(total)} />
        <Stat label="Из них просрочено" value={formatRub(list.filter(r => r.daysOverdue > 0).reduce((s, r) => s + r.document.total, 0))} tone="text-red-300" />
      </div>
      {list.length === 0 && <div className={`${card} p-6 text-center text-slate-400`}>Неоплаченных счетов нет 👍</div>}
      {list.map(({ document: d, daysOverdue }) => {
        const text = bizStore.reminderText(d.id);
        const phone = d.contactId ? crmStore.getContact(d.contactId)?.phones[0]?.replace(/[^\d+]/g, '') : undefined;
        return (
          <div key={d.id} className={`${card} p-4 space-y-2`}>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
              <p className="font-medium min-w-0 break-words">{d.clientName} · счёт № {d.number} · {formatRub(d.total)}</p>
              <span className={`text-sm ${daysOverdue ? 'text-red-300' : 'text-slate-400'}`}>{daysOverdue ? `просрочка ${daysOverdue} дн.` : `до ${date(d.dueDate)}`}</span>
            </div>
            <p className="text-sm text-slate-300 whitespace-pre-line break-words bg-black/20 rounded-lg p-3">{text}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={text} />
              <a className={btnGhost} href={`https://t.me/share/url?url=&text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Send className="w-4 h-4" aria-hidden="true" />Telegram</a>
              {phone && <a className={btnGhost} href={`https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
              {phone && <a className={btnGhost} href={`sms:${phone}?body=${encodeURIComponent(text)}`}>SMS</a>}
              <PaidButton docId={d.id} label="Оплатили" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- taxes ----------------

function TaxesTab() {
  useBizVersion();
  const profile = bizStore.getProfile();
  const deadlines = bizStore.deadlines(120);
  return (
    <div className="space-y-4 max-w-4xl">
      {profile.regime === 'none' && <p className="text-sm text-amber-300">Выберите налоговый режим во вкладке «Профиль».</p>}
      {profile.regime === 'npd' && (() => {
        const n = bizStore.npdSummary();
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label={`Доход ${n.year}`} value={formatRub(n.income)} />
              <Stat label="Налог за год" value={formatRub(n.taxYear)} />
              <Stat label="Осталось вычета" value={formatRub(n.deductionLeft)} />
              <Stat label="Чеков не выбито" value={String(n.receiptsMissing)} tone={n.receiptsMissing ? 'text-amber-300' : undefined} />
            </div>
            <div className={`${card} p-4`}>
              <p className="text-sm mb-2">Лимит дохода НПД: {formatRub(n.income)} из {formatRub(NPD_LIMIT)}</p>
              <div className="h-2.5 rounded-full bg-white/5 overflow-hidden" aria-hidden="true"><div className={`h-full ${n.income > NPD_LIMIT * 0.85 ? 'bg-red-400' : 'bg-emerald-400/70'}`} style={{ width: `${Math.min(100, (n.income / NPD_LIMIT) * 100)}%` }} /></div>
              {n.limitExceeded && <p className="text-sm text-red-300 mt-2">Доход превысил 2,4 млн ₽: право на НПД утрачено с даты превышения. {/^\d{12}$/.test(profile.inn) && profile.ogrn ? 'ИП может в течение 20 дней подать уведомление о переходе на УСН, иначе — общий режим.' : 'Без статуса ИП дальнейший доход облагается НДФЛ по прогрессивной шкале (13–22%); чтобы работать на УСН, зарегистрируйте ИП.'}</p>}
              {!n.limitExceeded && n.income === NPD_LIMIT && <p className="text-sm text-amber-300 mt-2">Лимит исчерпан ровно: любой следующий доход в этом году лишит права на НПД.</p>}
            </div>
            <div className={`${card} divide-y divide-white/5`}>
              {n.months.map(m => (
                <div key={m.month} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>{m.month}</span>
                  <span className="text-slate-400">физлица {formatRub(m.fromPersons)} · юрлица {formatRub(m.fromCompanies)}</span>
                  <span>налог {formatRub(m.tax)}{m.payable ? ` → к оплате ${formatRub(m.payable)} до ${date(m.dueDate)}` : ' (меньше 100 ₽, перенос)'}</span>
                </div>
              ))}
              {n.months.length === 0 && <p className="p-4 text-sm text-slate-400">Доходов в этом году нет.</p>}
            </div>
            <a className={btnGhost} href={MY_TAX_URL} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />«Мой налог» — выбить чеки и оплатить</a>
          </>
        );
      })()}
      {(profile.regime === 'usn6' || profile.regime === 'usn15') && (() => {
        const u = bizStore.usnSummary();
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label={`Доход ${u.year}`} value={formatRub(u.income)} />
              {u.regime === 'usn15' && <Stat label="Расходы" value={formatRub(u.expenses)} />}
              <Stat label={`Налог ${u.rate}% до вычета взносов`} value={formatRub(u.taxGross)} />
              <Stat label="Налог к уплате (оценка)" value={formatRub(u.taxAfterContributions)} tone="text-amber-300" />
            </div>
            <div className={`${card} p-4 text-sm space-y-1`}>
              <p>Фиксированные взносы {u.year}: {formatRub(u.contributionsFixed)}, 1% с дохода свыше 300 000 ₽ за {u.year}: {formatRub(u.contributionsExtra)} (срок — 1 июля {u.year + 1}).</p>
              {u.regime === 'usn6'
                ? <p className="text-slate-400">Налог УСН 6% уменьшается на взносы, уплачиваемые в {u.year} году: фиксированные {formatRub(u.contributionsFixed)}{u.contributionsPrevExtra ? ` + 1% за ${u.year - 1} год ${formatRub(u.contributionsPrevExtra)}` : ''}. {u.hasEmployees ? 'Есть работники: уменьшить можно не более чем на 50% налога.' : 'ИП без работников уменьшает налог на всю сумму.'} Уменьшено на {formatRub(u.contributionsDeducted)}.</p>
                : <p className="text-slate-400">На УСН 15% взносы за себя ({formatRub(u.contributionsDeducted)}) входят в расходы; минимальный налог 1% дохода ({formatRub(u.minTax)}) платится, если он больше обычного.</p>}
              <p className="text-slate-400">Ставка {u.rate}%{u.rate !== (u.regime === 'usn6' ? 6 : 15) ? ' (региональная льгота из профиля)' : ' (базовая; в вашем регионе для вашего вида деятельности может быть ниже — проверьте закон субъекта и укажите ставку в профиле)'}.</p>
              {u.regime === 'usn15' && <p className="text-slate-400">В расходы взяты только операции с документами (чек, акт, накладная, выписка) и связанные с бизнесом.{u.expensesNoDocs ? ` Без документов и не учтено: ${formatRub(u.expensesNoDocs)}.` : ''}</p>}
              <p className={u.vat.status === 'exempt' ? 'text-slate-400' : 'text-amber-300'}>НДС: {u.vat.text}</p>
              {u.quarters.map(q => <p key={q.quarter} className="text-slate-300">{q.quarter === 4 ? 'Год' : `${q.quarter * 3} мес.`}: доход {formatRub(q.income)}, налог нарастающим итогом до вычета взносов {formatRub(q.taxCumulative)}</p>)}
            </div>
          </>
        );
      })()}
      {profile.regime === 'patent' && <p className="text-sm text-slate-300">Стоимость патента зависит от региона и вида деятельности: калькулятор ФНС на <a className="text-indigo-300 underline" href="https://patent.nalog.ru" target="_blank" rel="noreferrer">patent.nalog.ru</a>. Доходы ведите во вкладке «Деньги» — нужен лимит 60 млн ₽ и книга учёта.</p>}
      {profile.regime === 'ooo' && <p className="text-sm text-slate-300">Для ООО Светлана ведёт доходы, документы и должников; бухгалтерскую и налоговую отчётность ООО лучше доверить бухгалтеру или сервису.</p>}
      <div className={`${card} p-4`}>
        <h4 className="font-semibold mb-2">Ближайшие сроки</h4>
        {deadlines.length === 0 && <p className="text-sm text-slate-400">Нет сроков на ближайшие 4 месяца (или режим не выбран).</p>}
        {deadlines.map(dl => <p key={`${dl.date}-${dl.title}`} className="text-sm"><b>{date(dl.date)}</b> · {dl.title}{dl.details ? <span className="text-slate-400"> — {dl.details}</span> : null}</p>)}
        <p className="text-xs text-slate-400 mt-2">Если срок выпадает на выходной, он переносится на следующий рабочий день. Расчёты — оценка, не замена бухгалтеру.</p>
      </div>
    </div>
  );
}

// ---------------- support ----------------

function SupportTab({ goProfile }: { goProfile: () => void }) {
  useBizVersion();
  const [kind, setKind] = useState<SupportKind | ''>('');
  const [query, setQuery] = useState('');
  const profile = bizStore.getProfile();
  const now = bizStore.now();
  const matches = findSupport(profile, now, { kind: kind || undefined, query });
  return (
    <div className="space-y-4 max-w-5xl">
      <div className={`${card} p-4 flex flex-wrap items-center gap-3 text-sm`}>
        <span>Подбор для: <b>{REGIME_LABELS[profile.regime]}</b>{profile.region ? <>, <b>{profile.region}</b></> : ', регион не выбран'}</span>
        <button className={btnGhost} onClick={goProfile}><UserCog className="w-4 h-4" aria-hidden="true" />Изменить профиль</button>
        <a className={btnPrimary} href={regionalSearchUrl(profile, now)} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />Найти программы региона</a>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className={`${input} sm:w-56`} aria-label="Вид поддержки" value={kind} onChange={e => setKind(e.target.value as SupportKind | '')}>
          <option value="">Все виды поддержки</option>
          {(Object.keys(SUPPORT_KIND_LABELS) as SupportKind[]).map(k => <option key={k} value={k}>{SUPPORT_KIND_LABELS[k]}</option>)}
        </select>
        <input type="search" className={`${input} sm:w-64`} placeholder="Поиск" aria-label="Поиск по мерам поддержки" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <p className="sr-only" role="status">Найдено мер поддержки: {matches.length}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {matches.map(({ measure: m, reasons }) => (
          <div key={m.id} className={`${card} p-4 space-y-2`}>
            <div className="flex justify-between gap-2">
              <h4 className="font-semibold">{m.title}</h4>
              <span className="text-xs px-2 py-0.5 h-fit rounded-full bg-indigo-500/15 text-indigo-200 shrink-0">{SUPPORT_KIND_LABELS[m.kind]}</span>
            </div>
            {m.amount && <p className="text-sm text-emerald-300">{m.amount}</p>}
            <p className="text-sm text-slate-300">{m.summary}</p>
            {reasons.length > 0 && <p className="text-xs text-amber-200">Почему вам: {reasons.join('; ')}</p>}
            <p className="text-xs text-slate-400">Как получить: {m.howTo}</p>
            <a className="text-sm text-indigo-300 hover:underline inline-flex items-center gap-1" href={m.url} target="_blank" rel="noreferrer">{m.provider} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>
          </div>
        ))}
        {matches.length === 0 && <p className="text-sm text-slate-400">Под ваш профиль ничего не нашлось. Уточните режим, возраст, отрасли и статусы в профиле.</p>}
      </div>
      <p className="text-xs text-slate-400">Каталог содержит основные федеральные программы. Суммы и условия меняются ежегодно и различаются по регионам: перед подачей сверяйте на официальном сайте или в центре «Мой бизнес».</p>
    </div>
  );
}

// ---------------- profile ----------------

/** Числовые поля профиля хранятся в форме строкой: «12 000» или «6,5» не превращаются молча в 0. */
type NumKey = 'fixedContributions' | 'contributionsPaid' | 'patentCost' | 'birthYear' | 'usnRate';
const NUM_LABELS: Record<NumKey, string> = {
  fixedContributions: 'Фиксированные взносы',
  contributionsPaid: 'Уже уплачено взносов',
  patentCost: 'Стоимость патента',
  birthYear: 'Год рождения',
  usnRate: 'Ставка УСН',
};

/** Пусто → undefined, не число или меньше нуля → null. */
export function parseProfileNumber(raw: string): number | undefined | null {
  const t = raw.replace(/\s/g, '').replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function initialProfile(): BizProfile {
  const p = bizStore.getProfile();
  const y = new Date().getFullYear();
  return p.fixedContributionsYear === y ? p : { ...p, fixedContributions: contributionsFor(y).fixed };
}

function numText(v: number | undefined): string { return v === undefined || v === null || !Number.isFinite(v) ? '' : String(v); }

function ProfileTab() {
  useBizVersion();
  const [draft, setDraft] = useState<BizProfile>(initialProfile);
  const [nums, setNums] = useState<Record<NumKey, string>>(() => {
    const p = initialProfile();
    return {
      fixedContributions: numText(p.fixedContributions),
      contributionsPaid: numText(p.contributionsPaid),
      patentCost: numText(p.patentCost),
      birthYear: p.birthYear ? String(p.birthYear) : '',
      usnRate: numText(p.usnRate),
    };
  });
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const set = (k: keyof BizProfile) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft(d => ({ ...d, [k]: e.target.value }));
  const setNum = (k: NumKey) => (e: ChangeEvent<HTMLInputElement>) => setNums(n => ({ ...n, [k]: e.target.value }));
  const toggle = (k: 'sectors' | 'flags', v: string) => setDraft(d => ({ ...d, [k]: d[k].includes(v) ? d[k].filter(x => x !== v) : [...d[k], v] }));

  const save = (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    const parsed = {} as Record<NumKey, number | undefined>;
    for (const k of Object.keys(NUM_LABELS) as NumKey[]) {
      const v = parseProfileNumber(nums[k]);
      if (v === null) { setMsg({ text: `${NUM_LABELS[k]}: укажите число цифрами`, error: true }); return; }
      parsed[k] = v;
    }
    if (parsed.birthYear !== undefined && parsed.birthYear !== 0 && (!Number.isInteger(parsed.birthYear) || parsed.birthYear < 1900 || parsed.birthYear > new Date().getFullYear())) {
      setMsg({ text: 'Год рождения: четыре цифры, например 1990', error: true }); return;
    }
    try {
      bizStore.updateProfile({
        ...draft,
        birthYear: parsed.birthYear || undefined,
        fixedContributions: parsed.fixedContributions ?? 0,
        fixedContributionsYear: new Date().getFullYear(),
        contributionsPaid: parsed.contributionsPaid ?? 0,
        patentCost: parsed.patentCost ?? 0,
        usnRate: parsed.usnRate,
      });
      setMsg({ text: 'Сохранено', error: false });
    } catch (err: any) { setMsg({ text: err?.message || 'Не удалось сохранить профиль', error: true }); }
  };

  return (
    <form onSubmit={save} className="space-y-4 max-w-4xl" aria-label="Профиль бизнеса">
      <div className={`${card} p-4 grid grid-cols-1 md:grid-cols-2 gap-3`}>
        <label className="text-sm space-y-1"><span className="text-slate-400">Налоговый режим</span>
          <select className={input} value={draft.regime} onChange={e => setDraft(d => ({ ...d, regime: e.target.value as TaxRegime }))}>
            {(Object.keys(REGIME_LABELS) as TaxRegime[]).map(r => <option key={r} value={r}>{REGIME_LABELS[r]}</option>)}
          </select>
        </label>
        <label className="text-sm space-y-1"><span className="text-slate-400">Регион</span>
          <input className={input} list="ru-regions" placeholder="Начните вводить" value={draft.region} onChange={set('region')} />
          <datalist id="ru-regions">{RUSSIAN_REGIONS.map(r => <option key={r} value={r} />)}</datalist>
        </label>
        <input className={input} placeholder="ФИО или название" aria-label="ФИО или название" value={draft.fullName} onChange={set('fullName')} />
        <input className={input} placeholder="ИНН" aria-label="ИНН" inputMode="numeric" value={draft.inn} onChange={set('inn')} />
        <input className={input} placeholder="ОГРНИП / ОГРН (если есть)" aria-label="ОГРНИП или ОГРН, если есть" value={draft.ogrn} onChange={set('ogrn')} />
        <input className={input} placeholder="Адрес" aria-label="Адрес" value={draft.address} onChange={set('address')} />
        <input className={input} placeholder="Телефон" aria-label="Телефон" inputMode="tel" value={draft.phone} onChange={set('phone')} />
        <input className={input} placeholder="E-mail" aria-label="E-mail" inputMode="email" value={draft.email} onChange={set('email')} />
        <input className={input} placeholder="Банк" aria-label="Банк" value={draft.bankName} onChange={set('bankName')} />
        <input className={input} placeholder="БИК" aria-label="БИК" inputMode="numeric" value={draft.bik} onChange={set('bik')} />
        <input className={input} placeholder="Расчётный счёт (20 цифр)" aria-label="Расчётный счёт, 20 цифр" inputMode="numeric" value={draft.account} onChange={set('account')} />
        <input className={input} placeholder="Корр. счёт" aria-label="Корреспондентский счёт" inputMode="numeric" value={draft.corrAccount} onChange={set('corrAccount')} />
        <input className={input} placeholder="Год рождения (для молодёжных грантов)" aria-label="Год рождения, для молодёжных грантов" inputMode="numeric" value={nums.birthYear} onChange={setNum('birthYear')} />
        {(draft.regime === 'usn6' || draft.regime === 'usn15' || draft.regime === 'patent') && (
          <>
            <label className="text-sm space-y-1"><span className="text-slate-400">Фиксированные взносы ИП за год, ₽</span>
              <input className={input} inputMode="decimal" value={nums.fixedContributions} onChange={setNum('fixedContributions')} /></label>
            <label className="text-sm space-y-1"><span className="text-slate-400">Уже уплачено взносов в этом году, ₽</span>
              <input className={input} inputMode="decimal" value={nums.contributionsPaid} onChange={setNum('contributionsPaid')} /></label>
          </>
        )}
        {(draft.regime === 'usn6' || draft.regime === 'usn15' || draft.regime === 'patent' || draft.regime === 'ooo') && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.hasEmployees} onChange={e => setDraft(d => ({ ...d, hasEmployees: e.target.checked }))} />Есть работники</label>
        )}
        {(draft.regime === 'usn6' || draft.regime === 'usn15') && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.vatGeneralRate} onChange={e => setDraft(d => ({ ...d, vatGeneralRate: e.target.checked }))} />НДС по общей ставке (22% с 2026 года) с вычетами вместо 5%/7%</label>
        )}
        {(draft.regime === 'usn6' || draft.regime === 'usn15') && (() => {
          const l = draft.regime === 'usn15' ? USN_RATE_LIMITS.usn15 : USN_RATE_LIMITS.usn6;
          return (
            <label className="text-sm space-y-1"><span className="text-slate-400">Ставка УСН в вашем регионе, % (пусто — {l.base}%; допустимо {l.min}–{l.max}%)</span>
              <input className={input} inputMode="decimal" placeholder={String(l.base)} value={nums.usnRate} onChange={setNum('usnRate')} /></label>
          );
        })()}
        {draft.regime === 'usn15' && (
          <label className="text-sm space-y-1"><span className="text-slate-400">1% взносов учитывать в расходах</span>
            <select className={input} value={draft.usn15OnePercentTiming} onChange={e => setDraft(d => ({ ...d, usn15OnePercentTiming: e.target.value === 'next' ? 'next' : 'same' }))}>
              <option value="same">в году начисления (за который он считается)</option>
              <option value="next">в году уплаты (следующем)</option>
            </select></label>
        )}
        {(draft.regime === 'usn6' || draft.regime === 'usn15' || draft.regime === 'ooo') && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.orgOnUsn} onChange={e => setDraft(d => ({ ...d, orgOnUsn: e.target.checked }))} />Это организация (ООО) на УСН</label>
        )}
        {draft.regime === 'patent' && (
          <>
            <label className="text-sm space-y-1"><span className="text-slate-400">Патент действует с</span>
              <input className={input} type="date" value={draft.patentStart} onChange={set('patentStart')} /></label>
            <label className="text-sm space-y-1"><span className="text-slate-400">по</span>
              <input className={input} type="date" aria-label="Патент действует по" value={draft.patentEnd} onChange={set('patentEnd')} /></label>
            <label className="text-sm space-y-1"><span className="text-slate-400">Стоимость патента, ₽ (калькулятор на patent.nalog.ru)</span>
              <input className={input} inputMode="decimal" value={nums.patentCost} onChange={setNum('patentCost')} /></label>
          </>
        )}
      </div>
      <div className={`${card} p-4`}>
        <p id="biz-sectors" className="text-sm text-slate-400 mb-2">Сферы деятельности</p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="biz-sectors">{Object.entries(SECTOR_LABELS).map(([k, l]) => (
          <button type="button" key={k} onClick={() => toggle('sectors', k)} aria-pressed={draft.sectors.includes(k)} className={`px-3 py-1.5 rounded-full text-xs border ${draft.sectors.includes(k) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-slate-300'}`}>{l}</button>
        ))}</div>
        <p id="biz-flags" className="text-sm text-slate-400 mt-4 mb-2">Особые статусы (влияют на подбор поддержки, хранятся только на устройстве)</p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="biz-flags">{Object.entries(FLAG_LABELS).map(([k, l]) => (
          <button type="button" key={k} onClick={() => toggle('flags', k)} aria-pressed={draft.flags.includes(k)} className={`px-3 py-1.5 rounded-full text-xs border ${draft.flags.includes(k) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-slate-300'}`}>{l}</button>
        ))}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary}>Сохранить профиль</button>
        <button type="button" className={btnGhost} onClick={() => download(`biz-backup-${new Date().toISOString().slice(0, 10)}.json`, bizStore.exportJSON(), 'application/json')}><Download className="w-4 h-4" aria-hidden="true" />Резервная копия</button>
        {msg && <span role={msg.error ? 'alert' : 'status'} className={`text-sm ${msg.error ? 'text-red-400' : 'text-indigo-200'}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

// ---------------- page ----------------

export default function BizPage() {
  const [tab, setTab] = useState<Tab>(() => (bizStore.getProfile().regime === 'none' ? 'profile' : 'money'));
  useBizVersion();
  const debts = bizStore.receivables().length;
  const tabs: { id: Tab; label: string; icon: typeof Wallet; badge?: number }[] = [
    { id: 'money', label: 'Деньги', icon: Wallet },
    { id: 'docs', label: 'Документы', icon: FileText },
    { id: 'debts', label: 'Должники', icon: AlertTriangle, badge: debts },
    { id: 'taxes', label: 'Налоги', icon: Calculator },
    { id: 'support', label: 'Господдержка', icon: Landmark },
    { id: 'profile', label: 'Профиль', icon: UserCog },
  ];
  return (
    <div className="space-y-5 text-white">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Разделы бизнеса">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className={`${btn} ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            <t.icon className="w-4 h-4" aria-hidden="true" />{t.label}
            {t.badge ? <span className="ml-1 px-1.5 rounded-full bg-black/30 text-xs" aria-label={`неоплаченных: ${t.badge}`}>{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'money' && <MoneyTab />}
      {tab === 'docs' && <DocsTab />}
      {tab === 'debts' && <DebtsTab />}
      {tab === 'taxes' && <TaxesTab />}
      {tab === 'support' && <SupportTab goProfile={() => setTab('profile')} />}
      {tab === 'profile' && <ProfileTab />}
    </div>
  );
}
