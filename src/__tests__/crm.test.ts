// Svetlana CRM: store, tools and chat integration
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CRMStore, normalizePhone, parseCSV, type KeyValueStorage } from '../services/crm/CRMStore';
import {
  createCRMTools, parseCRMActions, detectCRMIntent, describeResult, importPhoneContacts, crmSystemPrompt,
} from '../services/crm/CRMTools';
import { handsManager } from '../services/HandsManager';
import { HTTPHands } from '../services/HTTPHands';
import { toolRegistry } from '../services/ToolRegistry';

function memory(): KeyValueStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return { raw, getItem: k => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v); } };
}

let now = 1_700_000_000_000;
let storage: ReturnType<typeof memory>;
let store: CRMStore;

beforeEach(() => {
  now = 1_700_000_000_000;
  storage = memory();
  store = new CRMStore(storage, () => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CRMStore contacts', () => {
  it('normalizes phones so different formats match', () => {
    expect(normalizePhone('+7 (912) 345-67-89')).toBe(normalizePhone('89123456789'));
  });

  it('adds, finds, updates and deletes contacts', () => {
    const c = store.addContact({ name: 'Анна Петрова', phones: ['+7 912 345 67 89'], company: 'Ромашка', tags: ['vip'] });
    expect(store.listContacts({ query: 'ромаш' })).toHaveLength(1);
    expect(store.listContacts({ query: '912345' })).toHaveLength(1);
    expect(store.listContacts({ query: 'vip' })).toHaveLength(1);
    store.updateContact(c.id, { status: 'client' });
    expect(store.listContacts({ status: 'client' })[0].name).toBe('Анна Петрова');
    store.deleteContact(c.id);
    expect(store.listContacts()).toHaveLength(0);
  });

  it('rejects empty names', () => {
    expect(() => store.addContact({ name: '  ' })).toThrow();
  });

  it('imports with de-duplication and merges new phone numbers', () => {
    const first = store.importContacts([
      { name: 'Анна', phones: ['+7 912 345 67 89'], phoneContactId: '1' },
      { name: 'Анна (дубль)', phones: ['89123456789'] },
      { name: 'Борис', phones: ['+7 900 111 22 33'] },
      { name: '' },
    ], 'phone');
    expect(first).toEqual({ added: 2, merged: 0, skipped: 2, total: 4 });
    const second = store.importContacts([{ name: 'Анна', phones: ['+7 912 345 67 89', '+7 999 000 00 00'], phoneContactId: '1' }]);
    expect(second.merged).toBe(1);
    expect(store.findContactByName('анна')?.phones).toHaveLength(2);
  });

  it('persists to storage and survives reload', () => {
    store.addContact({ name: 'Вера' });
    const reloaded = new CRMStore(storage, () => now);
    expect(reloaded.listContacts()[0].name).toBe('Вера');
  });

  it('survives corrupted storage', () => {
    storage.raw.set('svetlana_crm_v1', '{not json');
    expect(new CRMStore(storage).listContacts()).toEqual([]);
  });
});

describe('CRMStore deals, tasks and stats', () => {
  it('tracks pipeline value, won deals and closedAt', () => {
    const c = store.addContact({ name: 'Клиент' });
    const d = store.addDeal({ title: 'Сайт', contactId: c.id, amount: 50000 });
    store.addDeal({ title: 'Аудит', amount: 10000, stage: 'proposal' });
    expect(store.stats().pipelineValue).toBe(60000);
    now += 1000;
    const won = store.moveDeal(d.id, 'won');
    expect(won.closedAt).toBe(now);
    const s = store.stats();
    expect(s.wonValue).toBe(50000);
    expect(s.pipelineValue).toBe(10000);
    expect(s.openDeals).toBe(1);
    expect(store.moveDeal(d.id, 'negotiation').closedAt).toBeUndefined();
  });

  it('rejects negative amounts and unknown contacts', () => {
    expect(() => store.addDeal({ title: 'x', amount: -5 })).toThrow();
    expect(() => store.addDeal({ title: 'x', contactId: 'nope' })).toThrow();
  });

  it('counts open and overdue tasks; logging a call updates lastContactAt', () => {
    const c = store.addContact({ name: 'Иван' });
    store.addActivity({ type: 'task', text: 'Позвонить', contactId: c.id, dueAt: now - 1 });
    const t2 = store.addActivity({ type: 'task', text: 'Отправить КП', dueAt: now + 86_400_000 });
    store.addActivity({ type: 'call', text: 'Обсудили цену', contactId: c.id });
    expect(store.getContact(c.id)?.lastContactAt).toBe(now);
    expect(store.stats()).toMatchObject({ openTasks: 2, overdueTasks: 1 });
    store.setActivityDone(t2.id, true);
    expect(store.stats().openTasks).toBe(1);
    expect(store.summaryForAI()).toContain('Позвонить');
  });

  it('unlinks deals and history when a contact is deleted', () => {
    const c = store.addContact({ name: 'Удаляемый' });
    const d = store.addDeal({ title: 'Сделка', contactId: c.id });
    store.addActivity({ type: 'note', text: 'Заметка', contactId: c.id });
    store.deleteContact(c.id);
    expect(store.getDeal(d.id)?.contactId).toBeUndefined();
    expect(store.listActivities()[0].contactId).toBeUndefined();
  });
});

describe('CRM import/export', () => {
  it('round-trips contacts through CSV with quoting', () => {
    store.addContact({ name: 'ООО "Ромашка", отдел', phones: ['+7 900 000 00 01'], emails: ['A@Example.com'] });
    const csv = store.exportContactsCSV();
    const other = new CRMStore(memory(), () => now);
    expect(other.importContactsCSV(csv).added).toBe(1);
    const c = other.listContacts()[0];
    expect(c.name).toBe('ООО "Ромашка", отдел');
    expect(c.emails).toEqual(['a@example.com']);
    expect(c.phones).toEqual(['+7 900 000 00 01']);
  });

  it('neutralises spreadsheet formulas in CSV export', () => {
    store.addContact({ name: '=HYPERLINK("http://evil")' });
    expect(store.exportContactsCSV()).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('parses CSV with BOM, quotes and CRLF', () => {
    expect(parseCSV('\uFEFFa,"b ""q"", c"\r\n1,2\n')).toEqual([['a', 'b "q", c'], ['1', '2']]);
  });

  it('restores a JSON backup and rejects garbage', () => {
    store.addContact({ name: 'Резерв' });
    store.addDeal({ title: 'Д', amount: 1 });
    const backup = store.exportJSON();
    store.clearAll();
    expect(store.importJSON(backup)).toEqual({ contacts: 1, deals: 1, activities: 0 });
    expect(() => store.importJSON('nope')).toThrow();
  });
});

describe('CRM tools', () => {
  const tool = (id: string) => {
    const t = createCRMTools(store).find(x => x.id === id);
    if (!t) throw new Error(`no tool ${id}`);
    return t;
  };

  it('creates a contact, a deal for it, a task and moves the deal', async () => {
    const created = await tool('crm_add_contact').execute({ name: 'Иван', phones: '+7 900 1, 8 900 2', status: 'client' });
    expect(created.success).toBe(true);
    expect((await tool('crm_add_contact').execute({ name: 'Иван 2', phones: '+7 900 1' })).data.duplicate).toBe(true);
    const deal = await tool('crm_create_deal').execute({ title: 'Поставка', contact: 'иван', amount: 12000 });
    expect(deal.success).toBe(true);
    expect((await tool('crm_add_task').execute({ text: 'Позвонить', contact: 'Иван', due: '2026-10-15' })).success).toBe(true);
    expect((await tool('crm_add_task').execute({ text: 'x', due: 'завтра' })).success).toBe(false);
    const moved = await tool('crm_move_deal').execute({ deal: 'поставка', stage: 'won' });
    expect(moved.data.stage).toBe('Выиграна');
    expect((await tool('crm_complete_task').execute({ task: 'позвон' })).success).toBe(true);
    expect((await tool('crm_stats').execute({})).data.wonValue).toBe(12000);
  });

  it('reports unknown contacts instead of inventing them', async () => {
    const r = await tool('crm_add_note').execute({ contact: 'Никто', text: 'привет' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Никто');
  });

  it('imports every page of phone contacts over the bridge', async () => {
    const contacts = Array.from({ length: 2300 }, (_, i) => ({ id: String(i), name: `Контакт ${i}`, phones: [`+7900${String(i).padStart(7, '0')}`] }));
    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' });
    vi.spyOn(hands, 'listContacts').mockImplementation(async ({ limit = 500, offset = 0 } = {}) =>
      ({ total: contacts.length, offset, contacts: contacts.slice(offset, offset + limit) }));
    vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    const report = await importPhoneContacts(store);
    expect(report).toMatchObject({ added: 2300, pages: 3 });
    expect((await importPhoneContacts(store)).added).toBe(0);
  });

  it('explains how to connect when the phone is offline', async () => {
    const r = await tool('crm_import_phone_contacts').execute({});
    expect(r.success).toBe(false);
    expect(r.error).toContain('Телефон не подключён');
  });

  it('registers all CRM tools in the global registry', () => {
    expect(toolRegistry.getTool('crm_add_contact')).toBeDefined();
    expect(toolRegistry.getTool('crm_import_phone_contacts')).toBeDefined();
  });
});

describe('CRM chat integration', () => {
  it('detects the "put all contacts into CRM" command', () => {
    expect(detectCRMIntent('Найди все контакты и занеси их в CRM')?.tool).toBe('crm_import_phone_contacts');
    expect(detectCRMIntent('сколько клиентов в црм?')?.tool).toBe('crm_stats');
    expect(detectCRMIntent('Расскажи шутку')).toBeNull();
  });

  it('parses CRM action blocks from an AI reply', () => {
    const reply = 'Готово.\n[CRM: {"tool":"crm_add_contact","args":{"name":"Иван"}}]\n[CRM: {broken}]\n[CRM: {"tool":"open_app","args":{}}] [EMOTION: happy]';
    const { clean, actions, invalid } = parseCRMActions(reply);
    expect(actions).toEqual([{ tool: 'crm_add_contact', args: { name: 'Иван' } }]);
    expect(invalid).toBe(2);
    expect(clean).not.toContain('[CRM');
    expect(clean).toContain('[EMOTION: happy]');
  });

  it('describes results in Russian', () => {
    expect(describeResult('crm_import_phone_contacts', { success: true, data: { added: 3, merged: 1, skipped: 0, total: 4 } })).toContain('добавлено 3');
    expect(describeResult('crm_add_contact', { success: false, error: 'плохо' })).toContain('плохо');
  });

  it('gives the AI the CRM state and the action format', () => {
    store.addContact({ name: 'Лид', status: 'lead' });
    const prompt = crmSystemPrompt(store);
    expect(prompt).toContain('Контактов: 1');
    expect(prompt).toContain('[CRM: {"tool"');
  });
});
