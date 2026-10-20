// Пачка 18: CRM отдаёт копии. Изменить контакт, сделку или дело через полученный объект нельзя.
import { describe, it, expect } from 'vitest';
import { CRMStore } from '../services/crm/CRMStore';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('CRMStore returns copies', () => {
  it('contacts, deals and activities are not changed through returned objects', () => {
    const s = new CRMStore(memory(), () => 1000);
    const c = s.addContact({ name: 'Иванов', phones: ['+79123456789'] });
    c.name = 'подмена';
    s.getContact(c.id)!.phones.push('+70000000000');
    s.listContacts()[0].tags.push('vip');
    s.findContactByName('Иванов')!.status = 'client';
    const now = s.getContact(c.id)!;
    expect(now.name).toBe('Иванов');
    expect(now.phones).toEqual(['+79123456789']);
    expect(now.tags).toEqual([]);
    expect(now.status).toBe('lead');

    const d = s.addDeal({ title: 'Сайт', contactId: c.id, amount: 1000 });
    d.amount = 1;
    s.listDeals()[0].stage = 'won';
    expect(s.getDeal(d.id)).toMatchObject({ amount: 1000, stage: 'new' });
    expect(s.stats().wonDeals).toBe(0);

    const a = s.addActivity({ type: 'task', text: 'Позвонить', contactId: c.id });
    a.done = true;
    expect(s.listActivities({ openTasks: true })).toHaveLength(1);
  });

  it('import still merges new phones into the stored contact', () => {
    const s = new CRMStore(memory(), () => 1000);
    const c = s.addContact({ name: 'Петров', emails: ['p@example.com'] });
    const r = s.importContacts([{ name: 'Петров', emails: ['p@example.com'], phones: ['+79990001122'] }]);
    expect(r.merged).toBe(1);
    expect(s.getContact(c.id)!.phones).toEqual(['+79990001122']);
  });

  it('a failing subscriber does not break saving', () => {
    const s = new CRMStore(memory(), () => 1000);
    s.subscribe(() => { throw new Error('screen crashed'); });
    expect(() => s.addContact({ name: 'Сидоров' })).not.toThrow();
    expect(s.listContacts()).toHaveLength(1);
  });
});
