// CRM сохраняет «всё или ничего»: если хранилище не приняло запись, изменение отменяется и в памяти тоже.
import { describe, it, expect } from 'vitest';
import { CRMStore, CRM_SAVE_FAILED, type KeyValueStorage } from '../services/crm/CRMStore';

function flakyStorage() {
  const map = new Map<string, string>();
  let full = false;
  const storage: KeyValueStorage = {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => {
      if (full) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
  };
  return { storage, setFull: (v: boolean) => { full = v; } };
}

describe('CRM saves all or nothing', () => {
  it('rolls back a change that could not be saved', () => {
    const s = flakyStorage();
    const crm = new CRMStore(s.storage, () => 1);
    const anna = crm.addContact({ name: 'Анна' });
    s.setFull(true);
    expect(() => crm.addContact({ name: 'Борис' })).toThrow(CRM_SAVE_FAILED);
    expect(crm.listContacts().map(c => c.name)).toEqual(['Анна']);
    expect(() => crm.updateContact(anna.id, { name: 'Анна Петрова' })).toThrow(CRM_SAVE_FAILED);
    expect(crm.getContact(anna.id)?.name).toBe('Анна');
    expect(() => crm.addDeal({ title: 'Сайт', contactId: anna.id, amount: 1000 })).toThrow(CRM_SAVE_FAILED);
    expect(crm.listDeals()).toHaveLength(0);
    expect(() => crm.clearAll()).toThrow(CRM_SAVE_FAILED);
    expect(crm.listContacts()).toHaveLength(1);
    s.setFull(false);
    crm.addContact({ name: 'Борис' });
    expect(new CRMStore(s.storage).listContacts().map(c => c.name)).toEqual(['Анна', 'Борис']);
  });

  it('does not notify listeners about a failed save', () => {
    const s = flakyStorage();
    const crm = new CRMStore(s.storage);
    let calls = 0;
    crm.subscribe(() => { calls++; });
    s.setFull(true);
    expect(() => crm.addContact({ name: 'X' })).toThrow(CRM_SAVE_FAILED);
    expect(calls).toBe(0);
    s.setFull(false);
    crm.addContact({ name: 'Y' });
    expect(calls).toBe(1);
  });
});
