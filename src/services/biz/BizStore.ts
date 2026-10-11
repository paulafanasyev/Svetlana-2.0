// Svetlana Business — profile, money ledger, documents (invoices/acts/contracts),
// receivables and Russian tax estimates (НПД, УСН). Local-first, like the CRM.
import type { KeyValueStorage } from '../crm/CRMStore';
import { contributionsFor, onePercent, dueDate, npdReceiptDeadline, vatStatusUsn, patentPayments, type VatStatus } from './TaxRules';

export type TaxRegime = 'npd' | 'usn6' | 'usn15' | 'patent' | 'ooo' | 'none';
export type PayerType = 'person' | 'company';
export type EntryKind = 'income' | 'expense';
export type ReceiptStatus = 'none' | 'pending' | 'issued';
export type DocType = 'invoice' | 'act' | 'contract';
export type DocStatus = 'draft' | 'sent' | 'paid' | 'cancelled';

export const REGIME_LABELS: Record<TaxRegime, string> = {
  npd: 'Самозанятый (НПД)', usn6: 'ИП, УСН «Доходы» 6%', usn15: 'ИП, УСН «Доходы минус расходы» 15%',
  patent: 'ИП на патенте', ooo: 'ООО', none: 'Не выбрано',
};
export const DOC_LABELS: Record<DocType, string> = { invoice: 'Счёт', act: 'Акт', contract: 'Договор' };
export const DOC_STATUS_LABELS: Record<DocStatus, string> = { draft: 'Черновик', sent: 'Отправлен', paid: 'Оплачен', cancelled: 'Отменён' };

export interface BizProfile {
  regime: TaxRegime;
  region: string;
  fullName: string;          // ФИО или название
  inn: string;
  ogrn: string;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  bik: string;
  account: string;           // р/с
  corrAccount: string;       // к/с
  birthYear?: number;
  sectors: string[];         // e.g. tech, agro, export, social, education, services
  flags: string[];           // lowIncome, unemployed, newBusiness, socialEnterprise
  fixedContributions: number; // фиксированные взносы ИП за текущий год (по умолчанию — из закона на этот год)
  contributionsPaid: number;  // уже уплачено взносов в этом году (для напоминаний)
  hasEmployees: boolean;      // есть работники: УСН 6% уменьшается на взносы не более чем на 50%
  vatGeneralRate: boolean;    // УСН с НДС: выбрана общая ставка 22% вместо 5/7%
  orgOnUsn: boolean;          // ООО на УСН (для сроков и НДС)
  patentStart: string;        // ГГГГ-ММ-ДД
  patentEnd: string;
  patentCost: number;
}

export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  date: number;
  amount: number;
  description: string;
  payerType: PayerType;
  contactId?: string;
  counterparty?: string;
  documentId?: string;
  category?: string;
  receipt: ReceiptStatus;
  receiptNumber?: string;
  taxable?: boolean;        // false — не доход/не расход для налога (перевод себе, займ, возврат)
  createdAt: number;
}

export interface DocItem { name: string; qty: number; price: number }

export interface BizDocument {
  id: string;
  type: DocType;
  number: string;
  date: number;
  dueDate?: number;
  contactId?: string;
  clientName: string;
  clientDetails: string;
  items: DocItem[];
  total: number;
  status: DocStatus;
  paidAt?: number;
  basis?: string;   // e.g. «Договор № 3 от 01.10.2026»
  vatRate?: number; // ставка НДС на дату документа (0/undefined — без НДС)
  vatNote?: string; // основание «Без НДС»
  createdAt: number;
  updatedAt: number;
}

export interface BizData {
  version: 1;
  profile: BizProfile;
  ledger: LedgerEntry[];
  documents: BizDocument[];
  counters: Record<string, number>; // `${type}-${year}` → last number
}

export interface NpdMonth {
  month: string;        // YYYY-MM
  fromPersons: number;
  fromCompanies: number;
  taxBeforeDeduction: number;
  deductionUsed: number;
  tax: number;          // accrued for the month
  carriedIn: number;    // < 100 ₽ carried from previous months
  payable: number;      // to pay (0 if < 100 and carried forward)
  dueDate: number;      // 28th of the next month
}

export interface NpdSummary {
  year: number;
  income: number;
  limit: number;
  limitLeft: number;
  limitExceeded: boolean;
  deductionLeft: number;
  months: NpdMonth[];
  taxYear: number;
  receiptsMissing: number;
}

export interface UsnSummary {
  year: number;
  regime: 'usn6' | 'usn15';
  income: number;
  expenses: number;
  base: number;
  taxGross: number;
  minTax: number;
  contributionsFixed: number;
  contributionsExtra: number; // 1% над 300 000 ₽
  taxAfterContributions: number;
  contributionsPrevExtra: number; // 1% за прошлый год, который платится в этом году (уменьшает УСН 6%)
  contributionsDeducted: number;  // на сколько взносы уменьшили налог (УСН 6%) или вошли в расходы (УСН 15%)
  hasEmployees: boolean;
  vat: VatStatus;
  quarters: { quarter: number; income: number; expenses: number; taxCumulative: number }[];
}

export interface Deadline { date: number; title: string; details: string }

export const NPD_LIMIT = 2_400_000;
export const NPD_DEDUCTION = 10_000;
const STORAGE_KEY = 'svetlana_biz_v1';
const DAY = 86_400_000;

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

function defaultStorage(): KeyValueStorage {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* privacy mode */ }
  return memoryStorage();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function round2(n: number): number {
  return Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
}

export function defaultProfile(): BizProfile {
  return {
    regime: 'none', region: '', fullName: '', inn: '', ogrn: '', address: '', phone: '', email: '',
    bankName: '', bik: '', account: '', corrAccount: '', sectors: [], flags: [],
    fixedContributions: contributionsFor(new Date().getFullYear()).fixed, contributionsPaid: 0,
    hasEmployees: false, vatGeneralRate: false, orgOnUsn: false, patentStart: '', patentEnd: '', patentCost: 0,
  };
}

function emptyData(): BizData {
  return { version: 1, profile: defaultProfile(), ledger: [], documents: [], counters: {} };
}

function sanitize(raw: unknown): BizData {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  const r = raw as Partial<BizData>;
  if (r.profile && typeof r.profile === 'object') {
    data.profile = { ...defaultProfile(), ...r.profile };
    data.profile.sectors = Array.isArray(r.profile.sectors) ? r.profile.sectors.map(String) : [];
    data.profile.flags = Array.isArray(r.profile.flags) ? r.profile.flags.map(String) : [];
  }
  if (Array.isArray(r.ledger)) {
    data.ledger = r.ledger.filter(e => e && typeof e.id === 'string' && Number.isFinite(Number(e.amount)))
      .map(e => ({ ...e, amount: Number(e.amount), kind: (e.kind === 'expense' ? 'expense' : 'income') as EntryKind, payerType: (e.payerType === 'company' ? 'company' : 'person') as PayerType, receipt: (e.receipt ?? 'none') as ReceiptStatus }));
  }
  if (Array.isArray(r.documents)) {
    data.documents = r.documents.filter(d => d && typeof d.id === 'string' && Array.isArray(d.items));
  }
  if (r.counters && typeof r.counters === 'object') data.counters = { ...r.counters };
  return data;
}

function ym(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function due28NextMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return dueDate(y, m, 28); // month index m == next month; перенос с выходных
}

/** Входит ли операция в налоговую базу. */
export function isTaxable(e: LedgerEntry): boolean {
  return e.taxable !== false;
}
const OWN_CONTRIBUTIONS_CATEGORY = /^(взносы ип|взносы за себя|contributions)$/i;
const DOC_TRANSITIONS: Record<DocStatus, DocStatus[]> = { draft: ['sent', 'cancelled'], sent: ['draft', 'cancelled'], paid: [], cancelled: ['draft'] };

export class BizStore {
  private readonly storage: KeyValueStorage;
  private readonly clock: () => number;
  private data: BizData;
  private listeners = new Set<() => void>();

  constructor(storage: KeyValueStorage = defaultStorage(), clock: () => number = Date.now) {
    this.storage = storage;
    this.clock = clock;
    this.data = this.load();
  }

  private load(): BizData {
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

  now(): number { return this.clock(); }

  // ---------- profile ----------
  getProfile(): BizProfile { return { ...this.data.profile, sectors: [...this.data.profile.sectors], flags: [...this.data.profile.flags] }; }

  updateProfile(patch: Partial<BizProfile>): BizProfile {
    if (patch.inn !== undefined && patch.inn !== '' && !/^\d{10}(\d{2})?$/.test(patch.inn.trim())) throw new Error('ИНН должен состоять из 10 или 12 цифр');
    if (patch.bik !== undefined && patch.bik !== '' && !/^\d{9}$/.test(patch.bik.trim())) throw new Error('БИК должен состоять из 9 цифр');
    if (patch.account !== undefined && patch.account !== '' && !/^\d{20}$/.test(patch.account.trim())) throw new Error('Расчётный счёт должен состоять из 20 цифр');
    this.data.profile = { ...this.data.profile, ...patch };
    this.commit();
    return this.getProfile();
  }

  // ---------- ledger ----------
  listEntries(filter: { kind?: EntryKind; year?: number; contactId?: string } = {}): LedgerEntry[] {
    return this.data.ledger
      .filter(e => !filter.kind || e.kind === filter.kind)
      .filter(e => filter.year === undefined || new Date(e.date).getFullYear() === filter.year)
      .filter(e => !filter.contactId || e.contactId === filter.contactId)
      .sort((a, b) => b.date - a.date);
  }

  addEntry(input: { kind: EntryKind; amount: number; description: string; date?: number; payerType?: PayerType; contactId?: string; counterparty?: string; documentId?: string; category?: string; taxable?: boolean }): LedgerEntry {
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма должна быть больше нуля');
    const description = input.description.trim() || (input.kind === 'income' ? 'Доход' : 'Расход');
    const now = this.clock();
    const entry: LedgerEntry = {
      id: newId(input.kind === 'income' ? 'in' : 'ex'),
      kind: input.kind, amount, description,
      date: input.date ?? now,
      payerType: input.payerType ?? 'person',
      contactId: input.contactId, counterparty: input.counterparty?.trim() || undefined,
      documentId: input.documentId, category: input.category,
      receipt: input.kind === 'income' && this.data.profile.regime === 'npd' && input.taxable !== false ? 'pending' : 'none',
      taxable: input.taxable === false ? false : undefined,
      createdAt: now,
    };
    if (!Number.isFinite(entry.date)) throw new Error('Некорректная дата');
    this.data.ledger.push(entry);
    this.commit();
    return entry;
  }

  /** Отметить, что операция не доход/не расход для налога (перевод себе, займ, возврат) — или вернуть в базу. */
  setTaxable(id: string, taxable: boolean): LedgerEntry {
    const e = this.data.ledger.find(x => x.id === id);
    if (!e) throw new Error(`Запись не найдена: ${id}`);
    e.taxable = taxable ? undefined : false;
    if (e.kind === 'income' && this.data.profile.regime === 'npd' && e.receipt !== 'issued') e.receipt = taxable ? 'pending' : 'none';
    this.commit();
    return e;
  }

  setReceipt(id: string, receiptNumber: string): LedgerEntry {
    const e = this.data.ledger.find(x => x.id === id);
    if (!e) throw new Error(`Запись не найдена: ${id}`);
    e.receipt = 'issued';
    e.receiptNumber = receiptNumber.trim() || undefined;
    this.commit();
    return e;
  }

  deleteEntry(id: string): void {
    const before = this.data.ledger.length;
    this.data.ledger = this.data.ledger.filter(e => e.id !== id);
    if (before === this.data.ledger.length) throw new Error(`Запись не найдена: ${id}`);
    this.data.documents.forEach(d => { if (d.status === 'paid' && !this.data.ledger.some(e => e.documentId === d.id)) { d.status = 'sent'; d.paidAt = undefined; } });
    this.commit();
  }

  /** Data for a «Мой налог» receipt (the app must issue it; ФНС API needs partner access). */
  receiptDraft(id: string): { text: string; amount: number; payer: string; payerType: PayerType; date: string } {
    const e = this.data.ledger.find(x => x.id === id && x.kind === 'income');
    if (!e) throw new Error(`Доход не найден: ${id}`);
    return {
      text: e.description, amount: e.amount, payer: e.counterparty ?? '', payerType: e.payerType,
      date: new Date(e.date).toLocaleDateString('ru-RU'),
    };
  }

  // ---------- documents ----------
  listDocuments(filter: { type?: DocType; status?: DocStatus; contactId?: string } = {}): BizDocument[] {
    return this.data.documents
      .filter(d => !filter.type || d.type === filter.type)
      .filter(d => !filter.status || d.status === filter.status)
      .filter(d => !filter.contactId || d.contactId === filter.contactId)
      .sort((a, b) => b.date - a.date);
  }

  getDocument(id: string): BizDocument | undefined {
    return this.data.documents.find(d => d.id === id);
  }

  private nextNumber(type: DocType, date: number): string {
    const key = `${type}-${new Date(date).getFullYear()}`;
    const n = (this.data.counters[key] ?? 0) + 1;
    this.data.counters[key] = n;
    return String(n);
  }

  createDocument(input: { type: DocType; clientName: string; clientDetails?: string; contactId?: string; items: DocItem[]; date?: number; dueDays?: number; basis?: string }): BizDocument {
    const clientName = input.clientName.trim();
    if (!clientName) throw new Error('Укажите клиента');
    const items = input.items
      .map(i => ({ name: String(i.name ?? '').trim(), qty: Number(i.qty ?? 1), price: round2(Number(i.price ?? 0)) }))
      .filter(i => i.name);
    if (!items.length) throw new Error('Добавьте хотя бы одну позицию');
    if (items.some(i => !Number.isFinite(i.qty) || i.qty <= 0 || !Number.isFinite(i.price) || i.price < 0)) throw new Error('Количество и цена должны быть положительными числами');
    const now = this.clock();
    const date = input.date ?? now;
    const doc: BizDocument = {
      id: newId('doc'), type: input.type, number: this.nextNumber(input.type, date), date,
      dueDate: input.type === 'invoice' ? date + (input.dueDays ?? 5) * DAY : undefined,
      contactId: input.contactId, clientName, clientDetails: input.clientDetails?.trim() ?? '',
      items, total: round2(items.reduce((s, i) => s + i.qty * i.price, 0)),
      status: 'draft', basis: input.basis, createdAt: now, updatedAt: now,
      ...this.vatForDocument(date),
    };
    this.data.documents.push(doc);
    this.commit();
    return doc;
  }

  /** НДС для нового документа: ставка и основание «Без НДС». */
  vatForDocument(date: number): { vatRate?: number; vatNote: string } {
    const p = this.data.profile;
    if (p.regime === 'npd') return { vatNote: 'Без НДС (плательщик налога на профессиональный доход)' };
    if (p.regime === 'patent') return { vatNote: 'Без НДС (патентная система налогообложения)' };
    if (p.regime === 'usn6' || p.regime === 'usn15' || (p.regime === 'ooo' && p.orgOnUsn)) {
      const v = this.vatStatus(new Date(date).getFullYear());
      const month = new Date(date).getMonth();
      if (v.status !== 'exempt' && (v.fromMonth === undefined || month >= v.fromMonth)) return { vatRate: v.rate, vatNote: '' };
      return { vatNote: 'Без НДС (освобождение по ст. 145 НК РФ)' };
    }
    return { vatNote: 'Без НДС' };
  }

  vatStatus(year: number = new Date(this.clock()).getFullYear()): VatStatus {
    const inc = (y: number) => this.listEntries({ kind: 'income', year: y }).filter(isTaxable);
    const prev = inc(year - 1).reduce((s, e) => s + e.amount, 0);
    const monthly = Array.from({ length: 12 }, (_, m) => inc(year).filter(e => new Date(e.date).getMonth() === m).reduce((s, e) => s + e.amount, 0));
    return vatStatusUsn(year, prev, monthly, this.data.profile.vatGeneralRate);
  }

  setDocumentStatus(id: string, status: DocStatus): BizDocument {
    const d = this.getDocument(id);
    if (!d) throw new Error(`Документ не найден: ${id}`);
    if (status === 'paid') throw new Error('Оплату отмечайте кнопкой «Оплачен»: так доход попадёт в учёт');
    if (d.status !== status && !DOC_TRANSITIONS[d.status].includes(status)) throw new Error(`Нельзя перевести документ из «${DOC_STATUS_LABELS[d.status]}» в «${DOC_STATUS_LABELS[status]}»`);
    d.status = status;
    d.updatedAt = this.clock();
    this.commit();
    return d;
  }

  /** Marks an invoice paid and records the income (once). */
  markPaid(id: string, opts: { date?: number; payerType?: PayerType } = {}): { document: BizDocument; entry: LedgerEntry } {
    const d = this.getDocument(id);
    if (!d) throw new Error(`Документ не найден: ${id}`);
    if (d.type !== 'invoice') throw new Error('Оплаченным можно отметить только счёт');
    if (d.status === 'cancelled') throw new Error('Счёт отменён. Сначала верните его в черновик.');
    const existing = this.data.ledger.find(e => e.documentId === d.id);
    if (existing) return { document: d, entry: existing };
    const looksCompany = /^(ооо|ао|пао|зао|ип|оао|нко|ано)(?=\s|$|«|")/i.test(d.clientName.trim());
    const entry = this.addEntry({
      kind: 'income', amount: d.total, description: `Оплата по счёту № ${d.number}: ${d.items.map(i => i.name).join(', ')}`,
      date: opts.date, payerType: opts.payerType ?? (looksCompany ? 'company' : 'person'),
      contactId: d.contactId, counterparty: d.clientName, documentId: d.id,
    });
    d.status = 'paid';
    d.paidAt = entry.date;
    d.updatedAt = this.clock();
    this.commit();
    return { document: d, entry };
  }

  deleteDocument(id: string): void {
    const before = this.data.documents.length;
    this.data.documents = this.data.documents.filter(d => d.id !== id);
    if (before === this.data.documents.length) throw new Error(`Документ не найден: ${id}`);
    this.commit();
  }

  /** Unpaid invoices, most overdue first. */
  receivables(): { document: BizDocument; daysOverdue: number }[] {
    const now = this.clock();
    return this.data.documents
      .filter(d => d.type === 'invoice' && (d.status === 'draft' || d.status === 'sent'))
      .map(d => ({ document: d, daysOverdue: d.dueDate && d.dueDate < now ? Math.floor((now - d.dueDate) / DAY) : 0 }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.document.date - b.document.date);
  }

  reminderText(id: string): string {
    const d = this.getDocument(id);
    if (!d) throw new Error(`Документ не найден: ${id}`);
    const p = this.data.profile;
    const due = d.dueDate ? ` (срок оплаты был ${new Date(d.dueDate).toLocaleDateString('ru-RU')})` : '';
    return `Здравствуйте! Напоминаю про счёт № ${d.number} от ${new Date(d.date).toLocaleDateString('ru-RU')} на ${formatRub(d.total)}${due}. `
      + `Если уже оплатили, пришлите, пожалуйста, подтверждение. Спасибо!${p.fullName ? `\n${p.fullName}` : ''}`;
  }

  // ---------- taxes ----------
  npdSummary(year: number = new Date(this.clock()).getFullYear()): NpdSummary {
    const incomes = this.listEntries({ kind: 'income' })
      .filter(e => isTaxable(e) && new Date(e.date).getFullYear() <= year)
      .sort((a, b) => a.date - b.date);
    // The 10 000 ₽ deduction is lifetime-cumulative: walk all history.
    let deductionLeft = NPD_DEDUCTION;
    const months = new Map<string, NpdMonth>();
    for (const e of incomes) {
      const key = ym(e.date);
      const m = months.get(key) ?? { month: key, fromPersons: 0, fromCompanies: 0, taxBeforeDeduction: 0, deductionUsed: 0, tax: 0, carriedIn: 0, payable: 0, dueDate: due28NextMonth(key) };
      const rate = e.payerType === 'company' ? 0.06 : 0.04;
      const deductionRate = e.payerType === 'company' ? 0.02 : 0.01;
      const gross = e.amount * rate;
      const used = Math.min(deductionLeft, e.amount * deductionRate);
      deductionLeft -= used;
      if (e.payerType === 'company') m.fromCompanies += e.amount; else m.fromPersons += e.amount;
      m.taxBeforeDeduction += gross;
      m.deductionUsed += used;
      m.tax += gross - used;
      months.set(key, m);
    }
    let carry = 0;
    const ordered = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
    for (const m of ordered) {
      m.taxBeforeDeduction = round2(m.taxBeforeDeduction);
      m.deductionUsed = round2(m.deductionUsed);
      m.tax = round2(m.tax);
      m.carriedIn = round2(carry);
      const total = m.tax + carry;
      if (total < 100) { m.payable = 0; carry = total; } else { m.payable = round2(total); carry = 0; }
    }
    const yearMonths = ordered.filter(m => m.month.startsWith(`${year}-`));
    const income = round2(yearMonths.reduce((s, m) => s + m.fromPersons + m.fromCompanies, 0));
    return {
      year, income, limit: NPD_LIMIT, limitLeft: Math.max(0, NPD_LIMIT - income), limitExceeded: income > NPD_LIMIT,
      deductionLeft: round2(deductionLeft), months: yearMonths,
      taxYear: round2(yearMonths.reduce((s, m) => s + m.tax, 0)),
      receiptsMissing: this.data.ledger.filter(e => e.kind === 'income' && e.receipt === 'pending' && new Date(e.date).getFullYear() <= year).length,
    };
  }

  /**
   * УСН для ИП (оценка). 6%: налог уменьшается на фиксированные взносы этого года и 1% за прошлый год (платится до 1 июля),
   * при работниках — не более чем на 50%. 15%: взносы этого года (фикс. + 1%) входят в расходы, минимальный налог 1% дохода;
   * с 2026 года 1% считается с (доходы − расходы без взносов за себя − 300 000 ₽) (ст. 430 НК РФ в ред. 425-ФЗ).
   */
  usnSummary(year: number = new Date(this.clock()).getFullYear()): UsnSummary {
    const p = this.data.profile;
    const regime = p.regime === 'usn15' ? 'usn15' : 'usn6';
    const all = this.listEntries().filter(isTaxable);
    const ofYear = (y: number) => all.filter(e => new Date(e.date).getFullYear() === y);
    const totals = (list: LedgerEntry[], q?: number) => {
      const inQ = list.filter(e => q === undefined || Math.floor(new Date(e.date).getMonth() / 3) + 1 <= q);
      const income = round2(inQ.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0));
      const expenses = round2(inQ.filter(e => e.kind === 'expense' && !OWN_CONTRIBUTIONS_CATEGORY.test(e.category ?? '')).reduce((s, e) => s + e.amount, 0));
      return { income, expenses };
    };
    const { income, expenses } = totals(ofYear(year));
    const prev = totals(ofYear(year - 1));
    const thisYear = new Date(this.clock()).getFullYear();
    const contributionsFixed = year === thisYear ? p.fixedContributions : contributionsFor(year).fixed;
    const extraBase = (inc: number, exp: number) => (regime === 'usn6' ? inc : inc - exp);
    const contributionsExtra = round2(onePercent(extraBase(income, expenses), year));
    const contributionsPrevExtra = round2(prev.income > 0 ? onePercent(extraBase(prev.income, prev.expenses), year - 1) : 0);
    let taxGross: number; let minTax = 0; let base: number; let tax: number; let deducted: number;
    if (regime === 'usn6') {
      base = income;
      taxGross = round2(income * 0.06);
      const canDeduct = contributionsFixed + contributionsPrevExtra;
      deducted = round2(Math.min(canDeduct, p.hasEmployees ? taxGross * 0.5 : taxGross));
      tax = round2(taxGross - deducted);
    } else {
      deducted = round2(contributionsFixed + contributionsExtra);
      base = round2(Math.max(0, income - expenses - deducted));
      taxGross = round2(base * 0.15);
      minTax = round2(income * 0.01);
      tax = round2(Math.max(taxGross, minTax));
    }
    const quarters = [1, 2, 3, 4].map(q => {
      const t = totals(ofYear(year), q);
      const cum = regime === 'usn6' ? t.income * 0.06 : Math.max(0, t.income - t.expenses) * 0.15;
      return { quarter: q, income: t.income, expenses: t.expenses, taxCumulative: round2(cum) };
    });
    return {
      year, regime, income, expenses, base: round2(base), taxGross, minTax, contributionsFixed, contributionsExtra, taxAfterContributions: tax,
      contributionsPrevExtra, contributionsDeducted: deducted, hasEmployees: p.hasEmployees, vat: this.vatStatus(year), quarters,
    };
  }

  /** Ближайшие сроки по выбранному режиму (на `days` дней вперёд), с переносом с выходных и праздников. */
  deadlines(days = 120): Deadline[] {
    const now = this.clock();
    const year = new Date(now).getFullYear();
    const out: Deadline[] = [];
    const add = (y: number, m: number, d: number, title: string, details: string) => out.push({ date: dueDate(y, m, d), title, details });
    const p = this.data.profile;
    const regime = p.regime;
    const usn = regime === 'usn6' || regime === 'usn15' || (regime === 'ooo' && p.orgOnUsn);
    const ip = regime === 'usn6' || regime === 'usn15' || regime === 'patent';
    for (const y of [year, year + 1]) {
      if (regime === 'npd') {
        for (let m = 0; m < 12; m++) {
          add(y, m, 9, 'Чеки НПД', 'Последний день выбить чеки за безналичные оплаты прошлого месяца');
          add(y, m, 28, 'Налог НПД', 'Оплата налога за прошлый месяц в «Мой налог» (если начислено от 100 ₽)');
        }
      }
      if (usn) {
        if (regime === 'ooo') {
          add(y, 2, 25, 'Декларация УСН (организация)', 'За прошлый год');
          add(y, 2, 28, 'Налог УСН за прошлый год (организация)', '');
        } else {
          add(y, 3, 25, 'Декларация УСН ИП', 'За прошлый год');
          add(y, 3, 28, 'Налог УСН за прошлый год (ИП)', '');
        }
        add(y, 3, 25, 'Уведомление по УСН', 'Об авансе за I квартал');
        add(y, 3, 28, 'Аванс УСН за I квартал', '');
        add(y, 6, 25, 'Уведомление по УСН', 'Об авансе за полугодие');
        add(y, 6, 28, 'Аванс УСН за полугодие', '');
        add(y, 9, 25, 'Уведомление по УСН', 'Об авансе за 9 месяцев');
        add(y, 9, 28, 'Аванс УСН за 9 месяцев', '');
        const vat = this.vatStatus(y);
        if (vat.status === 'vat') {
          for (const m of [0, 3, 6, 9]) add(y, m, 25, 'Декларация по НДС', `За прошлый квартал (ставка ${vat.rate}%); налог — равными долями до 28-го числа трёх следующих месяцев`);
        }
      }
      if (ip) {
        add(y, 6, 1, 'Взнос 1% с дохода свыше 300 000 ₽', `За ${y - 1} год`);
        add(y, 11, 28, 'Фиксированные взносы ИП', `За ${y} год: ${contributionsFor(y).fixed.toLocaleString('ru-RU')} ₽${contributionsFor(y).known ? '' : ' (сумму проверьте)'}`);
      }
    }
    if (regime === 'patent' && p.patentStart && p.patentEnd && p.patentCost > 0) {
      const start = Date.parse(p.patentStart);
      const end = Date.parse(p.patentEnd);
      patentPayments(start, end, p.patentCost).forEach(x => out.push({ date: x.date, title: x.title, details: formatRub(x.amount) }));
    }
    return out.filter(d => d.date >= now - DAY && d.date <= now + days * DAY).sort((a, b) => a.date - b.date);
  }

  /** Доходы НПД, по которым срок чека (9-е число следующего месяца) уже прошёл. */
  overdueReceipts(): LedgerEntry[] {
    const now = this.clock();
    return this.data.ledger.filter(e => e.kind === 'income' && e.receipt === 'pending' && npdReceiptDeadline(e.date) + DAY <= now);
  }

  /** Money overview for the current month and year. */
  overview(): { monthIncome: number; monthExpenses: number; yearIncome: number; yearExpenses: number; profitYear: number; unpaidTotal: number; overdueTotal: number; topClients: { name: string; amount: number }[] } {
    const now = this.clock();
    const year = new Date(now).getFullYear();
    const month = ym(now);
    const yearEntries = this.listEntries({ year });
    const s = (list: LedgerEntry[], kind: EntryKind) => round2(list.filter(e => e.kind === kind).reduce((a, e) => a + e.amount, 0));
    const monthEntries = yearEntries.filter(e => ym(e.date) === month);
    const byClient = new Map<string, number>();
    yearEntries.filter(e => e.kind === 'income').forEach(e => {
      const name = e.counterparty || 'Без клиента';
      byClient.set(name, (byClient.get(name) ?? 0) + e.amount);
    });
    const rec = this.receivables();
    return {
      monthIncome: s(monthEntries, 'income'), monthExpenses: s(monthEntries, 'expense'),
      yearIncome: s(yearEntries, 'income'), yearExpenses: s(yearEntries, 'expense'),
      profitYear: round2(s(yearEntries, 'income') - s(yearEntries, 'expense')),
      unpaidTotal: round2(rec.reduce((a, r) => a + r.document.total, 0)),
      overdueTotal: round2(rec.filter(r => r.daysOverdue > 0).reduce((a, r) => a + r.document.total, 0)),
      topClients: [...byClient.entries()].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    };
  }

  summaryForAI(): string {
    const p = this.data.profile;
    const o = this.overview();
    const lines = [
      `Режим: ${REGIME_LABELS[p.regime]}${p.region ? `, регион: ${p.region}` : ''}.`,
      `Доход за месяц: ${o.monthIncome} ₽, за год: ${o.yearIncome} ₽, расходы за год: ${o.yearExpenses} ₽.`,
      `Неоплаченные счета: ${o.unpaidTotal} ₽ (просрочено ${o.overdueTotal} ₽).`,
    ];
    if (p.regime === 'npd') {
      const n = this.npdSummary();
      lines.push(`НПД: налог за год ${n.taxYear} ₽, до лимита осталось ${n.limitLeft} ₽, чеков не выбито: ${n.receiptsMissing}.`);
    }
    if (p.regime === 'usn6' || p.regime === 'usn15') {
      const u = this.usnSummary();
      lines.push(`УСН: налог к уплате за год (оценка) ${u.taxAfterContributions} ₽.`);
    }
    return lines.join('\n');
  }

  exportJSON(): string { return JSON.stringify(this.data, null, 2); }

  importJSON(json: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { throw new Error('Файл не похож на резервную копию (неверный JSON)'); }
    this.data = sanitize(parsed);
    this.commit();
  }

  /** CSV of the ledger for an accountant (КУДиР-style columns). */
  exportLedgerCSV(year: number): string {
    const rows = this.listEntries({ year }).sort((a, b) => a.date - b.date).map((e, i) => [
      String(i + 1), new Date(e.date).toLocaleDateString('ru-RU'), e.kind === 'income' ? 'Доход' : 'Расход',
      e.description, e.counterparty ?? '', e.payerType === 'company' ? 'Юрлицо/ИП' : 'Физлицо',
      e.amount.toFixed(2).replace('.', ','), e.receiptNumber ?? '',
    ]);
    const header = ['№', 'Дата', 'Тип', 'Содержание операции', 'Контрагент', 'Плательщик', 'Сумма, ₽', 'Чек'];
    const cell = (v: string) => {
      const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
      return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  }
}

export function formatRub(n: number): string {
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} ₽`;
}

export const bizStore = new BizStore();
