// Svetlana Business — проверка контрагентов по ИНН, реквизиты по ИНН/БИК, импорт банковской выписки 1С.
// Доступность: у каждого поля подпись, результат — role=status, ошибка — role=alert, выбор файла доступен с клавиатуры.
// Ошибки сети и внешних сервисов показываются понятной фразой (safeErrorText), а не техническим текстом.
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { assertFileSize, MAX_BYTES } from '../services/security/SafeData';
import { ShieldCheck, Search, UserPlus, Upload, KeyRound, Building2, ExternalLink } from 'lucide-react';
import { bizStore, formatRub } from '../services/biz/BizStore';
import {
  checkCounterparty, lookupParty, lookupBank, getDadataKey, setDadataKey, validateInn, validateBik,
  STATUS_LABELS, type CheckReport,
} from '../services/biz/Counterparty';
import { decodeStatement, parse1C, importStatement } from '../services/biz/BankStatement';
import { crmStore } from '../services/crm/CRMStore';
import { safeErrorText } from '../services/safeErrorText';

const input = 'w-full min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50';
const btn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10`;
const card = 'rounded-xl bg-white/5 border border-white/10 p-4 space-y-3 min-w-0';
/** Поле + кнопка: на телефоне друг под другом, на широком экране в одну строку. */
const row = 'flex flex-col sm:flex-row gap-2';
const rowBtn = 'w-full sm:w-auto shrink-0';

type Msg = { text: string; error: boolean } | null;
function MsgLine({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role={msg.error ? 'alert' : 'status'} className={`text-sm break-words ${msg.error ? 'text-red-300' : 'text-indigo-200'}`}>{msg.text}</p>;
}

function CheckCard() {
  const [inn, setInn] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setReport(null);
    try { setReport(await checkCounterparty(inn)); } catch (err) { setMsg({ text: safeErrorText(err, 'Проверка не удалась. Проверьте интернет и ключ DaData.'), error: true }); } finally { setBusy(false); }
  };

  const addToCrm = () => {
    if (!report?.party) return;
    const p = report.party;
    setMsg(null);
    try {
      const notes = [`ИНН ${p.inn}`, p.kpp && `КПП ${p.kpp}`, p.ogrn && `ОГРН ${p.ogrn}`, p.address && `Адрес: ${p.address}`, p.manager && `Руководитель: ${p.manager}`].filter(Boolean).join('\n');
      const existing = crmStore.listContacts({ query: p.inn })[0] ?? crmStore.findContactByName(p.name);
      if (existing) { setMsg({ text: `«${existing.name}» уже есть в CRM`, error: false }); return; }
      crmStore.addContact({ name: p.name, company: p.name, status: 'client', tags: ['контрагент'], notes, source: 'manual' });
      setMsg({ text: `«${p.name}» добавлен в CRM`, error: false });
    } catch (err) { setMsg({ text: safeErrorText(err, 'Не удалось добавить в CRM'), error: true }); }
  };

  return (
    <section className={card} aria-labelledby="bank-check-title">
      <h3 id="bank-check-title" className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-300" aria-hidden="true" />Проверка контрагента</h3>
      <form onSubmit={run} className={row} aria-busy={busy}>
        <input className={input} placeholder="ИНН компании, ИП или самозанятого" aria-label="ИНН контрагента: компании, ИП или самозанятого" inputMode="numeric" value={inn} onChange={e => setInn(e.target.value)} />
        <button className={`${btnPrimary} ${rowBtn}`} disabled={busy || inn.replace(/\D/g, '').length < 10}><Search className="w-4 h-4" aria-hidden="true" />{busy ? 'Проверяю…' : 'Проверить'}</button>
      </form>
      {report && (
        <div className="space-y-2 text-sm" role="status">
          {report.party ? (
            <div className="rounded-lg bg-black/20 p-3 space-y-1 break-words">
              <p className="font-semibold">{report.party.name}</p>
              <p className={report.party.status === 'ACTIVE' ? 'text-emerald-300' : 'text-red-300'}>{STATUS_LABELS[report.party.status]}</p>
              {report.party.ogrn && <p className="text-slate-300">ИНН {report.party.inn}{report.party.kpp ? `, КПП ${report.party.kpp}` : ''}, ОГРН {report.party.ogrn}</p>}
              {report.party.registeredAt && <p className="text-slate-400">Регистрация: {new Date(report.party.registeredAt).toLocaleDateString('ru-RU')}</p>}
              {report.party.address && <p className="text-slate-400">{report.party.address}</p>}
              {report.party.manager && <p className="text-slate-400">{report.party.manager}</p>}
            </div>
          ) : (
            <p className={report.validInn ? 'text-slate-300' : 'text-red-300'}>ИНН {report.inn}: {report.validInn ? 'контрольная сумма верна' : 'неверный ИНН'}</p>
          )}
          {report.risks.map(r => <p key={r} className="text-red-300"><span aria-hidden="true">⚠️ </span><span className="sr-only">Риск: </span>{r}</p>)}
          {report.notes.map(n => <p key={n} className="text-slate-400"><span aria-hidden="true">ℹ️ </span>{n}</p>)}
          {report.party && !report.risks.length && <p className="text-emerald-300"><span aria-hidden="true">✅ </span>Явных рисков не видно</p>}
          <div className="flex flex-wrap gap-2">
            {report.party && <button className={btnGhost} onClick={addToCrm}><UserPlus className="w-4 h-4" aria-hidden="true" />В CRM</button>}
            {report.links.map(l => <a key={l.title} className={btnGhost} href={l.url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />{l.title}</a>)}
          </div>
        </div>
      )}
      <MsgLine msg={msg} />
    </section>
  );
}

function MyDetailsCard() {
  const profile = bizStore.getProfile();
  const [inn, setInn] = useState(profile.inn);
  const [bik, setBik] = useState(profile.bik);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const fillByInn = async () => {
    setBusy(true); setMsg(null);
    try {
      if (!validateInn(inn)) throw new Error('ИНН не проходит проверку контрольной суммы');
      const p = await lookupParty(inn);
      if (!p) {
        bizStore.updateProfile({ inn });
        setMsg({ text: 'ИНН сохранён. В ЕГРИП/ЕГРЮЛ не найден — если вы самозанятый без ИП, это нормально.', error: false });
      } else {
        bizStore.updateProfile({ inn: p.inn, fullName: p.name, ogrn: p.ogrn ?? '', address: p.address ?? '' });
        setMsg({ text: `Профиль заполнен: ${p.name}`, error: false });
      }
    } catch (err) { setMsg({ text: safeErrorText(err, 'Не получилось заполнить по ИНН. Проверьте интернет и ключ DaData.'), error: true }); } finally { setBusy(false); }
  };

  const fillBank = async () => {
    setBusy(true); setMsg(null);
    try {
      if (!validateBik(bik)) throw new Error('БИК — 9 цифр');
      const b = await lookupBank(bik);
      if (!b) throw new Error('Банк с таким БИК не найден');
      bizStore.updateProfile({ bik: b.bik, bankName: b.name, corrAccount: b.corrAccount });
      setMsg({ text: `Банк: ${b.name}, к/с ${b.corrAccount}`, error: false });
    } catch (err) { setMsg({ text: safeErrorText(err, 'Не получилось найти банк. Проверьте интернет и ключ DaData.'), error: true }); } finally { setBusy(false); }
  };

  return (
    <section className={card} aria-labelledby="bank-my-title" aria-busy={busy}>
      <h3 id="bank-my-title" className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-indigo-300" aria-hidden="true" />Мои реквизиты автоматически</h3>
      <div className={row}>
        <input className={input} placeholder="Мой ИНН" aria-label="Мой ИНН" inputMode="numeric" value={inn} onChange={e => setInn(e.target.value)} />
        <button type="button" className={`${btnGhost} ${rowBtn}`} onClick={fillByInn} disabled={busy}>Заполнить</button>
      </div>
      <div className={row}>
        <input className={input} placeholder="БИК моего банка" aria-label="БИК моего банка" inputMode="numeric" value={bik} onChange={e => setBik(e.target.value)} />
        <button type="button" className={`${btnGhost} ${rowBtn}`} onClick={fillBank} disabled={busy}>Банк по БИК</button>
      </div>
      <p className="text-xs text-slate-400">Расчётный счёт впишите во вкладке «Бизнес → Профиль» — его нет в открытых реестрах.</p>
      <MsgLine msg={msg} />
    </section>
  );
}

function StatementCard() {
  const [msg, setMsg] = useState<Msg>(null);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(null);
    try {
      assertFileSize(file, MAX_BYTES.statement, 'Выписка');
      const parsed = parse1C(decodeStatement(await file.arrayBuffer()));
      const r = importStatement(parsed);
      const income = parsed.docs.filter(d => d.payeeAccount === (parsed.account || bizStore.getProfile().account)).reduce((s, d) => s + d.amount, 0);
      setMsg({
        text: `Готово: поступлений ${r.incomes} (на ${formatRub(income)}), из них закрыто счетов ${r.invoicesPaid}; списаний ${r.expenses}; повторов ${r.duplicates}; пропущено ${r.skipped}.`
          + (bizStore.getProfile().regime === 'npd' && r.incomes ? ' Не забудьте выбить чеки в «Мой налог» за поступления от клиентов.' : ''),
        error: false,
      });
    } catch (err) { setMsg({ text: safeErrorText(err, 'Не удалось прочитать выписку. Нужен файл выгрузки в формате 1С (.txt).'), error: true }); }
  };
  return (
    <section className={card} aria-labelledby="bank-statement-title">
      <h3 id="bank-statement-title" className="font-semibold flex items-center gap-2"><Upload className="w-4 h-4 text-amber-300" aria-hidden="true" />Банковская выписка</h3>
      <p className="text-sm text-slate-400">В интернет-банке: Выписка → Экспорт → «1С» (файл .txt). Поступления станут доходами, списания — расходами, оплаченные счета закроются сами. Повторная загрузка не дублирует записи.</p>
      <p className="text-xs text-amber-200">Переводы самому себе, займы и возвраты не являются доходом — удалите такие записи во вкладке «Деньги».</p>
      <label className={`${btnPrimary} cursor-pointer w-full sm:w-fit focus-within:ring-2 focus-within:ring-indigo-300`}><Upload className="w-4 h-4" aria-hidden="true" />Загрузить выписку 1С
        <input type="file" accept=".txt,text/plain" className="sr-only" aria-label="Загрузить банковскую выписку в формате 1С" onChange={onFile} />
      </label>
      <MsgLine msg={msg} />
    </section>
  );
}

function KeyCard() {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getDadataKey()
      .then(k => { if (alive) setKey(k); })
      .catch(() => { if (alive) setErr('Не удалось прочитать сохранённый ключ. Вставьте его заново.'); });
    return () => { alive = false; };
  }, []);
  const save = async () => {
    setErr(null);
    try { await setDadataKey(key); setSaved(true); } catch (e) { setSaved(false); setErr(safeErrorText(e, 'Не удалось сохранить ключ')); }
  };
  return (
    <section className={card} aria-labelledby="bank-key-title">
      <h3 id="bank-key-title" className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-300" aria-hidden="true" />Ключ DaData</h3>
      <p className="text-sm text-slate-400">Нужен для данных по ИНН и БИК. Бесплатно: зарегистрируйтесь на <a className="text-indigo-300 underline" href="https://dadata.ru/profile/#info" target="_blank" rel="noreferrer">dadata.ru</a> и скопируйте «API-ключ». Хранится зашифрованным только на этом устройстве.</p>
      <div className={row}>
        <input className={input} type="password" autoComplete="off" spellCheck={false} placeholder="API-ключ" aria-label="API-ключ DaData" value={key} onChange={e => { setKey(e.target.value); setSaved(false); }} />
        <button type="button" className={`${btnGhost} ${rowBtn}`} onClick={save}>{saved ? 'Сохранено' : 'Сохранить'}</button>
      </div>
      {saved && <p role="status" className="sr-only">Ключ сохранён</p>}
      {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
    </section>
  );
}

export default function BankInnPage() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-white">
      <CheckCard />
      <StatementCard />
      <MyDetailsCard />
      <KeyCard />
    </div>
  );
}
