// Повтор команды «записать доход» (ИИ прислал действие дважды) не дублирует доход.
import { describe, it, expect } from 'vitest';
import { BizStore } from '../services/biz/BizStore';
import { createBizTools, DUPLICATE_WINDOW_MS } from '../services/biz/BizTools';

function mem() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}

describe('biz_add_income is not duplicated', () => {
  it('records the same income once within the window, a new one after it', async () => {
    let now = Date.UTC(2026, 9, 1, 10);
    const store = new BizStore(mem(), () => now);
    const tool = createBizTools(store).find(t => t.id === 'biz_add_income')!;
    const a = await tool.execute({ amount: 5000, description: 'урок' });
    const b = await tool.execute({ amount: 5000, description: 'урок' });
    expect(a.success && b.success).toBe(true);
    expect((b.data as any).duplicate).toBe(true);
    expect(store.listEntries({ kind: 'income' })).toHaveLength(1);
    await tool.execute({ amount: 6000, description: 'урок' });
    expect(store.listEntries({ kind: 'income' })).toHaveLength(2);
    now += DUPLICATE_WINDOW_MS + 1;
    await tool.execute({ amount: 5000, description: 'урок' });
    expect(store.listEntries({ kind: 'income' })).toHaveLength(3);
  });
});
