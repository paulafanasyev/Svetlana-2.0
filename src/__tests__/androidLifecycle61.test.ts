import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const dir = resolve(__dirname, '../../android-hands/app/src/main/java/ru/svetlana/app');
const bridge = readFileSync(resolve(dir, 'Bridge.kt'), 'utf8');
const ai = readFileSync(resolve(dir, 'SecureAi.kt'), 'utf8');

const OPEN = 'val SHIM = """';

/** Настоящий SHIM из Bridge.kt в «окне» с поддельным портом приложения. */
function loadShim() {
  const start = bridge.indexOf(OPEN) + OPEN.length;
  const code = bridge.slice(start, bridge.indexOf('"""', start));
  expect(code).not.toContain('$');
  const sent: any[] = [];
  const port: any = { postMessage: (s: string) => { sent.push(JSON.parse(s)); } };
  const win: any = { SvetlanaNative: port };
  new Function('window', code)(win);
  return { invoke: win.__TAURI_INTERNALS__.invoke as (cmd: string, args?: unknown) => Promise<unknown>, port, sent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('phone bridge requests never hang', () => {
  it('a request without a reply fails after the deadline', async () => {
    vi.useFakeTimers();
    const { invoke } = loadShim();
    const err = invoke('secret_has', { name: 'ai.openai' }).catch((e: unknown) => e);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(String(await err)).toContain('не ответило вовремя');
  });

  it('a reply resolves and clears its timer', async () => {
    vi.useFakeTimers();
    const { invoke, port, sent } = loadShim();
    const p = invoke('app_info');
    expect(vi.getTimerCount()).toBe(1);
    port.onmessage({ data: JSON.stringify({ id: sent[0].id, ok: true, value: 5 }) });
    expect(await p).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
    // Поздний ответ на уже закрытый запрос ничего не ломает.
    port.onmessage({ data: JSON.stringify({ id: sent[0].id, ok: false, error: 'x' }) });
  });

  it('the speech model download gets a longer deadline', async () => {
    vi.useFakeTimers();
    const { invoke } = loadShim();
    let settled = false;
    const err = invoke('local_stt_install').catch((e: unknown) => e).finally(() => { settled = true; });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(56 * 60 * 1000);
    expect(String(await err)).toContain('не ответило вовремя');
  });

  it('a broken port rejects at once and leaves no timer', async () => {
    vi.useFakeTimers();
    const { invoke, port } = loadShim();
    port.postMessage = () => { throw new Error('gone'); };
    await expect(invoke('app_info')).rejects.toContain('недоступна');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('closing the screen cancels cloud calls', () => {
  it('bridge close calls SecureAi.cancelAll', () => {
    const close = bridge.slice(bridge.indexOf('fun close()'));
    expect(close).toContain('SecureAi.cancelAll()');
  });

  it('cancelAll cuts connections but keeps keys and consents', () => {
    const start = ai.indexOf('fun cancelAll()');
    expect(start).toBeGreaterThan(0);
    const body = ai.slice(start, ai.indexOf('\n    }\n', start));
    expect(body).toContain('generation++');
    expect(body).toContain('it.disconnect()');
    expect(body).toContain('active.clear()');
    expect(body).not.toContain('SecretStore');
    expect(body).not.toContain('consents.clear()');
  });
});
