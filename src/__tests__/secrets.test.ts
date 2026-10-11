// Секреты: шифрование ключей, защита от подмены, проверка адресов ИИ и распознавания речи.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { setSecret, getSecret, __setKeyProviderForTests } from '../services/security/SecretStore';
import { validateEndpoint, validateProxyUrl } from '../services/AIGateway';
import { setCloudStt } from '../services/voice/SpeechEngine';

function kv() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const testKey = () => globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;

describe('secret store', () => {
  beforeEach(() => __setKeyProviderForTests(testKey));
  afterAll(() => __setKeyProviderForTests(null));

  it('never writes the key in plain text and reads it back', async () => {
    const s = kv();
    expect(await setSecret('ai.openai', 'sk-SECRET-123', s)).toBe('encrypted');
    expect([...s.m.values()].join('')).not.toContain('sk-SECRET-123');
    expect(await getSecret('ai.openai', s)).toBe('sk-SECRET-123');
  });
  it('rejects tampered or swapped ciphertext', async () => {
    const s = kv();
    await setSecret('ai.a', 'one', s); await setSecret('ai.b', 'two', s);
    s.m.set('svetlana_secret_v1:ai.a', s.m.get('svetlana_secret_v1:ai.b')!); // подмена между записями
    expect(await getSecret('ai.a', s)).toBeNull();
    const o = JSON.parse(s.m.get('svetlana_secret_v1:ai.b')!); o.ct = o.ct.slice(0, -4) + 'AAAA';
    s.m.set('svetlana_secret_v1:ai.b', JSON.stringify(o));
    expect(await getSecret('ai.b', s)).toBeNull();
  });
  it('keeps secrets only in memory when encryption is unavailable', async () => {
    __setKeyProviderForTests(async () => null);
    const s = kv();
    expect(await setSecret('stt.apikey', 'k', s)).toBe('memory');
    expect(s.m.size).toBe(0);
    expect(await getSecret('stt.apikey', s)).toBe('k');
  });
});

describe('endpoints', () => {
  it('allows only local models and official cloud addresses', () => {
    expect(validateEndpoint({ id: 'ollama', type: 'offline', endpoint: 'http://127.0.0.1:11434/' })).toBe('http://127.0.0.1:11434');
    expect(() => validateEndpoint({ id: 'ollama', type: 'offline', endpoint: 'http://evil.example:11434' })).toThrow();
    expect(() => validateEndpoint({ id: 'ollama', type: 'offline', endpoint: 'http://127.0.0.1.evil.com' })).toThrow();
    expect(() => validateEndpoint({ id: 'mistral', type: 'online', endpoint: 'https://api.mistral.ai.evil.com/v1' })).toThrow();
    expect(validateEndpoint({ id: 'mistral', type: 'online', endpoint: 'https://api.mistral.ai/v1' })).toBe('https://api.mistral.ai/v1');
  });
  it('allows the proxy only on our own server', () => {
    expect(validateProxyUrl('/api/ai-proxy')).toBe('/api/ai-proxy');
    expect(() => validateProxyUrl('//evil.com/x')).toThrow();
    expect(() => validateProxyUrl('https://evil.com/proxy')).toThrow();
  });
  it('speech recognition key can go only to Groq or OpenAI', () => {
    const s = kv();
    expect(() => setCloudStt({ baseUrl: 'https://evil.com/v1', apiKey: 'k', model: 'm' }, s)).toThrow();
    setCloudStt({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk-KEY', model: 'whisper-large-v3-turbo' }, s);
    expect([...s.m.values()].join('')).not.toContain('gsk-KEY');
  });
});
