// Ошибки облачных ИИ в браузере не содержат ключ, а зависший сервер не оставляет чат в вечном ожидании.
import { describe, it, expect } from 'vitest';
import { scrubApiError, fetchAi, AI_TIMEOUT_TEXT } from '../services/AIGateway';

describe('AI error text is safe', () => {
  it('removes the exact key of any length, key-like strings and Bearer tokens', () => {
    const out = scrubApiError('Invalid key abc123 for Bearer abcdefghijk and sk-proj-AAAAAAAAAAAAAAAA', ['abc123']);
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('abcdefghijk');
    expect(out).not.toContain('sk-proj-AAAA');
    expect(out).toContain('[ключ скрыт]');
  });

  it('drops invisible characters and caps the length', () => {
    const out = scrubApiError('a\u202Eb\u0007c ' + 'x'.repeat(1000));
    expect(out).not.toMatch(/[\u202E\u0007]/);
    expect(out.length).toBeLessThanOrEqual(300);
  });

  it('turns objects into text', () => {
    expect(scrubApiError({ code: 401 })).toContain('401');
    expect(scrubApiError(undefined)).toBe('');
  });
});

describe('AI requests time out', () => {
  it('aborts a hanging request with a clear message', async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    });
    await expect(fetchAi('http://127.0.0.1:1/x', { method: 'POST' }, 20, hang)).rejects.toThrow(AI_TIMEOUT_TEXT);
  });

  it('passes a normal answer through', async () => {
    const ok: typeof fetch = async () => new Response('{}', { status: 200 });
    const r = await fetchAi('http://127.0.0.1:1/x', { method: 'GET' }, 1000, ok);
    expect(r.status).toBe(200);
  });
});
