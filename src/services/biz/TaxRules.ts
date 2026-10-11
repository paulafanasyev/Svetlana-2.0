// Налоговые параметры и сроки РФ, которые меняются по годам. Источники: ст. 430, 346.21, 145, 164, 6.1 НК РФ, 422-ФЗ,
// 425-ФЗ (с 2026), постановление Правительства о переносе выходных на 2026 год. Обновлять каждый год.

const DAY = 86_400_000;

/** Взносы ИП «за себя»: фиксированная часть и потолок 1%-го взноса. */
export const CONTRIBUTIONS: Record<number, { fixed: number; cap1: number }> = {
  2024: { fixed: 49_500, cap1: 277_571 },
  2025: { fixed: 53_658, cap1: 300_888 },
  2026: { fixed: 57_390, cap1: 321_818 },
};
export function contributionsFor(year: number): { fixed: number; cap1: number; known: boolean } {
  const known = CONTRIBUTIONS[year];
  if (known) return { ...known, known: true };
  const years = Object.keys(CONTRIBUTIONS).map(Number).sort((a, b) => a - b);
  const last = CONTRIBUTIONS[year < years[0] ? years[0] : years[years.length - 1]];
  return { ...last, known: false };
}
/** 1% с дохода свыше 300 000 ₽ с учётом потолка. base — доход (УСН 6%) или доходы минус расходы без взносов за себя (УСН 15%, с 2026). */
export function onePercent(base: number, year: number): number {
  return Math.min(contributionsFor(year).cap1, Math.max(0, base - 300_000) * 0.01);
}

// ---------- производственный календарь ----------
const FIXED_HOLIDAYS = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04'];
/** Переносы выходных по постановлениям Правительства: [нерабочие дни, рабочие субботы/воскресенья]. */
const TRANSFERS: Record<number, { off: string[]; work: string[] }> = {
  2025: { off: ['05-02', '05-08', '06-13', '11-03', '12-31'], work: ['11-01'] },
  2026: { off: ['01-09', '03-09', '05-11', '12-31'], work: [] },
};
function mmdd(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isWorkingDay(t: number): boolean {
  const d = new Date(t);
  const key = mmdd(d);
  const tr = TRANSFERS[d.getFullYear()];
  if (tr?.work.includes(key)) return true;
  if (tr?.off.includes(key)) return false;
  if (FIXED_HOLIDAYS.includes(key)) return false;
  const wd = d.getDay();
  return wd !== 0 && wd !== 6;
}
/** Если срок выпадает на выходной или праздник, он переносится на ближайший рабочий день (п. 7 ст. 6.1 НК РФ). */
export function nextWorkingDay(t: number): number {
  let d = new Date(t);
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (let i = 0; i < 15 && !isWorkingDay(d.getTime()); i++) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d.getTime();
}
export function dueDate(year: number, monthIndex: number, day: number): number {
  return nextWorkingDay(new Date(year, monthIndex, day).getTime());
}

// ---------- НПД ----------
/** Способ расчёта: наличные, электронное средство платежа (карта, терминал, QR-эквайринг) или перевод на счёт. */
export type PayMethod = 'cash' | 'card' | 'transfer';
export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  transfer: 'Перевод на счёт / по номеру телефона', card: 'Картой через терминал или эквайринг', cash: 'Наличными',
};
/**
 * Срок чека НПД (ч. 3 ст. 14 422-ФЗ): при наличных и электронных средствах платежа — в момент расчёта
 * (срок = момент оплаты, без отсрочки до конца дня); при иных безналичных расчётах (перевод на счёт) —
 * не позднее 9-го числа следующего месяца.
 */
export function npdReceiptDeadline(paidAt: number, method: PayMethod = 'transfer'): number {
  if (method === 'cash' || method === 'card') return paidAt;
  const d = new Date(paidAt);
  return dueDate(d.getFullYear(), d.getMonth() + 1, 9);
}
export const NPD_RECEIPT_FINE = 'штраф 20% от суммы расчёта, но не менее 200 ₽; при повторном нарушении в течение 6 месяцев — 100% суммы (ст. 129.13 НК РФ)';

// ---------- НДС на УСН (с 2025 года) ----------
export function vatExemptThreshold(year: number): number {
  if (year <= 2025) return 60_000_000;
  if (year === 2026) return 20_000_000;
  if (year === 2027) return 15_000_000;
  return 10_000_000;
}
const DEFLATOR_LIMITS: Record<number, { r5: number; r7: number }> = {
  2025: { r5: 250_000_000, r7: 450_000_000 },
  2026: { r5: 272_500_000, r7: 490_500_000 },
};
export function vatLimits(year: number): { r5: number; r7: number } {
  return DEFLATOR_LIMITS[year] ?? DEFLATOR_LIMITS[2026];
}

export interface VatStatus {
  status: 'exempt' | 'vat' | 'lost_usn';
  rate: number;              // ставка последнего месяца с НДС (0 — освобождение)
  fromMonth?: number;        // первый месяц года с НДС (индекс 0–11)
  lostUsnFromMonth?: number; // месяц, с которого утрачено право на УСН
  rateByMonth: number[];     // ставка по каждому месяцу года: 0 — без НДС
  threshold: number;
  text: string;
}

/** Общая ставка НДС: 20% до 2025 года включительно, 22% с 2026 года (кроме операций по ставкам 10% и 0%). */
export function vatGeneralRateFor(year: number): number {
  return year >= 2026 ? 22 : 20;
}

const monthGen = (year: number, m: number) => new Date(year, m, 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const mln = (n: number) => `${(n / 1e6).toLocaleString('ru-RU')} млн ₽`;

/**
 * Помесячный статус НДС плательщика УСН в году `year` (ст. 145, п. 8 ст. 164 НК РФ, ст. 346.13 НК РФ):
 * - освобождение, пока доход прошлого и текущего года не больше порога (20/15/10 млн);
 * - с месяца, следующего за превышением порога, — 5%; с месяца после превышения 272,5 млн — 7%;
 * - с месяца, в котором доход превысил 490,5 млн, — право на УСН утрачено, общая ставка;
 * - если доход прошлого года больше порога — НДС с января по ставке, определённой по доходу прошлого года
 *   и границам прошлого года (для дохода 2025 года: до 250 млн — 5%, до 450 млн — 7%, выше — УСН уже утрачена).
 * generalRate — выбрана общая ставка 22% (20% до 2026) вместо 5/7%.
 */
export function vatStatusUsn(year: number, prevYearIncome: number, monthlyIncome: number[], generalRate = false): VatStatus {
  const threshold = vatExemptThreshold(year);
  const lim = vatLimits(year);
  const prevLim = vatLimits(year - 1);
  const general = vatGeneralRateFor(year);
  const special = (income: number, l = lim) => (generalRate ? general : income <= l.r5 ? 5 : 7);
  const rates = Array<number>(12).fill(0);
  let lostFrom: number | undefined;
  if (prevYearIncome > prevLim.r7) {
    lostFrom = 0;
  } else {
    let rate = prevYearIncome > threshold ? special(prevYearIncome, prevLim) : 0;
    let acc = 0;
    for (let m = 0; m < 12; m++) {
      acc += monthlyIncome[m] ?? 0;
      if (acc > lim.r7) { lostFrom = m; break; }
      rates[m] = rate;
      if (rate === 0 && acc > threshold) rate = special(acc);
      else if (rate === 5 && acc > lim.r5) rate = 7;
    }
  }
  if (lostFrom !== undefined) for (let m = lostFrom; m < 12; m++) rates[m] = general;
  const fromMonth = rates.findIndex(r => r > 0);
  const last = [...rates].reverse().find(r => r > 0) ?? 0;
  const base = { rateByMonth: rates, threshold, rate: last, fromMonth: fromMonth >= 0 ? fromMonth : undefined, lostUsnFromMonth: lostFrom };
  if (lostFrom !== undefined) {
    const osno = `общий режим и НДС по общим ставкам (${general}%, по отдельным операциям 10% или 0%)`;
    return { ...base, status: 'lost_usn', text: lostFrom === 0
      ? `Доход за ${year - 1} год больше ${mln(prevLim.r7)}: УСН в ${year} году недоступна, нужен ${osno}.`
      : `Доход превысил ${mln(lim.r7)}: с ${monthGen(year, lostFrom)} право на УСН утрачено, ${osno}.` };
  }
  if (fromMonth < 0) {
    return { ...base, status: 'exempt', text: `Освобождение от НДС: доход до ${mln(threshold)} (ст. 145 НК РФ).` };
  }
  const steps: string[] = [];
  let prev = 0;
  rates.forEach((r, m) => { if (r !== prev) { steps.push(`с ${monthGen(year, m)} — ${r}%`); prev = r; } });
  const noDeduct = !generalRate ? ' без вычетов' : '';
  const why = fromMonth === 0 && prevYearIncome > threshold ? `доход за ${year - 1} год больше ${mln(threshold)}` : `доход превысил ${mln(threshold)}`;
  const ratesNote = generalRate ? ` (по отдельным операциям 10% или 0%)` : '';
  return { ...base, status: 'vat', text: `Вы плательщик НДС (${why}): ${steps.join(', ')}${ratesNote}${noDeduct}. Нужны счета-фактуры, книга продаж и декларация по НДС.` };
}

// ---------- ставки УСН ----------
/** Базовые ставки и допустимые региональные пределы (ст. 346.20 НК РФ): 1–6% для «доходов», 5–15% для «доходы минус расходы». */
export const USN_RATE_LIMITS = { usn6: { base: 6, min: 1, max: 6 }, usn15: { base: 15, min: 5, max: 15 } } as const;
export function usnRate(regime: 'usn6' | 'usn15', custom?: number): number {
  const l = USN_RATE_LIMITS[regime];
  return typeof custom === 'number' && Number.isFinite(custom) && custom >= l.min && custom <= l.max ? custom : l.base;
}

// ---------- ПСН ----------
/** Сроки оплаты патента: до 6 месяцев — до окончания; 6–12 месяцев — 1/3 в течение 90 дней и 2/3 до окончания (ст. 346.51 НК РФ). */
export function patentPayments(start: number, end: number, cost: number): { date: number; amount: number; title: string }[] {
  if (!(end > start) || !(cost > 0)) return [];
  const months = (new Date(end).getFullYear() - new Date(start).getFullYear()) * 12 + new Date(end).getMonth() - new Date(start).getMonth() + 1;
  if (months <= 6) return [{ date: nextWorkingDay(end), amount: cost, title: 'Оплата патента' }];
  const third = Math.round((cost / 3) * 100) / 100;
  return [
    { date: nextWorkingDay(start + 89 * DAY), amount: third, title: 'Патент: 1/3 стоимости' },
    { date: nextWorkingDay(end), amount: Math.round((cost - third) * 100) / 100, title: 'Патент: 2/3 стоимости' },
  ];
}
