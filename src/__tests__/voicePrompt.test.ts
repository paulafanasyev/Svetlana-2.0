// Запрос голосом не получает данных CRM/бизнеса в промпте модели: воспроизведённая запись ничего не узнает.
import { describe, it, expect, beforeAll } from 'vitest';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

describe('voice prompt', () => {
  beforeAll(() => {
    if (typeof (globalThis as any).localStorage === 'undefined') (globalThis as any).localStorage = memoryStorage();
  });

  it('hides CRM and business state when the request came by voice', async () => {
    const { crmSystemPrompt, VOICE_DATA_HIDDEN } = await import('../services/crm/CRMTools');
    const { CRMStore } = await import('../services/crm/CRMStore');
    const store = new CRMStore();
    store.addContact({ name: 'Иван Секретный' } as any);
    const typed = crmSystemPrompt(store);
    const voice = crmSystemPrompt(store, false);
    const summary = store.summaryForAI();
    expect(voice).toContain(VOICE_DATA_HIDDEN);
    if (summary.trim()) expect(voice).not.toContain(summary);
    expect(voice.length).toBeLessThan(typed.length);
    expect(voice).toContain('crm_add_contact'); // действия по-прежнему можно предложить
  });
});
