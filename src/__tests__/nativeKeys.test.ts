// Приложение для Windows: ключ облачного ИИ уходит в хранилище Windows и не живёт в JavaScript,
// запрос в облако делает нативная часть (fetch из страницы не вызывается, ключа в аргументах нет).
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { aiGateway } from '../services/AIGateway';
import { NATIVE_KEY_PLACEHOLDER, nativeCloudChat, resetNativeConversation } from '../services/security/NativeBridge';

const CID = '0123456789abcdef0123456789abcdef';

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

describe('desktop app keeps AI keys in the OS keychain', () => {
  beforeAll(() => {
    if (typeof (globalThis as any).localStorage === 'undefined') (globalThis as any).localStorage = memoryStorage();
  });
  afterEach(() => { delete (globalThis as any).__TAURI_INTERNALS__; vi.restoreAllMocks(); resetNativeConversation(); });

  it('stores the key natively and calls the cloud through the native side', async () => {
    const calls: [string, any][] = [];
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        calls.push([cmd, args]);
        if (cmd === 'ai_new_conversation') return CID;
        if (cmd === 'ai_cloud_chat') return JSON.stringify({ choices: [{ message: { content: 'привет' } }] });
        return null;
      },
    };
    const fetchSpy = vi.spyOn(globalThis as any, 'fetch');
    await aiGateway.ready;
    aiGateway.addProvider({ id: 'openai', name: 'OpenAI', type: 'online', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', enabled: true, apiKey: 'sk-TEST-SECRET-KEY-123' });
    expect(aiGateway.getProvider('openai')!.apiKey).toBe(NATIVE_KEY_PLACEHOLDER);
    expect(calls).toContainEqual(['secret_set', { name: 'ai.openai', value: 'sk-TEST-SECRET-KEY-123' }]);
    expect(String((globalThis as any).localStorage.getItem('svetlana_ai_providers'))).not.toContain('sk-TEST-SECRET-KEY-123');

    const r = await aiGateway.chat([{ role: 'user', content: 'hi' }], undefined, 'openai');
    expect(r.content).toBe('привет');
    const chatCall = calls.find(c => c[0] === 'ai_cloud_chat')!;
    expect(chatCall[1].provider).toBe('openai');
    expect(chatCall[1].conversation).toBe(CID);
    expect(JSON.stringify(chatCall[1])).not.toContain('sk-TEST-SECRET-KEY-123');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('editing the provider with the placeholder never overwrites the stored key', async () => {
    const calls: [string, any][] = [];
    (globalThis as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => { calls.push([cmd, args]); return null; } };
    aiGateway.updateProvider('openai', { apiKey: NATIVE_KEY_PLACEHOLDER, model: 'gpt-4o' });
    expect(calls.filter(c => c[0] === 'secret_set')).toHaveLength(0);
  });

  it('asks the native side for a fresh conversation id once when the old one expired', async () => {
    const ids = ['a'.repeat(32), 'b'.repeat(32)];
    const seen: string[] = [];
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        if (cmd === 'ai_new_conversation') return ids.shift();
        if (cmd === 'ai_cloud_chat') {
          seen.push(args.conversation);
          if (seen.length === 1) throw 'CONVERSATION_UNKNOWN: expired';
          return JSON.stringify({ ok: true });
        }
        return null;
      },
    };
    expect(await nativeCloudChat('openai', 'm', {})).toEqual({ ok: true });
    expect(seen).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
  });

  it('never invents a conversation id when the native side returns garbage', async () => {
    const seen: string[] = [];
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        if (cmd === 'ai_new_conversation') return 'not-an-id';
        if (cmd === 'ai_cloud_chat') { seen.push(args.conversation); throw 'other error'; }
        return null;
      },
    };
    await expect(nativeCloudChat('openai', 'm', {})).rejects.toBe('other error');
    expect(seen).toEqual(['']);
  });
});
