import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { onBack, handleBack, backDepth } from '../services/BackStack';
import { wipeAllLocalData } from '../services/security/WipeAll';
import { crmSystemPrompt, importPhoneContacts } from '../services/crm/CRMTools';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const g = globalThis as any;

function asAndroid(invoke: (...a: any[]) => Promise<unknown>) {
  g.__TAURI_INTERNALS__ = { invoke };
  g.__SVETLANA_PLATFORM__ = 'android';
}

afterEach(() => {
  delete g.__TAURI_INTERNALS__;
  delete g.__SVETLANA_PLATFORM__;
});

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

describe('android back button', () => {
  it('closes the top window first, then lets the system exit', () => {
    const closed: string[] = [];
    const offA = onBack(() => closed.push('crm'));
    onBack(() => closed.push('setup'));
    expect(backDepth()).toBe(2);
    expect(handleBack()).toBe(true);
    expect(closed).toEqual(['setup']);
    offA();
    expect(handleBack()).toBe(false);
    expect(closed).toEqual(['setup']);
  });

  it('the activity asks the page before leaving', () => {
    const main = read('android-hands/app/src/main/java/ru/svetlana/app/MainActivity.kt');
    expect(main).toContain('__svetlanaBack');
    expect(read('src/components/CRMLauncher.tsx')).toContain('onBack(close)');
    expect(read('src/components/FirstRunSetup.tsx')).toContain('onBack(');
    expect(read('src/main.tsx')).toContain('installBackButton()');
    expect(read('src/main.tsx')).toContain('installAndroidDownloads()');
  });
});

describe('android wipe', () => {
  it('cancel in the phone dialog keeps every record', async () => {
    asAndroid(vi.fn(async () => { throw 'Отменено пользователем'; }));
    const s = memStore({ svetlana_crm_v1: '{}', svetlana_biz_v1: '{}' });
    await expect(wipeAllLocalData(s as any)).rejects.toBeTruthy();
    expect(s.data.size).toBe(2);
  });

  it('native wipe stops cloud requests that already started', () => {
    const kt = read('android-hands/app/src/main/java/ru/svetlana/app/SecureAi.kt');
    expect(kt).toContain('fun wipeAll(');
    expect(kt).toContain('generation++');
    expect(kt).toContain('if (generation != gen) throw Fail(WIPED)');
    expect(read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt')).toContain('SecureAi.wipeAll(act, act::confirm)');
  });
});

describe('android hands are exact', () => {
  const hands = read('android-hands/app/src/main/java/ru/svetlana/app/HandsService.kt');
  it('a parent button must carry exactly the confirmed label', () => {
    expect(hands).toContain('own.isNotEmpty() && own != q');
  });
  it('a named field is never replaced by another one', () => {
    expect(hands).toContain('findEditable(f, pkg) ?: return false');
  });
});

// Импорт контактов есть везде: на компьютере — с подключённого телефона, в Android — с этого же телефона.
describe('phone contacts import works on Android too', () => {
  it('is offered to the AI everywhere and reads this phone on Android', async () => {
    expect(crmSystemPrompt(undefined, false)).toContain('crm_import_phone_contacts');
    const invoke = vi.fn(async (cmd: string) => (cmd === 'contacts_list'
      ? { contacts: [{ id: '7', name: 'Мама', phones: ['+79990000000'] }, { id: '8', name: '' }] }
      : null));
    asAndroid(invoke);
    expect(crmSystemPrompt(undefined, false)).toContain('crm_import_phone_contacts');
    const importContacts = vi.fn((list: unknown[]) => ({ added: list.length, merged: 0, skipped: 0, total: list.length }));
    const r = await importPhoneContacts({ importContacts } as any);
    expect(invoke).toHaveBeenCalledWith('contacts_list');
    expect(importContacts).toHaveBeenCalledWith([{ name: 'Мама', phones: ['+79990000000'], phoneContactId: '7' }], 'phone');
    expect(r).toMatchObject({ added: 1, pages: 1 });
  });

  it('the chat shows the same quick buttons on every platform', () => {
    const page = read('src/pages/AvatarPage.tsx');
    expect(page).toContain('QUICK_COMMANDS');
    expect(page).not.toMatch(/QUICK_PHONE|QUICK_DESKTOP/);
  });
});
