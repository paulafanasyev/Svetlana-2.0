// Пачка 57: два окна Светланы не стирают изменения друг друга в CRM и «Бизнесе».
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CRMStore, CRM_CHANGED_ELSEWHERE, type KeyValueStorage } from '../services/crm/CRMStore';
import { BizStore, BIZ_CHANGED_ELSEWHERE, BIZ_SAVE_FAILED } from '../services/biz/BizStore';
import { changedElsewhere } from '../services/security/SyncedKey';

function shared(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

describe('CRM in two windows', () => {
  it('an old copy does not overwrite a contact added in the other window', () => {
    const disk = shared();
    const a = new CRMStore(disk);
    const b = new CRMStore(disk);
    a.addContact({ name: 'Иванов' });
    expect(() => b.addContact({ name: 'Петров' })).toThrow(CRM_CHANGED_ELSEWHERE);
    // Второе окно уже видит Иванова, повтор сохраняет обоих.
    expect(b.listContacts().map(c => c.name)).toEqual(['Иванов']);
    b.addContact({ name: 'Петров' });
    const fresh = new CRMStore(disk);
    expect(fresh.listContacts().map(c => c.name).sort()).toEqual(['Иванов', 'Петров']);
  });

  it('one window keeps working normally', () => {
    const disk = shared();
    const a = new CRMStore(disk);
    a.addContact({ name: 'Один' });
    a.addContact({ name: 'Два' });
    expect(new CRMStore(disk).listContacts()).toHaveLength(2);
  });

  it('the screen is told about fresh data from the other window', () => {
    const disk = shared();
    const a = new CRMStore(disk);
    const b = new CRMStore(disk);
    let calls = 0;
    b.subscribe(() => { calls++; });
    a.addContact({ name: 'Иванов' });
    expect(() => b.addContact({ name: 'Петров' })).toThrow();
    expect(calls).toBe(1);
  });

  it('unknown disk state never blocks a save', () => {
    expect(changedElsewhere(undefined, 'x')).toBe(false);
    expect(changedElsewhere('x', undefined)).toBe(false);
    expect(changedElsewhere('x', 'x')).toBe(false);
    expect(changedElsewhere('y', 'x')).toBe(true);
    expect(changedElsewhere(null, 'x')).toBe(true);
  });
});

describe('Biz in two windows', () => {
  it('an old copy does not overwrite income recorded in the other window', () => {
    const disk = shared();
    const a = new BizStore(disk);
    const b = new BizStore(disk);
    a.addEntry({ kind: 'income', amount: 1000, description: 'Первый' });
    expect(() => b.addEntry({ kind: 'income', amount: 500, description: 'Второй' })).toThrow(BIZ_CHANGED_ELSEWHERE);
    expect(b.listEntries().map(e => e.description)).toEqual(['Первый']);
    b.addEntry({ kind: 'income', amount: 500, description: 'Второй' });
    const fresh = new BizStore(disk);
    expect(fresh.listEntries().map(e => e.description).sort()).toEqual(['Второй', 'Первый']);
  });

  it('a failed save still rolls back and keeps the old data', () => {
    let fail = false;
    const m = new Map<string, string>();
    const disk: KeyValueStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => { if (fail) throw new Error('quota'); m.set(k, v); } };
    const s = new BizStore(disk);
    s.addEntry({ kind: 'income', amount: 100, description: 'Есть' });
    fail = true;
    expect(() => s.addEntry({ kind: 'income', amount: 200, description: 'Нет' })).toThrow(BIZ_SAVE_FAILED);
    expect(s.listEntries()).toHaveLength(1);
    fail = false;
    s.addEntry({ kind: 'expense', amount: 50, description: 'Потом' });
    expect(new BizStore(disk).listEntries()).toHaveLength(2);
  });

  it('both stores listen for writes from other windows', () => {
    for (const p of ['src/services/crm/CRMStore.ts', 'src/services/biz/BizStore.ts']) {
      const src = readFileSync(resolve(__dirname, '..', '..', p), 'utf8');
      expect(src).toContain('onOtherTabWrite(');
      expect(src).toContain('changedElsewhere(');
    }
  });
});
