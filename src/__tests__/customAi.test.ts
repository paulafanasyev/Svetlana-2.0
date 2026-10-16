// «Свой ИИ» в приложении для Android: любой OpenAI-совместимый https-сервер. Адрес и ключ уходят в хранилище
// телефона вместе, запрос делает нативная часть, сменить адрес без ключа нельзя.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
// @ts-ignore — node-модули доступны в тестах
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import {
  aiGateway, validateEndpoint, normalizeCustomEndpoint,
  CUSTOM_AI_ANDROID_ONLY, CUSTOM_AI_REENTER_KEY, CUSTOM_AI_BAD_URL,
} from '../services/AIGateway';
import { NATIVE_KEY_PLACEHOLDER, resetNativeConversation } from '../services/security/NativeBridge';

const CID = '0123456789abcdef0123456789abcdef';
const g = globalThis as any;

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

function android(invoke: (cmd: string, args: any) => Promise<unknown>) {
  g.__SVETLANA_PLATFORM__ = 'android';
  g.__TAURI_INTERNALS__ = { invoke };
}

describe('«Свой ИИ» в приложении для Android', () => {
  beforeAll(() => { if (typeof g.localStorage === 'undefined') g.localStorage = memoryStorage(); });
  afterEach(() => { delete g.__SVETLANA_PLATFORM__; delete g.__TAURI_INTERNALS__; resetNativeConversation(); });

  it('normalizes the address like the phone does', () => {
    expect(normalizeCustomEndpoint('https://API.Example.com/v1/')).toBe('https://api.example.com/v1');
    expect(normalizeCustomEndpoint('https://ai.my-server.ru:8443/v1/chat/completions')).toBe('https://ai.my-server.ru:8443/v1');
    expect(normalizeCustomEndpoint('  https://llm.example.org/  ')).toBe('https://llm.example.org');
    for (const bad of [
      'http://api.example.com/v1', 'https://user:pw@api.example.com/v1', 'https://api.example.com/v1?x=1',
      'https://api.example.com/v1#a', 'https://localhost/v1', 'https://api.example.com/v 1',
      'https://api.example.com/%2e%2e/v1', 'javascript:alert(1)', '',
    ]) expect(() => normalizeCustomEndpoint(bad), bad).toThrow(CUSTOM_AI_BAD_URL);
  });

  it('is available only in the Android app', () => {
    expect(() => validateEndpoint({ id: 'custom', type: 'online', endpoint: 'https://api.example.com/v1' })).toThrow(CUSTOM_AI_ANDROID_ONLY);
    android(async () => null);
    expect(validateEndpoint({ id: 'custom', type: 'online', endpoint: 'https://api.example.com/v1/' })).toBe('https://api.example.com/v1');
    expect(() => validateEndpoint({ id: 'custom', type: 'offline', endpoint: 'https://api.example.com/v1' })).toThrow();
  });

  it('address and key go to the phone storage together; chat goes through the native side', async () => {
    const calls: [string, any][] = [];
    android(async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === 'ai_new_conversation') return CID;
      if (cmd === 'ai_cloud_chat') return JSON.stringify({ choices: [{ message: { content: 'ок' } }] });
      return null;
    });
    await aiGateway.ready;
    await aiGateway.addProvider({ id: 'custom', name: 'Свой ИИ', type: 'online', endpoint: 'https://ai.example.com/v1/', model: 'my-model', enabled: true, apiKey: 'sk-CUSTOM-1' });
    expect(aiGateway.getProvider('custom')!.endpoint).toBe('https://ai.example.com/v1');
    expect(aiGateway.getProvider('custom')!.apiKey).toBe(NATIVE_KEY_PLACEHOLDER);
    const set = calls.find(c => c[0] === 'secret_set')!;
    expect(set[1].name).toBe('ai.custom');
    expect(JSON.parse(set[1].value)).toEqual({ endpoint: 'https://ai.example.com/v1', key: 'sk-CUSTOM-1' });
    expect(String(g.localStorage.getItem('svetlana_ai_providers'))).not.toContain('sk-CUSTOM-1');

    const r = await aiGateway.chat([{ role: 'user', content: 'hi' }], undefined, 'custom');
    expect(r.content).toBe('ок');
    const chat = calls.find(c => c[0] === 'ai_cloud_chat')!;
    expect(chat[1].provider).toBe('custom');
    // Адрес и ключ в запрос со страницы не попадают: телефон берёт их из своего хранилища.
    expect(JSON.stringify(chat[1])).not.toContain('sk-CUSTOM-1');
    expect(JSON.stringify(chat[1])).not.toContain('ai.example.com');
  });

  it('changing the address without re-entering the key is refused', async () => {
    const calls: [string, any][] = [];
    android(async (cmd, args) => { calls.push([cmd, args]); return null; });
    expect(() => aiGateway.updateProvider('custom', { endpoint: 'https://evil.example.com/v1' })).toThrow(CUSTOM_AI_REENTER_KEY);
    expect(() => aiGateway.addProvider({ id: 'custom', name: 'Свой ИИ', type: 'online', endpoint: 'https://evil.example.com/v1', model: 'my-model', enabled: true, apiKey: NATIVE_KEY_PLACEHOLDER })).toThrow(CUSTOM_AI_REENTER_KEY);
    expect(aiGateway.getProvider('custom')!.endpoint).toBe('https://ai.example.com/v1');
    expect(calls.filter(c => c[0] === 'secret_set')).toHaveLength(0);

    // Тот же адрес, другая модель — можно без ключа, хранилище не трогается.
    await aiGateway.updateProvider('custom', { model: 'other-model' });
    expect(calls.filter(c => c[0] === 'secret_set')).toHaveLength(0);

    // Новый адрес с новым ключом — уходит в хранилище вместе.
    await aiGateway.addProvider({ id: 'custom', name: 'Свой ИИ', type: 'online', endpoint: 'https://new.example.com/v1', model: 'my-model', enabled: true, apiKey: 'sk-NEW' });
    const set = calls.find(c => c[0] === 'secret_set')!;
    expect(JSON.parse(set[1].value)).toEqual({ endpoint: 'https://new.example.com/v1', key: 'sk-NEW' });
  });

  it('a server without a key is allowed (empty key)', async () => {
    const calls: [string, any][] = [];
    android(async (cmd, args) => { calls.push([cmd, args]); return null; });
    await aiGateway.addProvider({ id: 'custom', name: 'Свой ИИ', type: 'online', endpoint: 'https://open.example.com/v1', model: 'm', enabled: true, apiKey: '' });
    const set = calls.find(c => c[0] === 'secret_set')!;
    expect(JSON.parse(set[1].value)).toEqual({ endpoint: 'https://open.example.com/v1', key: '' });
  });

  it('the phone checks the same rules and asks with the full address', () => {
    const kt = readFileSync(resolve('android-hands/app/src/main/java/ru/svetlana/app/SecureAi.kt'), 'utf8');
    expect(kt).toContain('const val CUSTOM = "custom"');
    expect(kt).toContain('fun customEndpoint(raw: String): String?');
    expect(kt).toContain('Подключить свой ИИ по адресу\\n${c.endpoint}');
    expect(kt).toContain('свой ИИ по адресу $target');
    expect(kt).toContain('exchange(c.endpoint + COMPLETIONS');
    // В Windows своего ИИ нет: список PROVIDERS остаётся одинаковым с secure_ai.rs.
    expect(/PROVIDERS = listOf\(([^)]+)\)/.exec(kt)?.[1]).not.toContain('custom');
  });
});
