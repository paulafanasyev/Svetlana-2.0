// Svetlana CRM — local-first store (localStorage on web/Windows, in-memory in tests).
// Contacts, companies-as-text, deals with a pipeline, activities (notes, calls, meetings, tasks).

export type ContactStatus = 'lead' | 'client' | 'partner' | 'other';
export type ContactSource = 'manual' | 'phone' | 'import' | 'chat';
export type DealStage = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type ActivityType = 'note' | 'call' | 'meeting' | 'message' | 'task';

export interface CRMContact {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
  company: string;
  position: string;
  status: ContactStatus;
  tags: string[];
  source: ContactSource;
  notes: string;
  phoneContactId?: string;
  createdAt: number;
  updatedAt: number;
  lastContactAt?: number;
}

export interface CRMDeal {
  id: string;
  title: string;
  contactId?: string;
  amount: number;
  currency: string;
  stage: DealStage;
  expectedClose?: number;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export interface CRMActivity {
  id: string;
  type: ActivityType;
  text: string;
  contactId?: string;
  dealId?: string;
  dueAt?: number;
  done: boolean;
  createdAt: number;
  completedAt?: number;
}

export interface CRMData {
  version: 1;
  contacts: CRMContact[];
  deals: CRMDeal[];
  activities: CRMActivity[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ImportCandidate {
  name: string;
  phones?: string[];
  emails?: string[];
  company?: string;
  phoneContactId?: string;
}

export interface ImportReport {
  added: number;
  merged: number;
  skipped: number;
  total: number;
}

export interface CRMStats {
  contacts: number;
  byStatus: Record<ContactStatus, number>;
  openDeals: number;
  pipelineValue: number;
  wonValue: number;
  wonDeals: number;
  lostDeals: number;
  byStage: Record<DealStage, { count: number; amount: number }>;
  openTasks: number;
  overdueTasks: number;
}

export const DEAL_STAGES: DealStage[] = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
export const STAGE_LABELS: Record<DealStage, string> = {
  new: 'Новая', qualified: 'Квалификация', proposal: 'Предложение',
  negotiation: 'Переговоры', won: 'Выиграна', lost: 'Проиграна',
};
export const STATUS_LABELS: Record<ContactStatus, string> = {
  lead: 'Лид', client: 'Клиент', partner: 'Партнёр', other: 'Другое',
};
export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  note: 'Заметка', call: 'Звонок', meeting: 'Встреча', message: 'Сообщение', task: 'Задача',
};

const STORAGE_KEY = 'svetlana_crm_v1';
const CONTACT_STATUSES: ContactStatus[] = ['lead', 'client', 'partner', 'other'];
const ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'meeting', 'message', 'task'];

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

function defaultStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // access denied (privacy mode) — fall through
  }
  return memoryStorage();
}

function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** Digits only, last 10 digits — "+7 (912) 345-67-89" and "89123456789" match. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

function emptyData(): CRMData {
  return { version: 1, contacts: [], deals: [], activities: [] };
}

function sanitize(raw: unknown): CRMData {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  const r = raw as Partial<CRMData>;
  if (Array.isArray(r.contacts)) {
    data.contacts = r.contacts.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string').map(c => ({
      ...c,
      phones: Array.isArray(c.phones) ? c.phones.map(String) : [],
      emails: Array.isArray(c.emails) ? c.emails.map(String) : [],
      tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
      company: c.company ?? '',
      position: c.position ?? '',
      notes: c.notes ?? '',
      status: CONTACT_STATUSES.includes(c.status) ? c.status : 'other',
      source: c.source ?? 'manual',
    }));
  }
  if (Array.isArray(r.deals)) {
    data.deals = r.deals.filter(d => d && typeof d.id === 'string' && typeof d.title === 'string').map(d => ({
      ...d,
      amount: Number(d.amount) || 0,
      currency: d.currency || 'RUB',
      stage: DEAL_STAGES.includes(d.stage) ? d.stage : 'new',
    }));
  }
  if (Array.isArray(r.activities)) {
    data.activities = r.activities.filter(a => a && typeof a.id === 'string' && typeof a.text === 'string').map(a => ({
      ...a,
      type: ACTIVITY_TYPES.includes(a.type) ? a.type : 'note',
      done: !!a.done,
    }));
  }
  return data;
}

export class CRMStore {
  private readonly storage: KeyValueStorage;
  private readonly clock: () => number;
  private data: CRMData;
  private listeners = new Set<() => void>();

  constructor(storage: KeyValueStorage = defaultStorage(), clock: () => number = Date.now) {
    this.storage = storage;
    this.clock = clock;
    this.data = this.load();
  }

  // ---------- persistence ----------
  private load(): CRMData {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : emptyData();
    } catch {
      return emptyData();
    }
  }

  private commit(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    this.listeners.forEach(l => l());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): CRMData {
    return JSON.parse(JSON.stringify(this.data)) as CRMData;
  }

  // ---------- contacts ----------
  listContacts(filter: { query?: string; status?: ContactStatus; tag?: string } = {}): CRMContact[] {
    const q = filter.query?.trim().toLowerCase();
    const qPhone = q ? normalizePhone(q) : '';
    return this.data.contacts
      .filter(c => !filter.status || c.status === filter.status)
      .filter(c => !filter.tag || c.tags.includes(filter.tag))
      .filter(c => {
        if (!q) return true;
        if (c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)) return true;
        if (c.emails.some(e => e.toLowerCase().includes(q))) return true;
        if (c.tags.some(t => t.toLowerCase().includes(q))) return true;
        return qPhone.length >= 3 && c.phones.some(p => normalizePhone(p).includes(qPhone));
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  getContact(id: string): CRMContact | undefined {
    return this.data.contacts.find(c => c.id === id);
  }

  findContactByName(name: string): CRMContact | undefined {
    const n = name.trim().toLowerCase();
    if (!n) return undefined;
    return this.data.contacts.find(c => c.name.toLowerCase() === n)
      ?? this.data.contacts.find(c => c.name.toLowerCase().includes(n));
  }

  findDuplicate(candidate: { phones?: string[]; emails?: string[]; phoneContactId?: string }): CRMContact | undefined {
    if (candidate.phoneContactId) {
      const byId = this.data.contacts.find(c => c.phoneContactId === candidate.phoneContactId);
      if (byId) return byId;
    }
    const phones = new Set((candidate.phones ?? []).map(normalizePhone).filter(p => p.length >= 5));
    const emails = new Set((candidate.emails ?? []).map(normalizeEmail).filter(Boolean));
    return this.data.contacts.find(c =>
      c.phones.some(p => phones.has(normalizePhone(p))) || c.emails.some(e => emails.has(normalizeEmail(e))),
    );
  }

  addContact(input: Partial<Omit<CRMContact, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }): CRMContact {
    const name = input.name.trim();
    if (!name) throw new Error('Имя контакта обязательно');
    const now = this.clock();
    const contact: CRMContact = {
      id: newId('c'),
      name,
      phones: uniq(input.phones ?? []),
      emails: uniq((input.emails ?? []).map(normalizeEmail)),
      company: input.company?.trim() ?? '',
      position: input.position?.trim() ?? '',
      status: input.status && CONTACT_STATUSES.includes(input.status) ? input.status : 'lead',
      tags: uniq(input.tags ?? []),
      source: input.source ?? 'manual',
      notes: input.notes ?? '',
      phoneContactId: input.phoneContactId,
      createdAt: now,
      updatedAt: now,
      lastContactAt: input.lastContactAt,
    };
    this.data.contacts.push(contact);
    this.commit();
    return contact;
  }

  updateContact(id: string, patch: Partial<Omit<CRMContact, 'id' | 'createdAt'>>): CRMContact {
    const contact = this.getContact(id);
    if (!contact) throw new Error(`Контакт не найден: ${id}`);
    if (patch.name !== undefined && !patch.name.trim()) throw new Error('Имя контакта обязательно');
    Object.assign(contact, patch, {
      phones: patch.phones ? uniq(patch.phones) : contact.phones,
      emails: patch.emails ? uniq(patch.emails.map(normalizeEmail)) : contact.emails,
      tags: patch.tags ? uniq(patch.tags) : contact.tags,
      updatedAt: this.clock(),
    });
    this.commit();
    return contact;
  }

  deleteContact(id: string): void {
    const before = this.data.contacts.length;
    this.data.contacts = this.data.contacts.filter(c => c.id !== id);
    if (this.data.contacts.length === before) throw new Error(`Контакт не найден: ${id}`);
    // Keep deals and history, just unlink them.
    this.data.deals.forEach(d => { if (d.contactId === id) d.contactId = undefined; });
    this.data.activities.forEach(a => { if (a.contactId === id) a.contactId = undefined; });
    this.commit();
  }

  /** Bulk import with de-duplication by phone/e-mail/phone id; merges new numbers into existing contacts. */
  importContacts(candidates: ImportCandidate[], source: ContactSource = 'import'): ImportReport {
    const report: ImportReport = { added: 0, merged: 0, skipped: 0, total: candidates.length };
    const now = this.clock();
    for (const cand of candidates) {
      const name = (cand.name ?? '').trim();
      const phones = uniq(cand.phones ?? []);
      const emails = uniq((cand.emails ?? []).map(normalizeEmail));
      if (!name && phones.length === 0 && emails.length === 0) { report.skipped++; continue; }
      const existing = this.findDuplicate({ phones, emails, phoneContactId: cand.phoneContactId });
      if (existing) {
        const knownPhones = new Set(existing.phones.map(normalizePhone));
        const newPhones = phones.filter(p => !knownPhones.has(normalizePhone(p)));
        const newEmails = emails.filter(e => !existing.emails.includes(e));
        const linkId = !existing.phoneContactId && cand.phoneContactId;
        if (newPhones.length || newEmails.length || linkId) {
          existing.phones.push(...newPhones);
          existing.emails.push(...newEmails);
          if (linkId) existing.phoneContactId = cand.phoneContactId;
          existing.updatedAt = now;
          report.merged++;
        } else {
          report.skipped++;
        }
        continue;
      }
      this.data.contacts.push({
        id: newId('c'),
        name: name || phones[0] || emails[0] || '',
        phones, emails,
        company: cand.company?.trim() ?? '',
        position: '',
        status: 'other',
        tags: [],
        source,
        notes: '',
        phoneContactId: cand.phoneContactId,
        createdAt: now,
        updatedAt: now,
      });
      report.added++;
    }
    if (report.added || report.merged) this.commit();
    return report;
  }

  allTags(): string[] {
    return uniq(this.data.contacts.flatMap(c => c.tags)).sort((a, b) => a.localeCompare(b, 'ru'));
  }

  // ---------- deals ----------
  listDeals(filter: { stage?: DealStage; contactId?: string; open?: boolean } = {}): CRMDeal[] {
    return this.data.deals
      .filter(d => !filter.stage || d.stage === filter.stage)
      .filter(d => !filter.contactId || d.contactId === filter.contactId)
      .filter(d => filter.open === undefined || (filter.open ? d.stage !== 'won' && d.stage !== 'lost' : d.stage === 'won' || d.stage === 'lost'))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getDeal(id: string): CRMDeal | undefined {
    return this.data.deals.find(d => d.id === id);
  }

  addDeal(input: { title: string; contactId?: string; amount?: number; currency?: string; stage?: DealStage; expectedClose?: number }): CRMDeal {
    const title = input.title.trim();
    if (!title) throw new Error('Название сделки обязательно');
    if (input.contactId && !this.getContact(input.contactId)) throw new Error(`Контакт не найден: ${input.contactId}`);
    const amount = Number(input.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Сумма сделки должна быть неотрицательным числом');
    const now = this.clock();
    const stage = input.stage && DEAL_STAGES.includes(input.stage) ? input.stage : 'new';
    const deal: CRMDeal = {
      id: newId('d'), title, contactId: input.contactId, amount,
      currency: (input.currency || 'RUB').toUpperCase(), stage,
      expectedClose: input.expectedClose, createdAt: now, updatedAt: now,
      closedAt: stage === 'won' || stage === 'lost' ? now : undefined,
    };
    this.data.deals.push(deal);
    this.commit();
    return deal;
  }

  updateDeal(id: string, patch: Partial<Omit<CRMDeal, 'id' | 'createdAt'>>): CRMDeal {
    const deal = this.getDeal(id);
    if (!deal) throw new Error(`Сделка не найдена: ${id}`);
    if (patch.stage && !DEAL_STAGES.includes(patch.stage)) throw new Error(`Неизвестный этап: ${patch.stage}`);
    if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || patch.amount < 0)) throw new Error('Сумма сделки должна быть неотрицательным числом');
    const now = this.clock();
    const wasClosed = deal.stage === 'won' || deal.stage === 'lost';
    Object.assign(deal, patch, { updatedAt: now });
    const isClosed = deal.stage === 'won' || deal.stage === 'lost';
    if (isClosed && !wasClosed) deal.closedAt = now;
    if (!isClosed) deal.closedAt = undefined;
    this.commit();
    return deal;
  }

  moveDeal(id: string, stage: DealStage): CRMDeal {
    return this.updateDeal(id, { stage });
  }

  deleteDeal(id: string): void {
    const before = this.data.deals.length;
    this.data.deals = this.data.deals.filter(d => d.id !== id);
    if (this.data.deals.length === before) throw new Error(`Сделка не найдена: ${id}`);
    this.data.activities.forEach(a => { if (a.dealId === id) a.dealId = undefined; });
    this.commit();
  }

  // ---------- activities ----------
  listActivities(filter: { contactId?: string; dealId?: string; type?: ActivityType; openTasks?: boolean } = {}): CRMActivity[] {
    return this.data.activities
      .filter(a => !filter.contactId || a.contactId === filter.contactId)
      .filter(a => !filter.dealId || a.dealId === filter.dealId)
      .filter(a => !filter.type || a.type === filter.type)
      .filter(a => !filter.openTasks || (a.type === 'task' && !a.done))
      .sort((a, b) => filter.openTasks
        ? (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER)
        : b.createdAt - a.createdAt);
  }

  addActivity(input: { type: ActivityType; text: string; contactId?: string; dealId?: string; dueAt?: number }): CRMActivity {
    const text = input.text.trim();
    if (!text) throw new Error('Текст обязателен');
    if (!ACTIVITY_TYPES.includes(input.type)) throw new Error(`Неизвестный тип: ${input.type}`);
    if (input.contactId && !this.getContact(input.contactId)) throw new Error(`Контакт не найден: ${input.contactId}`);
    if (input.dealId && !this.getDeal(input.dealId)) throw new Error(`Сделка не найдена: ${input.dealId}`);
    const now = this.clock();
    const activity: CRMActivity = {
      id: newId('a'), type: input.type, text, contactId: input.contactId, dealId: input.dealId,
      dueAt: input.dueAt, done: false, createdAt: now,
    };
    this.data.activities.push(activity);
    if (input.contactId && input.type !== 'task' && input.type !== 'note') {
      const contact = this.getContact(input.contactId);
      if (contact) contact.lastContactAt = now;
    }
    this.commit();
    return activity;
  }

  setActivityDone(id: string, done: boolean): CRMActivity {
    const activity = this.data.activities.find(a => a.id === id);
    if (!activity) throw new Error(`Запись не найдена: ${id}`);
    activity.done = done;
    activity.completedAt = done ? this.clock() : undefined;
    this.commit();
    return activity;
  }

  deleteActivity(id: string): void {
    const before = this.data.activities.length;
    this.data.activities = this.data.activities.filter(a => a.id !== id);
    if (this.data.activities.length === before) throw new Error(`Запись не найдена: ${id}`);
    this.commit();
  }

  // ---------- analytics ----------
  stats(): CRMStats {
    const now = this.clock();
    const byStatus = { lead: 0, client: 0, partner: 0, other: 0 } as Record<ContactStatus, number>;
    this.data.contacts.forEach(c => { byStatus[c.status]++; });
    const byStage = Object.fromEntries(DEAL_STAGES.map(s => [s, { count: 0, amount: 0 }])) as Record<DealStage, { count: number; amount: number }>;
    let pipelineValue = 0; let wonValue = 0; let openDeals = 0;
    this.data.deals.forEach(d => {
      byStage[d.stage].count++;
      byStage[d.stage].amount += d.amount;
      if (d.stage === 'won') wonValue += d.amount;
      else if (d.stage !== 'lost') { pipelineValue += d.amount; openDeals++; }
    });
    const openTasks = this.data.activities.filter(a => a.type === 'task' && !a.done);
    return {
      contacts: this.data.contacts.length,
      byStatus,
      openDeals,
      pipelineValue,
      wonValue,
      wonDeals: byStage.won.count,
      lostDeals: byStage.lost.count,
      byStage,
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter(a => a.dueAt !== undefined && a.dueAt < now).length,
    };
  }

  /** Short text summary for the AI system prompt. */
  summaryForAI(): string {
    const s = this.stats();
    const tasks = this.listActivities({ openTasks: true }).slice(0, 5)
      .map(t => `- ${t.text}${t.dueAt ? ` (до ${new Date(t.dueAt).toLocaleDateString('ru-RU')})` : ''}`);
    return [
      `Контактов: ${s.contacts} (лиды ${s.byStatus.lead}, клиенты ${s.byStatus.client}, партнёры ${s.byStatus.partner}).`,
      `Открытых сделок: ${s.openDeals} на ${s.pipelineValue}; выиграно ${s.wonDeals} на ${s.wonValue}.`,
      `Открытых задач: ${s.openTasks}, просрочено: ${s.overdueTasks}.`,
      ...(tasks.length ? ['Ближайшие задачи:', ...tasks] : []),
    ].join('\n');
  }

  // ---------- import / export ----------
  exportJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Replaces all data with a backup. Returns counts. */
  importJSON(json: string): { contacts: number; deals: number; activities: number } {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { throw new Error('Файл не похож на резервную копию CRM (неверный JSON)'); }
    const data = sanitize(parsed);
    this.data = data;
    this.commit();
    return { contacts: data.contacts.length, deals: data.deals.length, activities: data.activities.length };
  }

  exportContactsCSV(): string {
    const header = ['Имя', 'Телефоны', 'E-mail', 'Компания', 'Должность', 'Статус', 'Теги', 'Заметки'];
    const rows = this.listContacts().map(c => [
      c.name, c.phones.join('; '), c.emails.join('; '), c.company, c.position,
      STATUS_LABELS[c.status], c.tags.join('; '), c.notes,
    ]);
    return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  /** CSV with header row; recognises Russian/English column names. */
  importContactsCSV(csv: string): ImportReport {
    const rows = parseCSV(csv);
    if (rows.length < 2) return { added: 0, merged: 0, skipped: 0, total: 0 };
    const header = rows[0].map(h => h.trim().toLowerCase());
    const col = (...names: string[]) => header.findIndex(h => names.includes(h));
    const iName = col('имя', 'name', 'фио', 'full name');
    const iPhone = col('телефоны', 'телефон', 'phone', 'phones');
    const iEmail = col('e-mail', 'email', 'почта');
    const iCompany = col('компания', 'company', 'organization');
    const split = (v: string | undefined) => (v ?? '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
    const candidates: ImportCandidate[] = rows.slice(1).map(r => ({
      name: iName >= 0 ? r[iName] ?? '' : '',
      phones: iPhone >= 0 ? split(r[iPhone]) : [],
      emails: iEmail >= 0 ? split(r[iEmail]) : [],
      company: iCompany >= 0 ? r[iCompany] : undefined,
    }));
    return this.importContacts(candidates, 'import');
  }

  clearAll(): void {
    this.data = emptyData();
    this.commit();
  }
}

function csvCell(value: string): string {
  const v = value ?? '';
  // Prevent CSV formula injection in spreadsheet apps.
  const risky = /^[=@]/.test(v) || (/^[+-]/.test(v) && !/^[+\-\d\s().;]+$/.test(v));
  const safe = risky ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

export const crmStore = new CRMStore();
