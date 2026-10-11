// Безопасность: шлюз подтверждений для действий модели/голоса, безопасный JSON/CSV/ICS, импорт резервных копий.
import { describe, it, expect, beforeEach } from 'vitest';
import { authorizeAction, needsConfirmation, setActionConfirmer, resetActionGate, summarizeAction, userGesture, stricterSource } from '../services/security/ActionGate';
import { toolRegistry } from '../services/ToolRegistry';
import { safeJsonParse, csvSafe, csvUnescape, sanitizeArgs, stripControl, assertFileSize } from '../services/security/SafeData';
import { parseCRMActions, runCRMActions } from '../services/crm/CRMTools';
import { BizStore } from '../services/biz/BizStore';
import { renderDocumentHTML } from '../services/biz/DocTemplates';
import { toICS } from '../services/biz/Booking';
import type { KeyValueStorage } from '../services/crm/CRMStore';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

beforeEach(() => resetActionGate());

describe('action gate', () => {
  it('asks before LLM/voice writes, lets reads and user commands through', async () => {
    expect(needsConfirmation('biz_add_income', 'llm')).toBe(true);
    expect(needsConfirmation('biz_add_income', 'voice')).toBe(true);
    expect(needsConfirmation('biz_add_income', 'user')).toBe(false);
    expect(needsConfirmation('biz_tax_summary', 'llm')).toBe(false);
    const asked: string[] = [];
    setActionConfirmer(async (_req, s) => { asked.push(`${s.title}|${s.lines.join(',')}`); return false; });
    expect(await authorizeAction({ tool: 'biz_add_income', args: { amount: 999999 }, source: 'llm' })).toBe(false);
    expect(asked[0]).toContain('Записать доход|Сумма: 999999');
    expect(await authorizeAction({ tool: 'biz_tax_summary', args: {}, source: 'llm' })).toBe(true);
  });

  it('never runs a model-proposed write that the user declined', async () => {
    setActionConfirmer(async () => false);
    const { actions } = parseCRMActions('Готово [CRM: {"tool":"biz_add_income","args":{"amount":100,"__proto__":{"x":1}}}]');
    expect(actions[0].source).toBe('llm');
    const lines = await runCRMActions(actions);
    expect(lines[0]).toContain('Не выполнено без вашего подтверждения');
  });

  it('limits the number of actions per reply and validates tool names', () => {
    const many = Array.from({ length: 9 }, () => '[CRM: {"tool":"crm_stats","args":{}}]').join(' ');
    expect(parseCRMActions(many).actions).toHaveLength(5);
    expect(parseCRMActions('[CRM: {"tool":"crm_x; rm -rf","args":{}}]').actions).toHaveLength(0);
  });

  it('gates every registry call, including direct ones (orchestrator, retries)', async () => {
    let ran = 0;
    toolRegistry.registerTool({ id: 'test_write', name: 't', description: 't', category: 'data', riskLevel: 'low',
      inputSchema: { type: 'object', properties: {} }, async execute() { ran++; return { success: true }; }, async isAvailable() { return true; } });
    setActionConfirmer(async () => false);
    const r = await toolRegistry.executeTool('test_write', {});
    expect(r.denied).toBe(true);
    expect(ran).toBe(0);
    expect((await toolRegistry.executeWithConfirmation('test_write', {})).denied).toBe(true);
    expect((await toolRegistry.executeTool('test_write', {}, { source: 'user' })).denied).toBe(true); // 'user' без жеста
    expect(ran).toBe(0);
    toolRegistry.unregisterTool('test_write');
  });

  it('does not let callers forge the user source', async () => {
    const asked: string[] = [];
    setActionConfirmer(async (req) => { asked.push(req.source); return false; });
    expect(await authorizeAction({ tool: 'biz_add_income', args: {}, source: 'user' })).toBe(false);
    expect(asked).toEqual(['unknown']);
    expect(await authorizeAction({ tool: 'biz_add_income', args: {}, source: 'user', gesture: userGesture({ isTrusted: false }) })).toBe(false);
    const g = userGesture({ isTrusted: true });
    expect(await authorizeAction({ tool: 'biz_add_income', args: {}, source: 'user', gesture: g })).toBe(true);
    expect(await authorizeAction({ tool: 'biz_add_income', args: {}, source: 'user', gesture: g })).toBe(false); // жест одноразовый
    expect(stricterSource('user', 'llm')).toBe('llm');
    expect(stricterSource(undefined, 'user')).toBe('unknown');
  });

  it('shows every argument, including nested ones, without bidi tricks', () => {
    const s = summarizeAction({ tool: 'crm_add_contact', args: { name: 'a\u202Eb', tags: ['x', 'y'], notes: 'н'.repeat(500) }, source: 'llm' });
    expect(s.lines).toContain('Имя: ab');
    expect(s.lines.some(l => l.includes('["x","y"]'))).toBe(true);
    expect(s.lines.some(l => l.length > 500)).toBe(true);
  });

  it('denies when there is no UI to confirm', async () => {
    expect(await authorizeAction({ tool: 'crm_add_contact', args: { name: 'X' }, source: 'llm' })).toBe(false);
    expect(summarizeAction({ tool: 'crm_add_contact', args: { name: 'X' }, source: 'voice' }).sourceLabel).toBe('Распознано голосом');
  });
});

describe('safe data', () => {
  it('drops prototype-polluting keys and enforces size limits', () => {
    const v = safeJsonParse('{"a":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"p":1}}}') as any;
    expect(v.a).toBe(1);
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.keys(v)).toEqual(['a']);
    expect(() => safeJsonParse('[1]', 2)).toThrow();
    expect(() => assertFileSize({ size: 30 * 1024 * 1024 }, 20 * 1024 * 1024)).toThrow();
  });
  it('neutralizes spreadsheet formulas, including leading whitespace and +/- tricks', () => {
    for (const bad of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', ' =cmd()', '\t=1', '\uFF1D1']) expect(csvSafe(bad).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvSafe('Иванов')).toBe('Иванов');
    expect(csvSafe('+7 900 000-00-01')).toBe('+7 900 000-00-01');
    expect(csvSafe('+7 (900) 1+1').startsWith("'")).toBe(true);
    expect(csvUnescape("'=1+1")).toBe('=1+1');
    expect(csvUnescape("'Иван")).toBe("'Иван");
    expect(csvSafe('a;b', ';')).toBe('"a;b"');
  });
  it('cleans tool arguments and control characters', () => {
    expect(sanitizeArgs({ amount: Infinity, ok: 'x'.repeat(5000), 'bad-key': 1, nested: { a: 1 } })).toEqual({ ok: 'x'.repeat(2000), nested: { a: 1 } });
    expect(stripControl('a\u202Ebc')).toBe('abc');
  });
});

describe('hardened stores and exports', () => {
  it('rejects junk in a business backup instead of crashing the documents page', () => {
    const store = new BizStore(memory(), () => Date.now());
    store.importJSON(JSON.stringify({ version: 1, documents: [{ id: 'd1', items: [{ name: {}, qty: 1, price: 1 }], date: 1 }, { id: 'd2', type: 'invoice', date: Date.now(), items: [{ name: '<img src=x onerror=alert(1)>', qty: 1, price: 10 }] }], ledger: [{ id: 'e', amount: 'NaN', date: 1 }] }));
    const docs = store.listDocuments();
    expect(docs).toHaveLength(1);
    const html = renderDocumentHTML(docs[0], store.getProfile());
    expect(html).not.toContain('<img');
    expect(store.listEntries()).toHaveLength(0);
    expect(() => store.importJSON('{"foo":1}')).toThrow();
  });
  it('escapes CR/LF in calendar files and folds long lines', () => {
    const ics = toICS({ id: 'a1', clientName: 'X\r\nATTENDEE:mailto:evil@x', serviceName: 'Стрижка', start: 0, end: 3600000, createdAt: 0, phone: '', note: 'н'.repeat(100) } as any);
    expect(ics.includes('\r\nATTENDEE')).toBe(false);
    expect(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
