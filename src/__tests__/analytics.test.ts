// Svetlana Business: финансовая аналитика и прогноз
import { describe, it, expect } from 'vitest';
import { computeAnalytics, analyticsText } from '../services/biz/Analytics';
import { BizStore } from '../services/biz/BizStore';
import { detectBizIntent } from '../services/biz/BizTools';
import type { KeyValueStorage } from '../services/crm/CRMStore';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

const NOW = new Date(2026, 9, 11, 12).getTime(); // 11 октября 2026
const d = (month: number, day = 10) => new Date(2026, month, day, 12).getTime();

function seeded(): BizStore {
  const s = new BizStore(memory(), () => NOW);
  s.updateProfile({ regime: 'npd' });
  s.addEntry({ kind: 'income', amount: 70_000, description: 'Проект', date: d(6), counterparty: 'ООО «Альфа»', payerType: 'company' });
  s.addEntry({ kind: 'income', amount: 30_000, description: 'Урок', date: d(6, 20), counterparty: 'Петров', payerType: 'person' });
  s.addEntry({ kind: 'income', amount: 100_000, description: 'Проект', date: d(7), counterparty: 'ООО «Альфа»', payerType: 'company' });
  s.addEntry({ kind: 'income', amount: 50_000, description: 'Проект', date: d(8), counterparty: 'ООО «Альфа»', payerType: 'company' });
  s.addEntry({ kind: 'income', amount: 10_000, description: 'Урок', date: d(9, 5), counterparty: 'Сидорова', payerType: 'person' });
  s.addEntry({ kind: 'expense', amount: 5_000, description: 'Реклама', date: d(8), category: 'Реклама' });
  s.addEntry({ kind: 'expense', amount: 1_000, description: 'Хостинг', date: d(8), category: 'Сервисы' });
  return s;
}

describe('аналитика', () => {
  it('builds 12 months ending with the current one', () => {
    const a = computeAnalytics(seeded());
    expect(a.months).toHaveLength(12);
    expect(a.current.month).toBe('2026-10');
    expect(a.lastFull).toMatchObject({ month: '2026-09', income: 50_000, expenses: 6_000, profit: 44_000 });
    expect(a.changeVsPrev).toBe(-50);
    expect(a.months[0].month).toBe('2025-11');
  });

  it('counts year-to-date, average check, clients and repeat share', () => {
    const a = computeAnalytics(seeded());
    expect(a.ytd).toMatchObject({ income: 260_000, expenses: 6_000, profit: 254_000 });
    expect(a.last12).toMatchObject({ payments: 5, avgCheck: 52_000, clients: 3, repeatShare: 33 });
    expect(a.topClients[0]).toMatchObject({ name: 'ООО «Альфа»', amount: 220_000, share: 85, payments: 3 });
    expect(a.topExpenses[0]).toMatchObject({ name: 'Реклама', amount: 5_000, share: 83 });
  });

  it('forecasts year-end income from the last 3 full months', () => {
    const a = computeAnalytics(seeded());
    // среднее июль–сентябрь = 83 333,33; октябрь добирается до среднего (уже 10 000), + ноябрь и декабрь
    expect(a.forecast.avgMonth).toBe(83_333.33);
    expect(a.forecast.income).toBe(Math.round((260_000 + 73_333.33 + 2 * 83_333.33) * 100) / 100);
    expect(a.forecast.tax).toBeGreaterThan(a.ytd.tax);
    expect(a.forecast.npdLimitDate).toBeUndefined();
  });

  it('gives practical tips', () => {
    const a = computeAnalytics(seeded());
    const all = a.insights.join(' ');
    expect(all).toContain('упал на 50%');
    expect(all).toContain('«ООО «Альфа»» приносит 85%');
    expect(all).toContain('Петров');
    expect(all).toContain('чеков');
    expect(analyticsText(a)).toContain('Прогноз на год');
  });

  it('warns when the НПД limit will run out this year', () => {
    const s = new BizStore(memory(), () => NOW);
    s.updateProfile({ regime: 'npd' });
    [6, 7, 8].forEach(m => s.addEntry({ kind: 'income', amount: 600_000, description: 'x', date: d(m), counterparty: 'Альфа', payerType: 'company' }));
    const a = computeAnalytics(s);
    expect(a.forecast.npdLimitDate).toBeDefined();
    expect(a.insights.join(' ')).toContain('лимит НПД');
  });

  it('handles an empty ledger', () => {
    const a = computeAnalytics(new BizStore(memory(), () => NOW));
    expect(a.ytd.income).toBe(0);
    expect(a.forecast.income).toBe(0);
    expect(a.insights[0]).toContain('Пока нет операций');
  });

  it('routes chat phrases to analytics', () => {
    expect(detectBizIntent('Сколько я заработал?')).toEqual({ tool: 'biz_analytics', args: {} });
    expect(detectBizIntent('покажи аналитику')).toEqual({ tool: 'biz_analytics', args: {} });
    expect(detectBizIntent('сколько налог за месяц')).toEqual({ tool: 'biz_tax_summary', args: {} });
  });
});
