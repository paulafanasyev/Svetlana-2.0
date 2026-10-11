// Svetlana Business — финансовая аналитика: динамика по месяцам, клиенты, расходы, прогноз до конца года и подсказки.
import { bizStore, BizStore, NPD_LIMIT, formatRub, round2, isTaxable, type LedgerEntry } from './BizStore';
import { onePercent, NPD_RECEIPT_FINE } from './TaxRules';

export interface MonthStat { month: string; label: string; income: number; expenses: number; profit: number; tax: number; payments: number }
export interface ClientStat { name: string; amount: number; share: number; payments: number; lastPaid: number; contactId?: string }
export interface ExpenseStat { name: string; amount: number; share: number }

export interface Analytics {
  months: MonthStat[];          // последние 12 месяцев, включая текущий
  current: MonthStat;           // текущий (неполный) месяц
  lastFull: MonthStat;          // прошлый полный месяц
  changeVsPrev: number | null;  // прошлый месяц к позапрошлому, %
  changeVsYear: number | null;  // прошлый месяц к тому же месяцу год назад, %
  ytd: { income: number; expenses: number; profit: number; tax: number };
  last12: { income: number; expenses: number; profit: number; payments: number; avgCheck: number; clients: number; repeatShare: number };
  topClients: ClientStat[];
  topExpenses: ExpenseStat[];
  idleClients: ClientStat[];    // платили раньше, но не в последние 60 дней
  forecast: { income: number; tax: number; avgMonth: number; npdLimitDate?: number; npdLimitReached: boolean };
  insights: string[];
}

const DAY = 86_400_000;

function ym(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(t: number, delta: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + delta, 1, 12).getTime();
}

export function monthLabel(month: string, long = false): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', long ? { month: 'long', year: 'numeric' } : { month: 'short' }).replace('.', '');
}

function pct(a: number, b: number): number | null {
  return b > 0 ? Math.round(((a - b) / b) * 100) : null;
}

function npdTaxByMonth(store: BizStore, years: number[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const y of years) store.npdSummary(y).months.forEach(m => map.set(m.month, m.tax));
  return map;
}

function monthTax(regime: string, income: number, expenses: number, npd: Map<string, number>, month: string): number {
  if (regime === 'npd') return npd.get(month) ?? 0;
  if (regime === 'usn6') return round2(income * 0.06);
  if (regime === 'usn15') return round2(Math.max((income - expenses) * 0.15, income * 0.01, 0));
  return 0;
}

function expenseKey(e: LedgerEntry): string {
  if (e.category && e.category !== 'bank') return e.category;
  return e.counterparty || e.description || 'Прочее';
}

export function computeAnalytics(store: BizStore = bizStore): Analytics {
  const now = store.now();
  const year = new Date(now).getFullYear();
  const profile = store.getProfile();
  const regime = profile.regime;
  // Переводы себе, займы и возвраты (taxable = false) — не выручка: в аналитике их не считаем.
  const all = store.listEntries().filter(isTaxable);
  const npd = regime === 'npd' ? npdTaxByMonth(store, [year - 1, year]) : new Map<string, number>();

  // 13 месяцев: нужен позапрошлый для сравнения; год назад считаем отдельно.
  const keys = Array.from({ length: 13 }, (_, i) => ym(shiftMonth(now, i - 12)));
  const stat = (month: string): MonthStat => {
    const list = all.filter(e => ym(e.date) === month);
    const income = round2(list.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0));
    const expenses = round2(list.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0));
    return { month, label: monthLabel(month), income, expenses, profit: round2(income - expenses), tax: monthTax(regime, income, expenses, npd, month), payments: list.filter(e => e.kind === 'income').length };
  };
  const stats = keys.map(stat);
  const months = stats.slice(1);
  const current = months[11];
  const lastFull = months[10];
  const prevFull = months[9];
  const sameMonthLastYear = stat(ym(shiftMonth(now, -13)));

  // С начала года
  const yearEntries = all.filter(e => new Date(e.date).getFullYear() === year);
  const ytdIncome = round2(yearEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0));
  const ytdExpenses = round2(yearEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0));
  const ytdTax = regime === 'npd' ? store.npdSummary(year).taxYear
    : regime === 'usn6' || regime === 'usn15' ? store.usnSummary(year).taxAfterContributions : 0;

  // 12 месяцев: клиенты
  const since = shiftMonth(now, -11);
  const incomes12 = all.filter(e => e.kind === 'income' && e.date >= since);
  const income12 = round2(incomes12.reduce((s, e) => s + e.amount, 0));
  const expenses12 = round2(months.reduce((s, m) => s + m.expenses, 0));
  const byClient = new Map<string, ClientStat>();
  for (const e of all.filter(x => x.kind === 'income')) {
    const name = e.counterparty?.trim() || '';
    if (!name) continue;
    const c = byClient.get(name) ?? { name, amount: 0, share: 0, payments: 0, lastPaid: 0, contactId: e.contactId };
    if (e.date >= since) { c.amount += e.amount; c.payments++; }
    c.lastPaid = Math.max(c.lastPaid, e.date);
    c.contactId = c.contactId ?? e.contactId;
    byClient.set(name, c);
  }
  const clients = [...byClient.values()];
  const active = clients.filter(c => c.payments > 0);
  active.forEach(c => { c.amount = round2(c.amount); c.share = income12 ? Math.round((c.amount / income12) * 100) : 0; });
  const topClients = [...active].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const repeatShare = active.length ? Math.round((active.filter(c => c.payments >= 2).length / active.length) * 100) : 0;
  const idleClients = clients
    .filter(c => c.lastPaid && now - c.lastPaid > 60 * DAY)
    .map(c => ({ ...c, amount: round2(all.filter(e => e.kind === 'income' && e.counterparty?.trim() === c.name).reduce((s, e) => s + e.amount, 0)) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Расходы за 12 месяцев
  const byExpense = new Map<string, number>();
  all.filter(e => e.kind === 'expense' && e.date >= since).forEach(e => byExpense.set(expenseKey(e), (byExpense.get(expenseKey(e)) ?? 0) + e.amount));
  const topExpenses = [...byExpense.entries()]
    .map(([name, amount]) => ({ name, amount: round2(amount), share: expenses12 ? Math.round((amount / expenses12) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount).slice(0, 5);

  // Прогноз: среднее за 3 последних полных месяца на оставшиеся месяцы года
  const avgMonth = round2((months[8].income + months[9].income + months[10].income) / 3);
  const avgExp = (months[8].expenses + months[9].expenses + months[10].expenses) / 3;
  const monthIdx = new Date(now).getMonth();
  const remainingFull = 11 - monthIdx;
  const forecastIncome = round2(ytdIncome + Math.max(0, avgMonth - current.income) + avgMonth * remainingFull);
  const forecastExpenses = ytdExpenses + Math.max(0, avgExp - current.expenses) + avgExp * remainingFull;
  let forecastTax = 0;
  if (regime === 'npd') {
    // Остаток года: доля оплат от компаний/ИП как в этом году (6%), остальное — от физлиц (4%), минус остаток вычета.
    const n = store.npdSummary(year);
    const fromCompanies = n.months.reduce((sum, m) => sum + m.fromCompanies, 0);
    const share = n.income > 0 ? fromCompanies / n.income : 0;
    const rest = Math.max(0, forecastIncome - ytdIncome);
    const gross = rest * (0.04 * (1 - share) + 0.06 * share);
    const deduction = Math.min(n.deductionLeft, rest * (0.01 * (1 - share) + 0.02 * share));
    forecastTax = round2(ytdTax + gross - deduction);
  }
  if (regime === 'usn6' || regime === 'usn15') {
    const u = store.usnSummary(year);
    if (regime === 'usn6') {
      const gross = forecastIncome * 0.06;
      forecastTax = round2(gross - Math.min(u.contributionsFixed + u.contributionsPrevExtra, profile.hasEmployees ? gross * 0.5 : gross));
    } else {
      const extra = onePercent(forecastIncome - forecastExpenses, year);
      forecastTax = round2(Math.max((forecastIncome - forecastExpenses - u.contributionsFixed - extra) * 0.15, forecastIncome * 0.01, 0));
    }
  }
  let npdLimitDate: number | undefined;
  const npdLimitReached = regime === 'npd' && ytdIncome > NPD_LIMIT;
  if (regime === 'npd' && !npdLimitReached && avgMonth > 0) {
    const monthsLeft = (NPD_LIMIT - ytdIncome) / avgMonth;
    const t = now + monthsLeft * 30.4 * DAY;
    if (new Date(t).getFullYear() === year) npdLimitDate = t;
  }

  const changeVsPrev = pct(lastFull.income, prevFull.income);
  const changeVsYear = pct(lastFull.income, sameMonthLastYear.income);

  // Подсказки
  const insights: string[] = [];
  const lastName = monthLabel(lastFull.month, true);
  if (changeVsPrev !== null && changeVsPrev <= -25) insights.push(`Доход за ${lastName} упал на ${Math.abs(changeVsPrev)}% к предыдущему месяцу.`);
  if (changeVsPrev !== null && changeVsPrev >= 25) insights.push(`Доход за ${lastName} вырос на ${changeVsPrev}% к предыдущему месяцу. Так держать!`);
  if (lastFull.income > 0 && lastFull.expenses > lastFull.income) insights.push(`В ${lastName} расходы (${formatRub(lastFull.expenses)}) превысили доходы (${formatRub(lastFull.income)}).`);
  if (topClients[0] && active.length >= 2 && topClients[0].share >= 50) insights.push(`«${topClients[0].name}» приносит ${topClients[0].share}% дохода. Если он уйдёт, просядете сильно: ищите ещё клиентов.`);
  if (npdLimitReached) insights.push('Доход превысил лимит НПД 2,4 млн ₽: с этого момента вы не самозанятый, ФНС снимет с учёта. Если вы ИП — подайте уведомление о переходе на УСН в течение 20 дней с даты снятия, иначе будет общий режим. Если не ИП — для продолжения работы зарегистрируйте ИП.');
  else if (regime === 'npd' && ytdIncome === NPD_LIMIT) insights.push('Лимит НПД 2,4 млн ₽ исчерпан ровно: следующий же доход лишит права на НПД.');
  else if (npdLimitDate) insights.push(`При текущем темпе лимит НПД 2,4 млн ₽ закончится примерно в ${new Date(npdLimitDate).toLocaleDateString('ru-RU', { month: 'long' })}. Заранее подумайте об ИП на УСН.`);
  if (regime === 'npd') {
    const missing = store.npdSummary(year).receiptsMissing;
    const overdue = store.overdueReceipts().length;
    if (overdue) insights.push(`Просрочено чеков: ${overdue} (срок — 9-е число следующего месяца при безналичной оплате, сразу — при наличной). За это ${NPD_RECEIPT_FINE}.`);
    else if (missing) insights.push(`Не выбито чеков: ${missing}. При безналичной оплате чек нужен до 9-го числа следующего месяца, при наличной — сразу.`);
  }
  const rec = store.receivables();
  const overdue = rec.filter(r => r.daysOverdue > 0);
  if (overdue.length) insights.push(`Просрочено счетов: ${overdue.length} на ${formatRub(round2(overdue.reduce((s, r) => s + r.document.total, 0)))}. Отправьте напоминания из вкладки «Должники».`);
  if (idleClients.length) insights.push(`${idleClients.length} ${idleClients.length === 1 ? 'клиент не платил' : 'клиентов не платили'} больше 2 месяцев: напомните о себе (${idleClients.slice(0, 3).map(c => c.name).join(', ')}).`);
  if (active.length >= 3 && repeatShare < 20) insights.push(`Повторных клиентов всего ${repeatShare}%. Скидка на второй заказ или абонемент поднимут выручку.`);
  if (!all.length) insights.push('Пока нет операций. Запишите доход в чате («получил 5000 от Иванова за урок») или загрузите банковскую выписку.');

  return {
    months, current, lastFull, changeVsPrev, changeVsYear,
    ytd: { income: ytdIncome, expenses: ytdExpenses, profit: round2(ytdIncome - ytdExpenses), tax: ytdTax },
    last12: { income: income12, expenses: expenses12, profit: round2(income12 - expenses12), payments: incomes12.length, avgCheck: incomes12.length ? round2(income12 / incomes12.length) : 0, clients: active.length, repeatShare },
    topClients, topExpenses, idleClients,
    forecast: { income: forecastIncome, tax: forecastTax, avgMonth, npdLimitDate, npdLimitReached },
    insights,
  };
}

/** Короткий текст для чата. */
export function analyticsText(a: Analytics): string {
  const lines = [
    `📊 С начала года: доход ${formatRub(a.ytd.income)}, расходы ${formatRub(a.ytd.expenses)}, прибыль ${formatRub(a.ytd.profit)}, налог ${formatRub(a.ytd.tax)}.`,
    `${monthLabel(a.lastFull.month, true)}: ${formatRub(a.lastFull.income)}${a.changeVsPrev !== null ? ` (${a.changeVsPrev >= 0 ? '+' : ''}${a.changeVsPrev}% к пред. месяцу)` : ''}. Текущий месяц пока: ${formatRub(a.current.income)}.`,
    `Средний чек ${formatRub(a.last12.avgCheck)}, клиентов за 12 мес.: ${a.last12.clients}, повторных ${a.last12.repeatShare}%.`,
    `Прогноз на год: доход ≈ ${formatRub(a.forecast.income)}, налог ≈ ${formatRub(a.forecast.tax)}.`,
  ];
  if (a.topClients.length) lines.push(`Топ клиентов: ${a.topClients.slice(0, 3).map(c => `${c.name} ${c.share}%`).join(', ')}.`);
  a.insights.forEach(i => lines.push(`💡 ${i}`));
  return lines.join('\n');
}
