// Svetlana Business — деньги, документы, должники, налоги, господдержка, профиль.
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Wallet, FileText, AlertTriangle, Calculator, Landmark, UserCog, Plus, Trash2, Printer, Download,
  Copy, Check, ExternalLink, Send, Receipt,
} from 'lucide-react';
import {
  bizStore, REGIME_LABELS, DOC_LABELS, DOC_STATUS_LABELS, NPD_LIMIT, formatRub,
  type TaxRegime, type DocType, type PayerType, type EntryKind, type BizProfile,
} from '../services/biz/BizStore';
import { renderDocumentHTML, paymentString } from '../services/biz/DocTemplates';
import {
  findSupport, regionalSearchUrl, SUPPORT_KIND_LABELS, SECTOR_LABELS, FLAG_LABELS, RUSSIAN_REGIONS, type SupportKind,
} from '../services/biz/SupportCatalog';
import { crmStore } from '../services/crm/CRMStore';

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
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { window.prompt('Скопируйте текст:', text); }
    }}>{done ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{done ? 'Скопировано' : label}</button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-slate-400">{label}</p><p className={`text-lg font-semibold mt-1 ${tone ?? ''}`}>{value}</p></div>;
}

// ---------------- money ----------------

function MoneyTab() {
  useBizVersion();
  const [kind, setKind] = useState<EntryKind>('income');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [client, setClient] = useState('');
  const [payerType, setPayerType] = useState<PayerType>('person');
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
        payerType, counterparty: client, contactId: contact?.id,
      });
      setAmount(''); setDescription(''); setClient('');
    } catch (err: any) { setError(err?.message || 'Не удалось сохранить'); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Доход за месяц" value={formatRub(o.monthIncome)} tone="text-emerald-300" />
        <Stat label="Расходы за месяц" value={formatRub(o.monthExpenses)} />
        <Stat label="Доход за год" value={formatRub(o.yearIncome)} />
        <Stat label="Прибыль за год" value={formatRub(o.profitYear)} />
      </div>
      <form onSubmit={add} className={`${card} p-4 grid grid-cols-1 md:grid-cols-6 gap-3`}>
        <select className={input} value={kind} onChange={e => setKind(e.target.value as EntryKind)}>
          <option value="income">Доход</option><option value="expense">Расход</option>
        </select>
        <input className={input} placeholder="Сумма, ₽ *" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        <input className={`${input} md:col-span-2`} placeholder="За что" value={description} onChange={e => setDescription(e.target.value)} />
        <input className={input} placeholder={kind === 'income' ? 'Клиент' : 'Кому'} list="biz-clients" value={client} onChange={e => setClient(e.target.value)} />
        <input type="date" className={input} value={day} onChange={e => setDay(e.target.value)} />
        <datalist id="biz-clients">{contacts.map(c => <option key={c.id} value={c.name} />)}</datalist>
        {kind === 'income' && (
          <select className={`${input} md:col-span-2`} value={payerType} onChange={e => setPayerType(e.target.value as PayerType)}>
            <option value="person">Платит физлицо{profile.regime === 'npd' ? ' (НПД 4%)' : ''}</option>
            <option value="company">Платит юрлицо или ИП{profile.regime === 'npd' ? ' (НПД 6%)' : ''}</option>
          </select>
        )}
        <button type="submit" className={`${btnPrimary} justify-center`} disabled={!amount.trim()}><Plus className="w-4 h-4" />Записать</button>
        {error && <p className="md:col-span-6 text-sm text-red-400">{error}</p>}
      </form>
      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} onClick={() => download(`kudir-${new Date().getFullYear()}.csv`, '\uFEFF' + bizStore.exportLedgerCSV(new Date().getFullYear()), 'text/csv;charset=utf-8')}><Download className="w-4 h-4" />Книга доходов и расходов (CSV)</button>
        {profile.regime === 'npd' && <a className={btnGhost} href={MY_TAX_URL} target="_blank" rel="noreferrer"><Receipt className="w-4 h-4" />Открыть «Мой налог»</a>}
      </div>
      <div className={`${card} divide-y divide-white/5`}>
        {entries.length === 0 && <p className="p-4 text-sm text-slate-500">Пока пусто. Скажите Светлане: «Получил 5000 от Петрова за урок».</p>}
        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-24 text-slate-400">{date(e.date)}</span>
            <span className="flex-1 min-w-0 truncate">{e.description}{e.counterparty ? ` · ${e.counterparty}` : ''}</span>
            {e.kind === 'income' && profile.regime === 'npd' && (
              e.receipt === 'issued'
                ? <span className="text-xs text-emerald-300">чек {e.receiptNumber ?? '✓'}</span>
                : <button className="text-xs text-amber-300 hover:underline" onClick={() => {
                    const n = window.prompt('Чек выбит в «Мой налог»? Номер чека (можно пусто):', '');
                    if (n !== null) bizStore.setReceipt(e.id, n);
                  }}>нет чека</button>
            )}
            <span className={`w-32 text-right font-medium ${e.kind === 'income' ? 'text-emerald-300' : 'text-red-300'}`}>{e.kind === 'income' ? '+' : '−'}{formatRub(e.amount)}</span>
            <button onClick={() => { if (window.confirm('Удалить запись?')) bizStore.deleteEntry(e.id); }} className="p-1 text-slate-500 hover:text-red-300" aria-label="Удалить"><Trash2 className="w-4 h-4" /></button>
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

  return (
    <div className="space-y-4">
      {!profile.fullName && <p className="text-sm text-amber-300">Заполните профиль (ФИО, ИНН, банк), чтобы реквизиты попали в документы.</p>}
      <form onSubmit={add} className={`${card} p-4 grid grid-cols-1 md:grid-cols-4 gap-3`}>
        <select className={input} value={type} onChange={e => setType(e.target.value as DocType)}>
          <option value="invoice">Счёт на оплату</option><option value="act">Акт оказанных услуг</option><option value="contract">Договор оказания услуг</option>
        </select>
        <input className={input} placeholder="Клиент *" list="biz-doc-clients" value={client} onChange={e => setClient(e.target.value)} />
        <datalist id="biz-doc-clients">{contacts.map(c => <option key={c.id} value={c.name} />)}</datalist>
        <input className={`${input} md:col-span-2`} placeholder="Реквизиты клиента (ИНН, адрес) — необязательно" value={details} onChange={e => setDetails(e.target.value)} />
        <input className={`${input} md:col-span-2`} placeholder="Услуга *" value={service} onChange={e => setService(e.target.value)} />
        <input className={input} placeholder="Кол-во" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />
        <input className={input} placeholder="Цена, ₽ *" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
        <input className={`${input} md:col-span-3`} placeholder="Основание (например, «Договор № 1 от 01.10.2026»)" value={basis} onChange={e => setBasis(e.target.value)} />
        <button type="submit" className={`${btnPrimary} justify-center`} disabled={!client.trim() || !service.trim() || !price.trim()}><Plus className="w-4 h-4" />Создать</button>
        {error && <p className="md:col-span-4 text-sm text-red-400">{error}</p>}
      </form>
      <div className={`${card} divide-y divide-white/5`}>
        {docs.length === 0 && <p className="p-4 text-sm text-slate-500">Документов нет. Скажите Светлане: «Выстави счёт Иванову на 15000 за дизайн».</p>}
        {docs.map(d => {
          const html = () => renderDocumentHTML(d, bizStore.getProfile());
          return (
            <div key={d.id} className="px-4 py-3 text-sm flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px]">
                <p className="font-medium">{DOC_LABELS[d.type]} № {d.number} от {date(d.date)} · {d.clientName}</p>
                <p className="text-xs text-slate-400">{formatRub(d.total)} · {DOC_STATUS_LABELS[d.status]}{d.dueDate && d.status !== 'paid' ? ` · оплатить до ${date(d.dueDate)}` : ''}</p>
              </div>
              <button className={btnGhost} onClick={() => printHTML(html())}><Printer className="w-4 h-4" />Печать / PDF</button>
              <button className={btnGhost} onClick={() => download(`${DOC_LABELS[d.type]}-${d.number}.html`, html(), 'text/html;charset=utf-8')}><Download className="w-4 h-4" />Файл</button>
              {d.type === 'invoice' && profile.account && <CopyButton text={paymentString(profile, d.total, `Оплата по счёту № ${d.number} от ${date(d.date)}`)} label="Строка для QR" />}
              {d.type === 'invoice' && d.status === 'draft' && <button className={btnGhost} onClick={() => bizStore.setDocumentStatus(d.id, 'sent')}><Send className="w-4 h-4" />Отправлен</button>}
              {d.type === 'invoice' && d.status !== 'paid' && <button className={btnPrimary} onClick={() => bizStore.markPaid(d.id)}><Check className="w-4 h-4" />Оплачен</button>}
              <button onClick={() => { if (window.confirm('Удалить документ?')) bizStore.deleteDocument(d.id); }} className="p-1 text-slate-500 hover:text-red-300" aria-label="Удалить"><Trash2 className="w-4 h-4" /></button>
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
            <div className="flex justify-between gap-3">
              <p className="font-medium">{d.clientName} · счёт № {d.number} · {formatRub(d.total)}</p>
              <span className={`text-sm ${daysOverdue ? 'text-red-300' : 'text-slate-400'}`}>{daysOverdue ? `просрочка ${daysOverdue} дн.` : `до ${date(d.dueDate)}`}</span>
            </div>
            <p className="text-sm text-slate-300 whitespace-pre-line bg-black/20 rounded-lg p-3">{text}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={text} />
              <a className={btnGhost} href={`https://t.me/share/url?url=&text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Send className="w-4 h-4" />Telegram</a>
              {phone && <a className={btnGhost} href={`https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
              {phone && <a className={btnGhost} href={`sms:${phone}?body=${encodeURIComponent(text)}`}>SMS</a>}
              <button className={btnPrimary} onClick={() => bizStore.markPaid(d.id)}><Check className="w-4 h-4" />Оплатили</button>
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
              <div className="h-2.5 rounded-full bg-white/5 overflow-hidden"><div className={`h-full ${n.income > NPD_LIMIT * 0.85 ? 'bg-red-400' : 'bg-emerald-400/70'}`} style={{ width: `${Math.min(100, (n.income / NPD_LIMIT) * 100)}%` }} /></div>
              {n.limitExceeded && <p className="text-sm text-red-300 mt-2">Лимит превышен: нужно перейти на другой режим (например, ИП на УСН) в течение 20 дней.</p>}
            </div>
            <div className={`${card} divide-y divide-white/5`}>
              {n.months.map(m => (
                <div key={m.month} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>{m.month}</span>
                  <span className="text-slate-400">физлица {formatRub(m.fromPersons)} · юрлица {formatRub(m.fromCompanies)}</span>
                  <span>налог {formatRub(m.tax)}{m.payable ? ` → к оплате ${formatRub(m.payable)} до ${date(m.dueDate)}` : ' (меньше 100 ₽, перенос)'}</span>
                </div>
              ))}
              {n.months.length === 0 && <p className="p-4 text-sm text-slate-500">Доходов в этом году нет.</p>}
            </div>
            <a className={btnGhost} href={MY_TAX_URL} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" />«Мой налог» — выбить чеки и оплатить</a>
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
              <Stat label="Налог до вычета взносов" value={formatRub(u.taxGross)} />
              <Stat label="Налог к уплате (оценка)" value={formatRub(u.taxAfterContributions)} tone="text-amber-300" />
            </div>
            <div className={`${card} p-4 text-sm space-y-1`}>
              <p>Фиксированные взносы: {formatRub(u.contributionsFixed)} (сумму на текущий год проверьте на nalog.gov.ru), 1% с дохода свыше 300 000 ₽: {formatRub(u.contributionsExtra)}.</p>
              {u.regime === 'usn6' ? <p className="text-slate-400">ИП без работников уменьшает налог УСН 6% на всю сумму взносов.</p> : <p className="text-slate-400">На УСН 15% взносы учитываются в расходах; минимальный налог — 1% дохода ({formatRub(u.minTax)}).</p>}
              {u.quarters.map(q => <p key={q.quarter} className="text-slate-300">{q.quarter === 4 ? 'Год' : `${q.quarter * 3} мес.`}: доход {formatRub(q.income)}, налог нарастающим итогом {formatRub(q.taxCumulative)}</p>)}
            </div>
          </>
        );
      })()}
      {profile.regime === 'patent' && <p className="text-sm text-slate-300">Стоимость патента зависит от региона и вида деятельности: калькулятор ФНС на <a className="text-indigo-300 underline" href="https://patent.nalog.ru" target="_blank" rel="noreferrer">patent.nalog.ru</a>. Доходы ведите во вкладке «Деньги» — нужен лимит 60 млн ₽ и книга учёта.</p>}
      {profile.regime === 'ooo' && <p className="text-sm text-slate-300">Для ООО Светлана ведёт доходы, документы и должников; бухгалтерскую и налоговую отчётность ООО лучше доверить бухгалтеру или сервису.</p>}
      <div className={`${card} p-4`}>
        <h4 className="font-semibold mb-2">Ближайшие сроки</h4>
        {deadlines.length === 0 && <p className="text-sm text-slate-500">Нет сроков на ближайшие 4 месяца (или режим не выбран).</p>}
        {deadlines.map(dl => <p key={`${dl.date}-${dl.title}`} className="text-sm"><b>{date(dl.date)}</b> · {dl.title}{dl.details ? <span className="text-slate-400"> — {dl.details}</span> : null}</p>)}
        <p className="text-xs text-slate-500 mt-2">Если срок выпадает на выходной, он переносится на следующий рабочий день. Расчёты — оценка, не замена бухгалтеру.</p>
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
        <button className={btnGhost} onClick={goProfile}><UserCog className="w-4 h-4" />Изменить профиль</button>
        <a className={btnPrimary} href={regionalSearchUrl(profile, now)} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" />Найти программы региона</a>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className={`${input} w-56`} value={kind} onChange={e => setKind(e.target.value as SupportKind | '')}>
          <option value="">Все виды поддержки</option>
          {(Object.keys(SUPPORT_KIND_LABELS) as SupportKind[]).map(k => <option key={k} value={k}>{SUPPORT_KIND_LABELS[k]}</option>)}
        </select>
        <input className={`${input} w-64`} placeholder="Поиск" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
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
            <a className="text-sm text-indigo-300 hover:underline inline-flex items-center gap-1" href={m.url} target="_blank" rel="noreferrer">{m.provider} <ExternalLink className="w-3.5 h-3.5" /></a>
          </div>
        ))}
        {matches.length === 0 && <p className="text-sm text-slate-500">Под ваш профиль ничего не нашлось. Уточните режим, возраст, отрасли и статусы в профиле.</p>}
      </div>
      <p className="text-xs text-slate-500">Каталог содержит основные федеральные программы. Суммы и условия меняются ежегодно и различаются по регионам: перед подачей сверяйте на официальном сайте или в центре «Мой бизнес».</p>
    </div>
  );
}

// ---------------- profile ----------------

function ProfileTab() {
  useBizVersion();
  const [draft, setDraft] = useState<BizProfile>(bizStore.getProfile());
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof BizProfile) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft(d => ({ ...d, [k]: e.target.value }));
  const toggle = (k: 'sectors' | 'flags', v: string) => setDraft(d => ({ ...d, [k]: d[k].includes(v) ? d[k].filter(x => x !== v) : [...d[k], v] }));

  const save = (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    try {
      bizStore.updateProfile({
        ...draft,
        birthYear: draft.birthYear ? Number(draft.birthYear) : undefined,
        fixedContributions: Number(draft.fixedContributions) || 0,
        contributionsPaid: Number(draft.contributionsPaid) || 0,
      });
      setMsg('Сохранено');
    } catch (err: any) { setMsg(err?.message || 'Ошибка'); }
  };

  return (
    <form onSubmit={save} className="space-y-4 max-w-4xl">
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
        <input className={input} placeholder="ФИО или название" value={draft.fullName} onChange={set('fullName')} />
        <input className={input} placeholder="ИНН" inputMode="numeric" value={draft.inn} onChange={set('inn')} />
        <input className={input} placeholder="ОГРНИП / ОГРН (если есть)" value={draft.ogrn} onChange={set('ogrn')} />
        <input className={input} placeholder="Адрес" value={draft.address} onChange={set('address')} />
        <input className={input} placeholder="Телефон" value={draft.phone} onChange={set('phone')} />
        <input className={input} placeholder="E-mail" value={draft.email} onChange={set('email')} />
        <input className={input} placeholder="Банк" value={draft.bankName} onChange={set('bankName')} />
        <input className={input} placeholder="БИК" inputMode="numeric" value={draft.bik} onChange={set('bik')} />
        <input className={input} placeholder="Расчётный счёт (20 цифр)" inputMode="numeric" value={draft.account} onChange={set('account')} />
        <input className={input} placeholder="Корр. счёт" inputMode="numeric" value={draft.corrAccount} onChange={set('corrAccount')} />
        <input className={input} placeholder="Год рождения (для молодёжных грантов)" inputMode="numeric" value={draft.birthYear ?? ''} onChange={e => setDraft(d => ({ ...d, birthYear: e.target.value ? Number(e.target.value) : undefined }))} />
        {(draft.regime === 'usn6' || draft.regime === 'usn15' || draft.regime === 'patent') && (
          <input className={input} placeholder="Фиксированные взносы ИП за год, ₽" inputMode="numeric" value={draft.fixedContributions} onChange={e => setDraft(d => ({ ...d, fixedContributions: Number(e.target.value) || 0 }))} />
        )}
      </div>
      <div className={`${card} p-4`}>
        <p className="text-sm text-slate-400 mb-2">Сферы деятельности</p>
        <div className="flex flex-wrap gap-2">{Object.entries(SECTOR_LABELS).map(([k, l]) => (
          <button type="button" key={k} onClick={() => toggle('sectors', k)} className={`px-3 py-1 rounded-full text-xs border ${draft.sectors.includes(k) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-slate-300'}`}>{l}</button>
        ))}</div>
        <p className="text-sm text-slate-400 mt-4 mb-2">Особые статусы (влияют на подбор поддержки, хранятся только на устройстве)</p>
        <div className="flex flex-wrap gap-2">{Object.entries(FLAG_LABELS).map(([k, l]) => (
          <button type="button" key={k} onClick={() => toggle('flags', k)} className={`px-3 py-1 rounded-full text-xs border ${draft.flags.includes(k) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-slate-300'}`}>{l}</button>
        ))}</div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className={btnPrimary}>Сохранить профиль</button>
        <button type="button" className={btnGhost} onClick={() => download(`biz-backup-${new Date().toISOString().slice(0, 10)}.json`, bizStore.exportJSON(), 'application/json')}><Download className="w-4 h-4" />Резервная копия</button>
        {msg && <span className="text-sm text-indigo-200">{msg}</span>}
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
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`${btn} ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            <t.icon className="w-4 h-4" />{t.label}
            {t.badge ? <span className="ml-1 px-1.5 rounded-full bg-black/30 text-xs">{t.badge}</span> : null}
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
