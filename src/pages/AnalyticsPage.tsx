// Svetlana Business — финансовая аналитика: динамика за 12 месяцев, клиенты, расходы, прогноз и советы.
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Lightbulb, Users, Wallet, Target } from 'lucide-react';
import { bizStore, formatRub } from '../services/biz/BizStore';
import { computeAnalytics, monthLabel } from '../services/biz/Analytics';

const card = 'rounded-xl bg-white/5 border border-white/10 p-4';

function Kpi({ title, value, sub, tone }: { title: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className={card}>
      <p className="text-xs text-slate-400">{title}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
      {sub && <p className={`text-xs mt-1 ${tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-red-300' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [version, setVersion] = useState(0);
  useEffect(() => bizStore.subscribe(() => setVersion(v => v + 1)), []);
  const a = useMemo(() => { void version; return computeAnalytics(bizStore); }, [version]);
  const max = Math.max(1, ...a.months.map(m => Math.max(m.income, m.expenses)));
  const change = a.changeVsPrev;

  return (
    <div className="space-y-4 text-white">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi title="Доход с начала года" value={formatRub(a.ytd.income)} sub={`прибыль ${formatRub(a.ytd.profit)}`} />
        <Kpi title={`За ${monthLabel(a.lastFull.month, true)}`} value={formatRub(a.lastFull.income)}
          sub={change === null ? 'нет данных для сравнения' : `${change >= 0 ? '+' : ''}${change}% к пред. месяцу`} tone={change === null ? undefined : change >= 0 ? 'up' : 'down'} />
        <Kpi title="Средний чек (12 мес.)" value={formatRub(a.last12.avgCheck)} sub={`${a.last12.payments} оплат, ${a.last12.clients} клиентов`} />
        <Kpi title="Прогноз на год" value={formatRub(a.forecast.income)} sub={`налог ≈ ${formatRub(a.forecast.tax)}`} />
      </div>

      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-indigo-300" />Доходы и расходы за 12 месяцев</h3>
          <div className="flex gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />доход</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />расход</span>
          </div>
        </div>
        <div className="flex items-end gap-1.5 h-40">
          {a.months.map(m => (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${monthLabel(m.month, true)}: доход ${formatRub(m.income)}, расход ${formatRub(m.expenses)}, налог ${formatRub(m.tax)}`}>
              <div className="w-full flex items-end gap-0.5 h-full">
                <div className="flex-1 rounded-t bg-emerald-500/80" style={{ height: `${(m.income / max) * 100}%` }} />
                <div className="flex-1 rounded-t bg-rose-500/70" style={{ height: `${(m.expenses / max) * 100}%` }} />
              </div>
              <span className="text-[10px] text-slate-500">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} space-y-2`}>
          <h3 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-emerald-300" />Топ клиентов</h3>
          {a.topClients.length ? a.topClients.map(c => (
            <div key={c.name} className="text-sm">
              <div className="flex justify-between"><span className="truncate">{c.name}</span><span className="text-slate-300">{formatRub(c.amount)}</span></div>
              <div className="h-1.5 rounded bg-white/5 mt-1"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${c.share}%` }} /></div>
              <p className="text-xs text-slate-500 mt-0.5">{c.share}% дохода, оплат: {c.payments}</p>
            </div>
          )) : <p className="text-sm text-slate-500">Пока нет оплат с указанным клиентом.</p>}
          <p className="text-xs text-slate-500">Повторных клиентов: {a.last12.repeatShare}%</p>
        </div>

        <div className={`${card} space-y-2`}>
          <h3 className="font-semibold flex items-center gap-2"><TrendingDown className="w-4 h-4 text-rose-300" />Куда уходят деньги</h3>
          {a.topExpenses.length ? a.topExpenses.map(e => (
            <div key={e.name} className="text-sm">
              <div className="flex justify-between"><span className="truncate">{e.name}</span><span className="text-slate-300">{formatRub(e.amount)}</span></div>
              <div className="h-1.5 rounded bg-white/5 mt-1"><div className="h-1.5 rounded bg-rose-500" style={{ width: `${e.share}%` }} /></div>
            </div>
          )) : <p className="text-sm text-slate-500">Расходов за 12 месяцев нет.</p>}
        </div>

        <div className={`${card} space-y-2`}>
          <h3 className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-amber-300" />Прогноз до конца года</h3>
          <p className="text-sm">Доход ≈ <b>{formatRub(a.forecast.income)}</b></p>
          <p className="text-sm">Налог ≈ <b>{formatRub(a.forecast.tax)}</b></p>
          <p className="text-xs text-slate-500">Считаю по среднему за 3 последних полных месяца: {formatRub(a.forecast.avgMonth)} в месяц. Это оценка, а не обещание.</p>
          {a.forecast.npdLimitDate && <p className="text-sm text-amber-200">Лимит НПД закончится ≈ {new Date(a.forecast.npdLimitDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>}
          {a.idleClients.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-slate-400 mb-1">Давно не платили:</p>
              {a.idleClients.map(c => <p key={c.name} className="text-sm">{c.name} <span className="text-slate-500">с {new Date(c.lastPaid).toLocaleDateString('ru-RU')}</span></p>)}
            </div>
          )}
        </div>
      </div>

      <div className={`${card} space-y-2`}>
        <h3 className="font-semibold flex items-center gap-2"><Lightbulb className="w-4 h-4 text-yellow-300" />Советы Светланы</h3>
        {a.insights.length ? a.insights.map(i => <p key={i} className="text-sm text-slate-200 flex gap-2"><TrendingUp className="w-4 h-4 mt-0.5 text-indigo-300 shrink-0" />{i}</p>)
          : <p className="text-sm text-slate-400">Всё ровно, тревожных сигналов нет.</p>}
      </div>
    </div>
  );
}
