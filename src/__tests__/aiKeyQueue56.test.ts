// Пачка 56: два быстрых изменения ключа одного ИИ записываются по очереди, а откат старого
// не затирает новое (иначе в интерфейсе старая модель, а в хранилище новый ключ).
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { aiGateway } from '../services/AIGateway';
import { NATIVE_KEY_PLACEHOLDER } from '../services/security/NativeBridge';

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

describe('AI key writes are ordered and the newest change wins', () => {
  beforeAll(() => {
    if (typeof (globalThis as any).localStorage === 'undefined') (globalThis as any).localStorage = memoryStorage();
  });
  afterEach(() => { delete (globalThis as any).__TAURI_INTERNALS__; });

  it('a failed older change does not roll back a newer one', async () => {
    const order: string[] = [];
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        if (cmd === 'secret_set') {
          order.push(String(args?.value));
          if (args?.value === 'sk-FIRST-111111') {
            await new Promise(r => setTimeout(r, 20));
            throw 'Отменено пользователем';
          }
          return null;
        }
        if (cmd === 'secret_has') return true;
        return null;
      },
    };
    await aiGateway.ready;
    await aiGateway.addProvider({ id: 'openai', name: 'OpenAI', type: 'online', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', enabled: true, apiKey: 'sk-BASE-000000' });
    order.length = 0;
    const first = aiGateway.updateProvider('openai', { apiKey: 'sk-FIRST-111111', model: 'model-a' });
    const second = aiGateway.updateProvider('openai', { apiKey: 'sk-SECOND-222222', model: 'model-b' });
    await expect(first).rejects.toBe('Отменено пользователем');
    await second;
    // Записи шли строго по очереди, новая не обогнала старую.
    expect(order).toEqual(['sk-FIRST-111111', 'sk-SECOND-222222']);
    expect(aiGateway.getProvider('openai')!.model).toBe('model-b');
    expect(aiGateway.getProvider('openai')!.apiKey).toBe(NATIVE_KEY_PLACEHOLDER);
  });

  it('a single cancelled change still rolls back', async () => {
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === 'secret_set') throw 'Отменено пользователем';
        if (cmd === 'secret_has') return true;
        return null;
      },
    };
    await expect(aiGateway.updateProvider('openai', { apiKey: 'sk-THIRD-333333', model: 'model-c' })).rejects.toBe('Отменено пользователем');
    expect(aiGateway.getProvider('openai')!.model).toBe('model-b');
  });
});
