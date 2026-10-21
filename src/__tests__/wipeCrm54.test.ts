// Пачка 54: «Удалить все данные» побеждает и начатое чтение ключа; окно CRM делает страницу под собой недоступной.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { setSecret, getSecret, clearAllSecrets, __setKeyProviderForTests } from '../services/security/SecretStore';

function kv() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
  };
}

const newKey = () => globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;

afterEach(() => __setKeyProviderForTests(null));

describe('wipe beats a secret read in progress', () => {
  it('a read that started before the wipe returns nothing', async () => {
    const key = await newKey();
    const s = kv();
    __setKeyProviderForTests(async () => key);
    expect(await setSecret('groq', 'secret-1', s)).toBe('encrypted');
    let open!: () => void;
    const gate = new Promise<void>(r => { open = r; });
    __setKeyProviderForTests(() => gate.then(() => key));
    const reading = getSecret('groq', s);
    await clearAllSecrets(s);
    open();
    expect(await reading).toBeNull();
  });

  it('normal reads still work', async () => {
    const key = await newKey();
    const s = kv();
    __setKeyProviderForTests(async () => key);
    await setSecret('groq', 'secret-2', s);
    expect(await getSecret('groq', s)).toBe('secret-2');
  });
});

describe('CRM overlay is a real modal', () => {
  const src = readFileSync(resolve(__dirname, '../components/CRMLauncher.tsx'), 'utf8');
  it('isolates the page under it and keeps confirmations reachable', () => {
    expect(src).toContain("import { isolateDialog } from './useDialogFocus';");
    expect(src).toContain('const release = isolateDialog(root);');
    expect(src).toContain('<div data-svetlana-dialogs=""><ActionConfirmHost /></div>');
    // inert снимается раньше, чем фокус возвращается на кнопку: эффект изоляции объявлен до эффекта фокуса.
    expect(src.indexOf('isolateDialog(root)')).toBeLessThan(src.indexOf('back?.focus()'));
  });
  it('buttons are at least 44 px', () => {
    expect(src.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
