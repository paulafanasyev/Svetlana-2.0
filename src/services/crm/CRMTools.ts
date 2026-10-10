// Svetlana CRM — tools for the AI (ToolRegistry) + chat integration helpers.
import type { Tool, ToolResult } from '../ToolRegistry';
import { toolRegistry } from '../ToolRegistry';
import { handsManager } from '../HandsManager';
import { HTTPHands } from '../HTTPHands';
import {
  crmStore, CRMStore, DEAL_STAGES, STAGE_LABELS, STATUS_LABELS,
  type ActivityType, type ContactStatus, type CRMContact, type DealStage, type ImportReport,
} from './CRMStore';
import { bizSystemPrompt, describeBizResult, detectBizIntent } from '../biz/BizTools';

const STATUSES: ContactStatus[] = ['lead', 'client', 'partner', 'other'];
const NOTE_TYPES: ActivityType[] = ['note', 'call', 'meeting', 'message'];

function ok(data: unknown): ToolResult { return { success: true, data }; }
function fail(error: string): ToolResult { return { success: false, error }; }

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  return [];
}

function parseDate(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const t = Date.parse(value.trim());
  if (Number.isNaN(t)) throw new Error(`Не понимаю дату «${value}». Используйте формат ГГГГ-ММ-ДД`);
  return t;
}

function resolveContact(store: CRMStore, ref: unknown): CRMContact | undefined {
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  return store.getContact(ref) ?? store.findContactByName(ref);
}

function brief(c: CRMContact) {
  return { id: c.id, name: c.name, phones: c.phones, emails: c.emails, company: c.company, status: STATUS_LABELS[c.status], tags: c.tags };
}

/** Pulls every contact from the phone (Svetlana-home bridge) page by page and merges them into the CRM. */
export async function importPhoneContacts(store: CRMStore = crmStore): Promise<ImportReport & { pages: number }> {
  const hands = handsManager.getHands();
  if (!(hands instanceof HTTPHands) || !(await handsManager.isConnected())) {
    throw new Error('Телефон не подключён. Включите «Подключение к ПК» в Svetlana-home и подключитесь на странице «Телефон».');
  }
  const limit = 1000;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let pages = 0;
  const all: { name: string; phones: string[]; phoneContactId: string }[] = [];
  while (offset < total && pages < 100) {
    const page = await hands.listContacts({ limit, offset });
    pages++;
    total = typeof page.total === 'number' ? page.total : 0;
    if (!page.contacts.length) break;
    all.push(...page.contacts.map(c => ({ name: c.name, phones: c.phones, phoneContactId: c.id })));
    offset += page.contacts.length;
  }
  return { ...store.importContacts(all, 'phone'), pages };
}

export function createCRMTools(store: CRMStore = crmStore): Tool[] {
  const always = async () => true;
  return [
    {
      id: 'crm_import_phone_contacts', name: 'CRM: import phone contacts', category: 'data', riskLevel: 'low',
      description: 'Import all contacts from the connected phone into the CRM (duplicates are merged by phone number).',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        try { return ok(await importPhoneContacts(store)); } catch (e: any) { return fail(e?.message || 'Импорт не удался'); }
      },
      // Always "available": execute() explains in Russian how to connect the phone.
      isAvailable: always,
    },
    {
      id: 'crm_find_contacts', name: 'CRM: find contacts', category: 'data', riskLevel: 'low',
      description: 'Search CRM contacts by name, company, phone, e-mail or tag. Optional status: lead, client, partner, other.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Search text' },
        status: { type: 'string', description: 'Contact status', enum: STATUSES },
        limit: { type: 'number', description: 'Max results, default 20' },
      } },
      async execute(p) {
        const found = store.listContacts({ query: p.query, status: p.status });
        const limit = Math.max(1, Math.min(200, Number(p.limit) || 20));
        return ok({ total: found.length, contacts: found.slice(0, limit).map(brief) });
      },
      isAvailable: always,
    },
    {
      id: 'crm_add_contact', name: 'CRM: add contact', category: 'data', riskLevel: 'low',
      description: 'Create a CRM contact. phones/emails/tags may be comma-separated. Returns the existing contact if the phone or e-mail is already known.',
      inputSchema: { type: 'object', properties: {
        name: { type: 'string', description: 'Full name' },
        phones: { type: 'string', description: 'Phone numbers, comma-separated' },
        emails: { type: 'string', description: 'E-mails, comma-separated' },
        company: { type: 'string', description: 'Company' },
        position: { type: 'string', description: 'Job title' },
        status: { type: 'string', description: 'lead, client, partner or other', enum: STATUSES },
        tags: { type: 'string', description: 'Tags, comma-separated' },
        notes: { type: 'string', description: 'Free-form notes' },
      }, required: ['name'] },
      async execute(p) {
        const phones = list(p.phones); const emails = list(p.emails);
        const dup = store.findDuplicate({ phones, emails });
        if (dup) return ok({ duplicate: true, contact: brief(dup) });
        try {
          const c = store.addContact({ name: p.name, phones, emails, company: p.company, position: p.position, status: p.status, tags: list(p.tags), notes: p.notes, source: 'chat' });
          return ok({ created: true, contact: brief(c) });
        } catch (e: any) { return fail(e?.message || 'Не удалось создать контакт'); }
      },
      isAvailable: always,
    },
    {
      id: 'crm_update_contact', name: 'CRM: update contact', category: 'data', riskLevel: 'low',
      description: 'Update a contact found by id or name: status, company, position, add tags, add phones/e-mails, replace notes.',
      inputSchema: { type: 'object', properties: {
        contact: { type: 'string', description: 'Contact id or name' },
        status: { type: 'string', description: 'lead, client, partner or other', enum: STATUSES },
        company: { type: 'string', description: 'Company' },
        position: { type: 'string', description: 'Job title' },
        addTags: { type: 'string', description: 'Tags to add, comma-separated' },
        addPhones: { type: 'string', description: 'Phones to add, comma-separated' },
        addEmails: { type: 'string', description: 'E-mails to add, comma-separated' },
        notes: { type: 'string', description: 'New notes text' },
      }, required: ['contact'] },
      async execute(p) {
        const c = resolveContact(store, p.contact);
        if (!c) return fail(`Контакт не найден: ${p.contact}`);
        const updated = store.updateContact(c.id, {
          ...(p.status ? { status: p.status } : {}),
          ...(p.company !== undefined ? { company: p.company } : {}),
          ...(p.position !== undefined ? { position: p.position } : {}),
          ...(p.notes !== undefined ? { notes: p.notes } : {}),
          tags: [...c.tags, ...list(p.addTags)],
          phones: [...c.phones, ...list(p.addPhones)],
          emails: [...c.emails, ...list(p.addEmails)],
        });
        return ok({ contact: brief(updated) });
      },
      isAvailable: always,
    },
    {
      id: 'crm_add_note', name: 'CRM: log interaction', category: 'data', riskLevel: 'low',
      description: 'Add a note, call, meeting or message record to a contact (by id or name).',
      inputSchema: { type: 'object', properties: {
        contact: { type: 'string', description: 'Contact id or name' },
        text: { type: 'string', description: 'What happened' },
        type: { type: 'string', description: 'note, call, meeting or message', enum: NOTE_TYPES },
      }, required: ['contact', 'text'] },
      async execute(p) {
        const c = resolveContact(store, p.contact);
        if (!c) return fail(`Контакт не найден: ${p.contact}`);
        const a = store.addActivity({ type: p.type || 'note', text: p.text, contactId: c.id });
        return ok({ activityId: a.id, contact: c.name, type: a.type });
      },
      isAvailable: always,
    },
    {
      id: 'crm_create_deal', name: 'CRM: create deal', category: 'data', riskLevel: 'low',
      description: 'Create a deal, optionally linked to a contact (by id or name). Stages: new, qualified, proposal, negotiation, won, lost.',
      inputSchema: { type: 'object', properties: {
        title: { type: 'string', description: 'Deal title' },
        contact: { type: 'string', description: 'Contact id or name' },
        amount: { type: 'number', description: 'Amount' },
        currency: { type: 'string', description: 'Currency code, default RUB' },
        stage: { type: 'string', description: 'Pipeline stage', enum: DEAL_STAGES },
        expectedClose: { type: 'string', description: 'Expected close date YYYY-MM-DD' },
      }, required: ['title'] },
      async execute(p) {
        let contactId: string | undefined;
        if (p.contact) {
          const c = resolveContact(store, p.contact);
          if (!c) return fail(`Контакт не найден: ${p.contact}`);
          contactId = c.id;
        }
        try {
          const d = store.addDeal({ title: p.title, contactId, amount: p.amount, currency: p.currency, stage: p.stage, expectedClose: parseDate(p.expectedClose) });
          return ok({ dealId: d.id, title: d.title, stage: STAGE_LABELS[d.stage], amount: d.amount, currency: d.currency });
        } catch (e: any) { return fail(e?.message || 'Не удалось создать сделку'); }
      },
      isAvailable: always,
    },
    {
      id: 'crm_move_deal', name: 'CRM: move deal', category: 'data', riskLevel: 'low',
      description: 'Move a deal (by id or title) to another pipeline stage.',
      inputSchema: { type: 'object', properties: {
        deal: { type: 'string', description: 'Deal id or title' },
        stage: { type: 'string', description: 'Target stage', enum: DEAL_STAGES },
      }, required: ['deal', 'stage'] },
      async execute(p) {
        const ref = String(p.deal).trim().toLowerCase();
        const d = store.getDeal(p.deal) ?? store.listDeals().find(x => x.title.toLowerCase() === ref) ?? store.listDeals().find(x => x.title.toLowerCase().includes(ref));
        if (!d) return fail(`Сделка не найдена: ${p.deal}`);
        const moved = store.moveDeal(d.id, p.stage as DealStage);
        return ok({ dealId: moved.id, title: moved.title, stage: STAGE_LABELS[moved.stage] });
      },
      isAvailable: always,
    },
    {
      id: 'crm_add_task', name: 'CRM: add task', category: 'data', riskLevel: 'low',
      description: 'Create a follow-up task, optionally for a contact (by id or name) with a due date YYYY-MM-DD.',
      inputSchema: { type: 'object', properties: {
        text: { type: 'string', description: 'Task text' },
        contact: { type: 'string', description: 'Contact id or name' },
        due: { type: 'string', description: 'Due date YYYY-MM-DD or YYYY-MM-DDTHH:mm' },
      }, required: ['text'] },
      async execute(p) {
        let contactId: string | undefined;
        if (p.contact) {
          const c = resolveContact(store, p.contact);
          if (!c) return fail(`Контакт не найден: ${p.contact}`);
          contactId = c.id;
        }
        try {
          const t = store.addActivity({ type: 'task', text: p.text, contactId, dueAt: parseDate(p.due) });
          return ok({ taskId: t.id, text: t.text, due: t.dueAt ? new Date(t.dueAt).toISOString() : null });
        } catch (e: any) { return fail(e?.message || 'Не удалось создать задачу'); }
      },
      isAvailable: always,
    },
    {
      id: 'crm_complete_task', name: 'CRM: complete task', category: 'data', riskLevel: 'low',
      description: 'Mark an open task as done (by id or part of its text).',
      inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'Task id or text' } }, required: ['task'] },
      async execute(p) {
        const ref = String(p.task).trim().toLowerCase();
        const open = store.listActivities({ openTasks: true });
        const t = open.find(x => x.id === p.task) ?? open.find(x => x.text.toLowerCase().includes(ref));
        if (!t) return fail(`Открытая задача не найдена: ${p.task}`);
        store.setActivityDone(t.id, true);
        return ok({ taskId: t.id, text: t.text, done: true });
      },
      isAvailable: always,
    },
    {
      id: 'crm_stats', name: 'CRM: summary', category: 'data', riskLevel: 'low',
      description: 'CRM summary: contacts by status, pipeline value, won deals, open and overdue tasks.',
      inputSchema: { type: 'object', properties: {} },
      async execute() { return ok(store.stats()); },
      isAvailable: always,
    },
  ];
}

export function registerCRMTools(store: CRMStore = crmStore): void {
  createCRMTools(store).forEach(t => toolRegistry.registerTool(t));
}
registerCRMTools();

// ---------------- chat integration ----------------

export const CRM_ACTION_RE = /\[CRM:\s*(\{[\s\S]*?\})\s*\]/g;

export interface CRMAction { tool: string; args: Record<string, any> }

/** Extracts [CRM: {"tool": "...", "args": {...}}] blocks from an AI reply. */
export function parseCRMActions(text: string): { clean: string; actions: CRMAction[]; invalid: number } {
  const actions: CRMAction[] = [];
  let invalid = 0;
  const clean = text.replace(CRM_ACTION_RE, (_m, json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed.tool === 'string' && /^(crm|biz)_/.test(parsed.tool)) {
        actions.push({ tool: parsed.tool, args: parsed.args && typeof parsed.args === 'object' ? parsed.args : {} });
      } else {
        invalid++;
      }
    } catch {
      invalid++;
    }
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { clean, actions, invalid };
}

/** Human-readable one-liner for a tool result. */
export function describeResult(tool: string, result: ToolResult): string {
  if (tool.startsWith('biz_')) return describeBizResult(tool, result);
  if (!result.success) return `⚠️ ${result.error || 'Не получилось'}`;
  const d = result.data ?? {};
  switch (tool) {
    case 'crm_import_phone_contacts':
      return `✅ Импорт из телефона: добавлено ${d.added}, обновлено ${d.merged}, без изменений ${d.skipped} (всего ${d.total}).`;
    case 'crm_find_contacts':
      return d.total
        ? `🔎 Найдено ${d.total}: ${d.contacts.map((c: any) => `${c.name}${c.phones?.[0] ? ` (${c.phones[0]})` : ''}`).join(', ')}`
        : '🔎 Никого не нашла.';
    case 'crm_add_contact':
      return d.duplicate ? `ℹ️ ${d.contact.name} уже есть в CRM.` : `✅ Контакт «${d.contact.name}» добавлен.`;
    case 'crm_update_contact': return `✅ Контакт «${d.contact.name}» обновлён.`;
    case 'crm_add_note': return `✅ Записала в историю «${d.contact}».`;
    case 'crm_create_deal': return `✅ Сделка «${d.title}» — ${d.stage}, ${d.amount} ${d.currency}.`;
    case 'crm_move_deal': return `✅ «${d.title}» → ${d.stage}.`;
    case 'crm_add_task': return `✅ Задача «${d.text}»${d.due ? ` до ${new Date(d.due).toLocaleDateString('ru-RU')}` : ''}.`;
    case 'crm_complete_task': return `✅ Задача «${d.text}» выполнена.`;
    case 'crm_stats':
      return `📊 Контактов ${d.contacts}, открытых сделок ${d.openDeals} на ${d.pipelineValue}, выиграно ${d.wonDeals} на ${d.wonValue}, задач ${d.openTasks} (просрочено ${d.overdueTasks}).`;
    default: return '✅ Готово.';
  }
}

export async function runCRMActions(actions: CRMAction[]): Promise<string[]> {
  const lines: string[] = [];
  for (const a of actions.slice(0, 10)) {
    const result = await toolRegistry.executeTool(a.tool, a.args);
    lines.push(describeResult(a.tool, result));
  }
  return lines;
}

/** Commands handled directly, without the AI (works offline). */
export function detectCRMIntent(text: string): CRMAction | null {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  const mentionsCRM = t.includes('crm') || t.includes('црм');
  if (/контакт/.test(t) && mentionsCRM && /(занес|внес|импорт|перенес|добав|загруз|синхрон|скопир|сохран)/.test(t)) {
    return { tool: 'crm_import_phone_contacts', args: {} };
  }
  if (mentionsCRM && /(сводк|статистик|сколько|итог|отчет)/.test(t)) {
    return { tool: 'crm_stats', args: {} };
  }
  return detectBizIntent(text);
}

export function crmSystemPrompt(store: CRMStore = crmStore): string {
  const stages = DEAL_STAGES.map(s => `${s} (${STAGE_LABELS[s]})`).join(', ');
  return `

CRM. У тебя есть встроенная CRM пользователя. Текущее состояние:
${store.summaryForAI()}

Чтобы выполнить действие в CRM, добавь в ответ строку вида
[CRM: {"tool": "имя_инструмента", "args": {...}}]
Доступные инструменты:
- crm_import_phone_contacts {} — перенести все контакты с подключённого телефона
- crm_find_contacts {"query": "...", "status": "lead|client|partner|other"}
- crm_add_contact {"name": "...", "phones": "...", "emails": "...", "company": "...", "status": "...", "tags": "..."}
- crm_update_contact {"contact": "имя", "status": "...", "addTags": "...", "company": "..."}
- crm_add_note {"contact": "имя", "text": "...", "type": "note|call|meeting|message"}
- crm_create_deal {"title": "...", "contact": "имя", "amount": 0, "stage": "..."}
- crm_move_deal {"deal": "название", "stage": "..."}
- crm_add_task {"text": "...", "contact": "имя", "due": "ГГГГ-ММ-ДД"}
- crm_complete_task {"task": "текст задачи"}
- crm_stats {}
Этапы сделок: ${stages}. Не выдумывай данные клиентов — используй только то, что сказал пользователь или что есть в CRM. Результат действия пользователь увидит сам, не пиши, что действие уже выполнено.${bizSystemPrompt()}`;
}
