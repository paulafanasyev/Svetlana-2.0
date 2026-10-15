import { describe, it, expect, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { wipeAllLocalData } from '../services/security/WipeAll';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const g = globalThis as any;

afterEach(() => { delete g.__TAURI_INTERNALS__; delete g.__SVETLANA_PLATFORM__; });

function memStore(init: Record<string, string>) {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe('windows wipe is all-or-nothing for app data', () => {
  it('a cancelled credential delete keeps CRM and business data', async () => {
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === 'secret_has') return true;
        if (cmd === 'secret_set') throw 'Отменено пользователем';
        return null;
      },
    };
    const s = memStore({ svetlana_crm_v1: '{}', svetlana_biz_v1: '{}' });
    await expect(wipeAllLocalData(s as any)).rejects.toBeTruthy();
    expect(s.data.size).toBe(2);
  });

  it('a failing key check never counts as "no key"', () => {
    const src = read('src/services/security/WipeAll.ts');
    expect(src).toContain('if (!(await nativeHasSecret(name))) continue;');
    expect(src).not.toMatch(/nativeHasSecret\(name\); \} catch/);
  });
});

describe('android wipe blocks new dispatches', () => {
  it('final check and body write happen under the dispatch read lock', () => {
    const kt = read('android-hands/app/src/main/java/ru/svetlana/app/SecureAi.kt');
    expect(kt).toContain('ReentrantReadWriteLock(true)');
    expect(kt).toMatch(/r\.lock\(\)\s+try \{\s+if \(generation != gen\) throw Fail\(WIPED\)\s+c\.outputStream/);
    expect(kt).toContain('dispatch.writeLock()');
  });
});
