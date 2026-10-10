// Svetlana Business — проверка контрагентов по ИНН, реквизиты по ИНН/БИК, импорт банковской выписки 1С.
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ShieldCheck, Search, UserPlus, Upload, KeyRound, Building2, ExternalLink } from 'lucide-react';
import { bizStore, formatRub } from '../services/biz/BizStore';
import {
  checkCounterparty, lookupParty, lookupBank, getDadataKey, setDadataKey, validateInn, validateBik,
  STATUS_LABELS, type CheckReport,
} from '../services/biz/Counterparty';
import { decodeStatement, parse1C, importStatement } from '../services/biz/BankStatement';
import { crmStore } from '../services/crm/CRMStore';

const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10`;
const card = 'rounded-xl bg-white/5 border border-white/10 p-4 space-y-3';

function CheckCard() {
  const [inn, setInn] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setReport(null);
    try { setReport(await checkCounterparty(inn)); } catch (err: any) { setMsg(err?.message || 'Проверка не удалась'); } finally { setBusy(false); }
  };

  const addToCrm = () => {
    if (!report?.party) return;
    const p = report.party;
    const notes = [`ИНН ${p.inn}`, p.kpp && `КПП ${p.kpp}`, p.ogrn && `ОГРН ${p.ogrn}`, p.address && `Адрес: ${p.address}`, p.manager && `Руководитель: ${p.manager}`].filter(Boolean).join('\n');
    const existing = crmStore.listContacts({ query: p.inn })[0] ?? crmStore.findContactByName(p.name);
    if (existing) { setMsg(`«${existing.name}» уже есть в CRM`); return; }
    crmStore.addContact({ name: p.name, company: p.name, status: 'client', tags: ['контрагент'], notes, source: 'manual' });
    setMsg(`«${p.name}» добавлен в CRM`);
  };

  return (
    <div className={card}>
      <h3 className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-300" />Проверка контрагента</h3>
      <form onSubmit={run} className="flex gap-2">
        <input className={input} placeholder="ИНН компании, ИП или самозанятого" inputMode="numeric" value={inn} onChange={e => setInn(e.target.value)} />
        <button className={btnPrimary} disabled={busy || inn.replace(/\D/g, '').length < 10}><Search className="w-4 h-4" />{busy ? 'Проверяю…' : 'Проверить'}</button>
      </form>
      {report && (
        <div className="space-y-2 text-sm">
          {report.party ? (
            <div className="rounded-lg bg-black/20 p-3 space-y-1">
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
          {report.risks.map(r => <p key={r} className="text-red-300">⚠️ {r}</p>)}
          {report.notes.map(n => <p key={n} className="text-slate-400">ℹ️ {n}</p>)}
          {report.party && !report.risks.length && <p className="text-emerald-300">✅ Явных рисков не видно</p>}
          <div className="flex flex-wrap gap-2">
            {report.party && <button className={btnGhost} onClick={addToCrm}><UserPlus className="w-4 h-4" />В CRM</button>}
            {report.links.map(l => <a key={l.title} className={btnGhost} href={l.url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" />{l.title}</a>)}
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-indigo-200">{msg}</p>}
    </div>
  );
}

function MyDetailsCard() {
  const profile = bizStore.getProfile();
  const [inn, setInn] = useState(profile.inn);
  const [bik, setBik] = useState(profile.bik);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fillByInn = async () => {
    setBusy(true); setMsg(null);
    try {
      if (!validateInn(inn)) throw new Error('ИНН не проходит проверку контрольной суммы');
      const p = await lookupParty(inn);
      if (!p) {
        bizStore.updateProfile({ inn });
        setMsg('ИНН сохранён. В ЕГРИП/ЕГРЮЛ не найден — если вы самозанятый без ИП, это нормально.');
      } else {
        bizStore.updateProfile({ inn: p.inn, fullName: p.name, ogrn: p.ogrn ?? '', address: p.address ?? '' });
        setMsg(`Профиль заполнен: ${p.name}`);
      }
    } catch (err: any) { setMsg(err?.message || 'Не получилось'); } finally { setBusy(false); }
  };

  const fillBank = async () => {
    setBusy(true); setMsg(null);
    try {
      if (!validateBik(bik)) throw new Error('БИК — 9 цифр');
      const b = await lookupBank(bik);
      if (!b) throw new Error('Банк с таким БИК не найден');
      bizStore.updateProfile({ bik: b.bik, bankName: b.name, corrAccount: b.corrAccount });
      setMsg(`Банк: ${b.name}, к/с ${b.corrAccount}`);
    } catch (err: any) { setMsg(err?.message || 'Не получилось'); } finally { setBusy(false); }
  };

  return (
    <div className={card}>
      <h3 className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-indigo-300" />Мои реквизиты автоматически</h3>
      <div className="flex gap-2">
        <input className={input} placeholder="Мой ИНН" inputMode="numeric" value={inn} onChange={e => setInn(e.target.value)} />
        <button className={btnGhost} onClick={fillByInn} disabled={busy}>Заполнить</button>
      </div>
      <div className="flex gap-2">
        <input className={input} placeholder="БИК моего банка" inputMode="numeric" value={bik} onChange={e => setBik(e.target.value)} />
        <button className={btnGhost} onClick={fillBank} disabled={busy}>Банк по БИК</button>
      </div>
      <p className="text-xs text-slate-500">Расчётный счёт впишите во вкладке «Бизнес → Профиль» — его нет в открытых реестрах.</p>
      {msg && <p className="text-sm text-indigo-200">{msg}</p>}
    </div>
  );
}

function StatementCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(null);
    try {
      const parsed = parse1C(decodeStatement(await file.arrayBuffer()));
      const r = importStatement(parsed);
      const income = parsed.docs.filter(d => d.payeeAccount === (parsed.account || bizStore.getProfile().account)).reduce((s, d) => s + d.amount, 0);
      setMsg(`Готово: поступлений ${r.incomes} (на ${formatRub(income)}), из них закрыто счетов ${r.invoicesPaid}; списаний ${r.expenses}; повторов ${r.duplicates}; пропущено ${r.skipped}.`
        + (bizStore.getProfile().regime === 'npd' && r.incomes ? ' Не забудьте выбить чеки в «Мой налог» за поступления от клиентов.' : ''));
    } catch (err: any) { setMsg(err?.message || 'Не удалось прочитать выписку'); }
  };
  return (
    <div className={card}>
      <h3 className="font-semibold flex items-center gap-2"><Upload className="w-4 h-4 text-amber-300" />Банковская выписка</h3>
      <p className="text-sm text-slate-400">В интернет-банке: Выписка → Экспорт → «1С» (файл .txt). Поступления станут доходами, списания — расходами, оплаченные счета закроются сами. Повторная загрузка не дублирует записи.</p>
      <p className="text-xs text-amber-200">Переводы самому себе, займы и возвраты не являются доходом — удалите такие записи во вкладке «Деньги».</p>
      <label className={`${btnPrimary} cursor-pointer w-fit`}><Upload className="w-4 h-4" />Загрузить выписку 1С
        <input type="file" accept=".txt,text/plain" className="hidden" onChange={onFile} />
      </label>
      {msg && <p className="text-sm text-indigo-200">{msg}</p>}
    </div>
  );
}

function KeyCard() {
  const [key, setKey] = useState(getDadataKey());
  const [saved, setSaved] = useState(false);
  return (
    <div className={card}>
      <h3 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-300" />Ключ DaData</h3>
      <p className="text-sm text-slate-400">Нужен для данных по ИНН и БИК. Бесплатно: зарегистрируйтесь на <a className="text-indigo-300 underline" href="https://dadata.ru/profile/#info" target="_blank" rel="noreferrer">dadata.ru</a> и скопируйте «API-ключ». Хранится только на этом устройстве.</p>
      <div className="flex gap-2">
        <input className={input} type="password" placeholder="API-ключ" value={key} onChange={e => { setKey(e.target.value); setSaved(false); }} />
        <button className={btnGhost} onClick={() => { setDadataKey(key); setSaved(true); }}>{saved ? 'Сохранено' : 'Сохранить'}</button>
      </div>
    </div>
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
