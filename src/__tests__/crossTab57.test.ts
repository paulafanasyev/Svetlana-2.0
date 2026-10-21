// Пачка 57: два окна Светланы не стирают изменения друг друга в CRM и «Бизнесе».
import { describe, it, expect } from 'vitest';
import { CRMStore, CRM_CHANGED_ELSEWHERE, type KeyValueStorage } from '../services/crm/CRMStore';
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
