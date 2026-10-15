import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { onBack, handleBack, backDepth } from '../services/BackStack';
import { wipeAllLocalData } from '../services/security/WipeAll';
import { crmSystemPrompt, importPhoneContacts, PHONE_IMPORT_NOT_ON_ANDROID } from '../services/crm/CRMTools';

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

describe('phone contacts import is a Windows feature', () => {
  it('is not offered to the AI on Android and explains the CSV way', async () => {
    expect(crmSystemPrompt(undefined, false)).toContain('crm_import_phone_contacts');
    asAndroid(vi.fn(async () => null));
    expect(crmSystemPrompt(undefined, false)).not.toContain('crm_import_phone_contacts');
    await expect(importPhoneContacts()).rejects.toThrow(PHONE_IMPORT_NOT_ON_ANDROID);
  });

  it('the chat has no phone-import quick button on Android', () => {
    expect(read('src/pages/AvatarPage.tsx')).toMatch(/android \? QUICK_PHONE : QUICK_DESKTOP/);
  });
});
