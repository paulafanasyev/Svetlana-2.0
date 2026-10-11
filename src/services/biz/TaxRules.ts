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
/** Чек по безналичной оплате от физлица/юрлица — не позднее 9-го числа следующего месяца (ч. 3 ст. 14 422-ФЗ). */
export function npdReceiptDeadline(paidAt: number): number {
  const d = new Date(paidAt);
  return dueDate(d.getFullYear(), d.getMonth() + 1, 9);
}
export const NPD_RECEIPT_FINE = 'штраф 20% от суммы расчёта, при повторном нарушении в течение 6 месяцев — 100% (ст. 129.13 НК РФ)';

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
  rate: number;             // 0, 5, 7, 22
  fromMonth?: number;       // индекс месяца, с которого НДС
  threshold: number;
  text: string;
}

/**
 * Статус НДС плательщика УСН в году `year`.
 * prevYearIncome — доход за прошлый год; monthlyIncome — доходы текущего года по месяцам (12 чисел).
 * generalRate — плательщик выбрал общую ставку 22% вместо 5/7%.
 */
export function vatStatusUsn(year: number, prevYearIncome: number, monthlyIncome: number[], generalRate = false): VatStatus {
  const threshold = vatExemptThreshold(year);
  const lim = vatLimits(year);
  const rateFor = (income: number) => (generalRate ? 22 : income <= lim.r5 ? 5 : 7);
  const total = monthlyIncome.reduce((s, x) => s + x, 0);
  if (total > lim.r7) return { status: 'lost_usn', rate: 22, threshold, text: `Доход превысил ${lim.r7.toLocaleString('ru-RU')} ₽: право на УСН утрачено, нужен общий режим и НДС 22%.` };
  if (prevYearIncome > threshold) {
    const rate = rateFor(prevYearIncome);
    return { status: 'vat', rate, fromMonth: 0, threshold, text: `Доход за ${year - 1} год больше ${(threshold / 1e6).toLocaleString('ru-RU')} млн ₽: в ${year} году вы плательщик НДС (${rate}%${rate < 22 ? ' без вычетов' : ''}). Нужны счета-фактуры, книга продаж и декларация по НДС.` };
  }
  let acc = 0;
  for (let m = 0; m < 12; m++) {
    acc += monthlyIncome[m] ?? 0;
    if (acc > threshold) {
      const from = m + 1;
      const rate = rateFor(acc);
      return { status: from > 11 ? 'exempt' : 'vat', rate: from > 11 ? 0 : rate, fromMonth: from > 11 ? undefined : from, threshold,
        text: from > 11 ? `Доход превысил ${(threshold / 1e6).toLocaleString('ru-RU')} млн ₽ в декабре: НДС начнётся с января.` : `Доход превысил ${(threshold / 1e6).toLocaleString('ru-RU')} млн ₽: с ${new Date(year, from, 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} вы плательщик НДС (${rate}%${rate < 22 ? ' без вычетов' : ''}).` };
    }
  }
  return { status: 'exempt', rate: 0, threshold, text: `Освобождение от НДС: доход до ${(threshold / 1e6).toLocaleString('ru-RU')} млн ₽ (ст. 145 НК РФ).` };
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
