// Дневные лимиты политики: проверка не списывает, счётчик по дате и переживает перезапуск.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}

const tool = { id: 'demo_limited_tool', name: 'Demo', riskLevel: 'low' } as any;
const ctx = { platform: 'web', environment: {} } as any;

async function fresh() {
  vi.resetModules();
  return (await import('../services/PolicyEngine')).policyEngine;
}

let store: ReturnType<typeof memStorage>;

beforeEach(() => {
  store = memStorage();
  vi.stubGlobal('localStorage', store);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 21, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PolicyEngine: дневные лимиты', () => {
  it('проверка политики лимит не тратит', async () => {
    const pe = await fresh();
    pe.setDailyLimit(tool.id, 2);
    for (let i = 0; i < 5; i++) {
      expect((await pe.evaluate(tool, ctx)).decision).toBe('allow');
    }
    expect(pe.getDailyExecutionCount(tool.id)).toBe(0);
  });

  it('лимит списывает recordExecution, после лимита отказ', async () => {
    const pe = await fresh();
    pe.setDailyLimit(tool.id, 2);
    pe.recordExecution(tool.id);
    expect((await pe.evaluate(tool, ctx)).decision).toBe('allow');
    pe.recordExecution(tool.id);
    expect((await pe.evaluate(tool, ctx)).decision).toBe('deny');
  });

  it('лимит 0 значит «нельзя», а не «без ограничений»', async () => {
    const pe = await fresh();
    pe.setDailyLimit(tool.id, 0);
    expect((await pe.evaluate(tool, ctx)).decision).toBe('deny');
  });

  it('в новый день счётчик с нуля', async () => {
    const pe = await fresh();
    pe.setDailyLimit(tool.id, 1);
    pe.recordExecution(tool.id);
    expect((await pe.evaluate(tool, ctx)).decision).toBe('deny');
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
    expect((await pe.evaluate(tool, ctx)).decision).toBe('allow');
    expect(pe.getDailyExecutionCount(tool.id)).toBe(0);
  });

  it('счётчик и лимит переживают перезапуск, вчерашний счётчик не берётся', async () => {
    let pe = await fresh();
    pe.setDailyLimit(tool.id, 2);
    pe.recordExecution(tool.id);
    pe.recordExecution(tool.id);
    pe = await fresh();
    expect(pe.getDailyLimit(tool.id)).toBe(2);
    expect(pe.getDailyExecutionCount(tool.id)).toBe(2);
    expect((await pe.evaluate(tool, ctx)).decision).toBe('deny');
    vi.setSystemTime(new Date(2026, 9, 23, 8, 0, 0));
    pe = await fresh();
    expect(pe.getDailyExecutionCount(tool.id)).toBe(0);
  });

  it('испорченные записи в хранилище не ломают политику', async () => {
    store.setItem('svetlana_policy', JSON.stringify({ maxDailyExecutions: { [tool.id]: 'abc', other: -3 } }));
    store.setItem('svetlana_policy_counts', '{not json');
    const pe = await fresh();
    expect(pe.getDailyLimit(tool.id)).toBeUndefined();
    expect(pe.getDailyLimit('other')).toBeUndefined();
    expect(pe.getDailyExecutionCount(tool.id)).toBe(0);
  });

  it('Orchestrator списывает лимит только после успешного действия', () => {
    const src = readFileSync(resolve(__dirname, '../services/Orchestrator.ts'), 'utf8');
    const fail = src.indexOf('if (!actionResult.success)');
    const rec = src.indexOf('policyEngine.recordExecution(tool.id)');
    expect(fail).toBeGreaterThan(0);
    expect(rec).toBeGreaterThan(fail);
    expect(src.split('policyEngine.recordExecution(').length - 1).toBe(1);
  });
});
