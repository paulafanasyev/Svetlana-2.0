// Svetlana Business — profile, money ledger, documents (invoices/acts/contracts),
// receivables and Russian tax estimates (НПД, УСН). Local-first, like the CRM.
// Запись всё или ничего (как CRMStore): если хранилище не приняло изменение, данные возвращаются к последнему
// сохранённому состоянию и бросается BIZ_SAVE_FAILED: экран не покажет доход, который исчезнет после перезапуска.
// Наружу отдаются только КОПИИ записей и документов: экран или инструмент ИИ не может изменить данные в обход проверок и сохранения.
import type { KeyValueStorage } from '../crm/CRMStore';
import { safeJsonParse, csvSafe, stripControl, MAX_BYTES } from '../security/SafeData';
import { contributionsFor, onePercent, dueDate, npdReceiptDeadline, vatStatusUsn, patentPayments, usnRate, USN_RATE_LIMITS, type VatStatus, type PayMethod } from './TaxRules';

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
/** Хранилище не приняло изменение (переполнено или недоступно): изменение отменено. */
export const BIZ_SAVE_FAILED = 'Не удалось сохранить данные раздела «Бизнес»: хранилище переполнено или недоступно. Изменение отменено, сделайте резервную копию.';

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
  fixedContributions: number; // фиксированные взносы ИП за год fixedContributionsYear (по умолчанию — из закона)
  fixedContributionsYear: number; // к какому году относится сумма выше; для других лет берётся сумма из закона
  usn15OnePercentTiming: 'same' | 'next'; // УСН 15%: 1% учитывать в расходах года начисления или года уплаты
  contributionsPaid: number;  // уже уплачено взносов в этом году (для напоминаний)
  hasEmployees: boolean;      // есть работники: УСН 6% уменьшается на взносы не более чем на 50%
  vatGeneralRate: boolean;    // УСН с НДС: выбрана общая ставка 22% вместо 5/7%
  usnRate?: number;           // региональная ставка УСН (1–6% или 5–15%); пусто — базовая 6% / 15%
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
  payMethod?: PayMethod;    // способ расчёта: влияет на срок чека НПД
  noDocs?: boolean;         // расход без подтверждающих документов: не уменьшает базу УСН 15%
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
  expensesNoDocs: number; // расходы без документов, не уменьшившие базу
  base: number;
  taxGross: number;
  rate: number;          // применённая ставка УСН, %
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

/** Копии для выдачи наружу: изменение копии не меняет данные хранилища. */
const copyEntry = (e: LedgerEntry): LedgerEntry => ({ ...e });
const copyDoc = (d: BizDocument): BizDocument => ({ ...d, items: d.items.map(i => ({ ...i })) });

export function round2(n: number): number {
  return Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
}

export function defaultProfile(): BizProfile {
  return {
    regime: 'none', region: '', fullName: '', inn: '', ogrn: '', address: '', phone: '', email: '',
    bankName: '', bik: '', account: '', corrAccount: '', sectors: [], flags: [],
    fixedContributions: contributionsFor(new Date().getFullYear()).fixed, fixedContributionsYear: new Date().getFullYear(),
    usn15OnePercentTiming: 'same', contributionsPaid: 0,
    hasEmployees: false, vatGeneralRate: false, orgOnUsn: false, patentStart: '', patentEnd: '', patentCost: 0,
  };
}

function emptyData(): BizData {
  return { version: 1, profile: defaultProfile(), ledger: [], documents: [], counters: {} };
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? stripControl(v).slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const optStr = (v: unknown, max = 500): string | undefined => { const x = str(v, max); return x || undefined; };
const num = (v: unknown, min: number, max: number): number | undefined => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : undefined; };
const MAX_TS = 4_102_444_800_000; // 2100-01-01
const ts = (v: unknown): number | undefined => num(v, 0, MAX_TS);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const REGIMES_ALL = ['npd', 'usn6', 'usn15', 'patent', 'ooo', 'none'] as const;
const DOC_TYPES_ALL = ['invoice', 'act', 'contract'] as const;
const DOC_STATUSES_ALL = ['draft', 'sent', 'paid', 'cancelled'] as const;

/** Строгая проверка данных из хранилища/резервной копии: объекты собираются поле за полем, мусор отбрасывается. */
function sanitize(raw: unknown): BizData {
  const data = emptyData();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return data;
  const r = raw as Record<string, any>;
  if (r.profile && typeof r.profile === 'object') {
    const p = r.profile as Record<string, unknown>;
    const d = defaultProfile();
    data.profile = {
      regime: oneOf(p.regime, REGIMES_ALL, 'none'), region: str(p.region, 120), fullName: str(p.fullName, 300),
      inn: str(p.inn, 12), ogrn: str(p.ogrn, 15), address: str(p.address, 500), phone: str(p.phone, 40), email: str(p.email, 200),
      bankName: str(p.bankName, 200), bik: str(p.bik, 9), account: str(p.account, 20), corrAccount: str(p.corrAccount, 20),
      birthYear: num(p.birthYear, 1900, 2100),
      sectors: Array.isArray(p.sectors) ? p.sectors.slice(0, 30).map(x => str(x, 40)).filter(Boolean) : [],
      flags: Array.isArray(p.flags) ? p.flags.slice(0, 30).map(x => str(x, 40)).filter(Boolean) : [],
      fixedContributions: num(p.fixedContributions, 0, 10_000_000) ?? d.fixedContributions,
      fixedContributionsYear: num(p.fixedContributionsYear, 2000, 2100) ?? 0,
      usn15OnePercentTiming: p.usn15OnePercentTiming === 'next' ? 'next' : 'same',
      contributionsPaid: num(p.contributionsPaid, 0, 10_000_000) ?? 0,
      hasEmployees: p.hasEmployees === true, vatGeneralRate: p.vatGeneralRate === true, orgOnUsn: p.orgOnUsn === true,
      usnRate: num(p.usnRate, 1, 15),
      patentStart: /^\d{4}-\d{2}-\d{2}$/.test(String(p.patentStart ?? '')) ? String(p.patentStart) : '',
      patentEnd: /^\d{4}-\d{2}-\d{2}$/.test(String(p.patentEnd ?? '')) ? String(p.patentEnd) : '',
      patentCost: num(p.patentCost, 0, 100_000_000) ?? 0,
    };
  }
  if (Array.isArray(r.ledger)) {
    for (const e of r.ledger.slice(0, 200_000)) {
      if (!e || typeof e !== 'object') continue;
      const amount = num(e.amount, 0.01, 1e12);
      const date = ts(e.date);
      if (typeof e.id !== 'string' || amount === undefined || date === undefined) continue;
      data.ledger.push({
        id: str(e.id, 80), kind: e.kind === 'expense' ? 'expense' : 'income', date, amount: round2(amount),
        description: str(e.description, 500), payerType: e.payerType === 'company' ? 'company' : 'person',
        contactId: optStr(e.contactId, 80), counterparty: optStr(e.counterparty, 300), documentId: optStr(e.documentId, 80),
        category: optStr(e.category, 100), receipt: oneOf(e.receipt, ['none', 'pending', 'issued'] as const, 'none'),
        receiptNumber: optStr(e.receiptNumber, 100), taxable: e.taxable === false ? false : undefined,
        payMethod: e.payMethod === 'cash' || e.payMethod === 'card' || e.payMethod === 'transfer' ? e.payMethod : undefined,
        noDocs: e.noDocs === true ? true : undefined,
        createdAt: ts(e.createdAt) ?? date,
      });
    }
  }
  if (Array.isArray(r.documents)) {
    for (const d of r.documents.slice(0, 50_000)) {
      if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !Array.isArray(d.items)) continue;
      const items = d.items.slice(0, 200)
        .map((i: any) => ({ name: str(i?.name, 500), qty: num(i?.qty, 0.0001, 1e9) ?? 0, price: num(i?.price, 0, 1e12) ?? -1 }))
        .filter((i: DocItem) => i.name && i.qty > 0 && i.price >= 0);
      const date = ts(d.date);
      if (!items.length || date === undefined) continue;
      data.documents.push({
        id: str(d.id, 80), type: oneOf(d.type, DOC_TYPES_ALL, 'invoice'), number: str(d.number, 40) || '?', date,
        dueDate: ts(d.dueDate), contactId: optStr(d.contactId, 80), clientName: str(d.clientName, 300) || 'Клиент',
        clientDetails: str(d.clientDetails, 2000), items, total: round2(items.reduce((s: number, i: DocItem) => s + i.qty * i.price, 0)),
        status: oneOf(d.status, DOC_STATUSES_ALL, 'draft'), paidAt: ts(d.paidAt), basis: optStr(d.basis, 300),
        vatRate: num(d.vatRate, 0, 30), vatNote: optStr(d.vatNote, 200),
        createdAt: ts(d.createdAt) ?? date, updatedAt: ts(d.updatedAt) ?? date,
      });
    }
  }
  if (r.counters && typeof r.counters === 'object' && !Array.isArray(r.counters)) {
    for (const [k, v] of Object.entries(r.counters as Record<string, unknown>).slice(0, 200)) {
      const n = num(v, 0, 1e9);
      if (/^(invoice|act|contract)-\d{4}$/.test(k) && n !== undefined) data.counters[k] = Math.floor(n);
    }
  }
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

type EntryInput = { kind: EntryKind; amount: number; description: string; date?: number; payerType?: PayerType; contactId?: string; counterparty?: string; documentId?: string; category?: string; taxable?: boolean; payMethod?: PayMethod; noDocs?: boolean };

export class BizStore {
  private readonly storage: KeyValueStorage;
  private readonly clock: () => number;
  private data: BizData;
  /** Последнее состояние, которое точно лежит в хранилище (для отката). */
  private saved: string;
  private listeners = new Set<() => void>();

  constructor(storage: KeyValueStorage = defaultStorage(), clock: () => number = Date.now) {
    this.storage = storage;
    this.clock = clock;
    this.data = this.load();
    this.saved = JSON.stringify(this.data);
  }

  private load(): BizData {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? sanitize(safeJsonParse(raw, MAX_BYTES.backupJson)) : emptyData();
    } catch {
      return emptyData();
    }
  }

  /** Запись всё или ничего: хранилище не приняло — данные возвращаются, подписчики не уведомляются. */
  private commit(): void {
    const json = JSON.stringify(this.data);
    try {
      this.storage.setItem(STORAGE_KEY, json);
    } catch {
      this.data = sanitize(JSON.parse(this.saved));
      throw new Error(BIZ_SAVE_FAILED);
    }
    this.saved = json;
    for (const l of [...this.listeners]) {
      try { l(); } catch { /* ошибка одного экрана не отменяет запись и не мешает другим */ }
    }
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
    if (patch.usnRate !== undefined && patch.usnRate !== null) {
      const regime = patch.regime ?? this.data.profile.regime;
      const l = regime === 'usn15' ? USN_RATE_LIMITS.usn15 : USN_RATE_LIMITS.usn6;
      if (!Number.isFinite(patch.usnRate) || patch.usnRate < l.min || patch.usnRate > l.max) throw new Error(`Ставка УСН должна быть от ${l.min} до ${l.max}%`);
    }
    // Денежные поля: только настоящие неотрицательные числа (не NaN и не «пусто», превратившееся в 0 незаметно).
    const money = (v: unknown, label: string, max: number) => {
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max)) throw new Error(`${label}: укажите сумму цифрами, не меньше нуля`);
    };
    money(patch.fixedContributions, 'Фиксированные взносы', 10_000_000);
    money(patch.contributionsPaid, 'Уплаченные взносы', 10_000_000);
    money(patch.patentCost, 'Стоимость патента', 100_000_000);
    const clean: Partial<BizProfile> = { ...patch };
    if (patch.sectors) clean.sectors = [...patch.sectors];
    if (patch.flags) clean.flags = [...patch.flags];
    if (patch.birthYear !== undefined && patch.birthYear !== null) {
      const y = Number(patch.birthYear);
      if (y === 0) clean.birthYear = undefined;
      else if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new Error('Год рождения: четыре цифры, например 1985');
      else clean.birthYear = y;
    }
    this.data.profile = { ...this.data.profile, ...clean };
    this.commit();
    return this.getProfile();
  }

  // ---------- ledger ----------
  listEntries(filter: { kind?: EntryKind; year?: number; contactId?: string } = {}): LedgerEntry[] {
    return this.data.ledger
      .filter(e => !filter.kind || e.kind === filter.kind)
      .filter(e => filter.year === undefined || new Date(e.date).getFullYear() === filter.year)
      .filter(e => !filter.contactId || e.contactId === filter.contactId)
      .sort((a, b) => b.date - a.date)
      .map(copyEntry);
  }

  /** Проверенная запись книги (ещё не добавлена). */
  private makeEntry(input: EntryInput): LedgerEntry {
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма должна быть больше нуля');
    if (amount > 1e12) throw new Error('Слишком большая сумма');
    const description = String(input.description ?? '').trim() || (input.kind === 'income' ? 'Доход' : 'Расход');
    const now = this.clock();
    const date = input.date ?? now;
    if (!Number.isFinite(date) || date < 0 || date > MAX_TS) throw new Error('Некорректная дата');
    return {
      id: newId(input.kind === 'income' ? 'in' : 'ex'),
      kind: input.kind, amount, description,
      date,
      payerType: input.payerType ?? 'person',
      contactId: input.contactId, counterparty: input.counterparty?.trim() || undefined,
      documentId: input.documentId, category: input.category,
      receipt: input.kind === 'income' && this.data.profile.regime === 'npd' && input.taxable !== false ? 'pending' : 'none',
      taxable: input.taxable === false ? false : undefined,
      payMethod: input.payMethod === 'cash' || input.payMethod === 'card' || input.payMethod === 'transfer' ? input.payMethod : undefined,
      noDocs: input.kind === 'expense' && input.noDocs === true ? true : undefined,
      createdAt: now,
    };
  }

  addEntry(input: EntryInput): LedgerEntry {
    const entry = this.makeEntry(input);
    this.data.ledger.push(entry);
    this.commit();
    return copyEntry(entry);
  }

  /** Отметить, что операция не доход/не расход для налога (перевод себе, займ, возврат) — или вернуть в базу. */
  setTaxable(id: string, taxable: boolean): LedgerEntry {
    const e = this.data.ledger.find(x => x.id === id);
    if (!e) throw new Error(`Запись не найдена: ${id}`);
    e.taxable = taxable ? undefined : false;
    if (e.kind === 'income' && this.data.profile.regime === 'npd' && e.receipt !== 'issued') e.receipt = taxable ? 'pending' : 'none';
    this.commit();
    return this.entryCopy(id, e);
  }

  /** Расход без подтверждающих документов (чек, акт, накладная, выписка) не уменьшает базу УСН 15%. */
  setNoDocs(id: string, noDocs: boolean): LedgerEntry {
    const e = this.data.ledger.find(x => x.id === id && x.kind === 'expense');
    if (!e) throw new Error(`Расход не найден: ${id}`);
    e.noDocs = noDocs ? true : undefined;
    this.commit();
    return this.entryCopy(id, e);
  }

  setReceipt(id: string, receiptNumber: string): LedgerEntry {
    const e = this.data.ledger.find(x => x.id === id);
    if (!e) throw new Error(`Запись не найдена: ${id}`);
    e.receipt = 'issued';
    e.receiptNumber = receiptNumber.trim() || undefined;
    this.commit();
    return this.entryCopy(id, e);
  }

  /** Копия записи такой, какой она лежит в данных после сохранения. */
  private entryCopy(id: string, fallback: LedgerEntry): LedgerEntry {
    return copyEntry(this.data.ledger.find(x => x.id === id) ?? fallback);
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
      .sort((a, b) => b.date - a.date)
      .map(copyDoc);
  }

  /** Сам документ в данных (только для методов хранилища). */
  private doc(id: string): BizDocument | undefined {
    return this.data.documents.find(d => d.id === id);
  }

  getDocument(id: string): BizDocument | undefined {
    const d = this.doc(id);
    return d ? copyDoc(d) : undefined;
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
    if (!Number.isFinite(date) || date < 0 || date > MAX_TS) throw new Error('Некорректная дата документа');
    const dueDays = Number(input.dueDays ?? 5);
    if (!Number.isFinite(dueDays) || dueDays < 0 || dueDays > 365) throw new Error('Срок оплаты: от 0 до 365 дней');
    const doc: BizDocument = {
      id: newId('doc'), type: input.type, number: this.nextNumber(input.type, date), date,
      dueDate: input.type === 'invoice' ? date + Math.round(dueDays) * DAY : undefined,
      contactId: input.contactId, clientName, clientDetails: input.clientDetails?.trim() ?? '',
      items, total: round2(items.reduce((s, i) => s + i.qty * i.price, 0)),
      status: 'draft', basis: input.basis, createdAt: now, updatedAt: now,
      ...this.vatForDocument(date),
    };
    this.data.documents.push(doc);
    this.commit();
    return this.getDocument(doc.id) ?? copyDoc(doc);
  }

  /** НДС для нового документа: ставка и основание «Без НДС». */
  vatForDocument(date: number): { vatRate?: number; vatNote: string } {
    const p = this.data.profile;
    if (p.regime === 'npd') return { vatNote: 'Без НДС (плательщик налога на профессиональный доход)' };
    if (p.regime === 'patent') return { vatNote: 'Без НДС (патентная система налогообложения)' };
    if (p.regime === 'usn6' || p.regime === 'usn15' || (p.regime === 'ooo' && p.orgOnUsn)) {
      const v = this.vatStatus(new Date(date).getFullYear());
      const rate = v.rateByMonth[new Date(date).getMonth()] ?? 0;
      if (rate > 0) return { vatRate: rate, vatNote: '' };
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
    const d = this.doc(id);
    if (!d) throw new Error(`Документ не найден: ${id}`);
    if (status === 'paid') throw new Error('Оплату отмечайте кнопкой «Оплачен»: так доход попадёт в учёт');
    if (d.status !== status && !DOC_TRANSITIONS[d.status].includes(status)) throw new Error(`Нельзя перевести документ из «${DOC_STATUS_LABELS[d.status]}» в «${DOC_STATUS_LABELS[status]}»`);
    d.status = status;
    d.updatedAt = this.clock();
    this.commit();
    return this.getDocument(id) ?? copyDoc(d);
  }

  /** Marks an invoice paid and records the income (once). Доход и отметка «оплачен» сохраняются одной записью. */
  markPaid(id: string, opts: { date?: number; payerType?: PayerType; payMethod?: PayMethod } = {}): { document: BizDocument; entry: LedgerEntry } {
    const d = this.doc(id);
    if (!d) throw new Error(`Документ не найден: ${id}`);
    if (d.type !== 'invoice') throw new Error('Оплаченным можно отметить только счёт');
    if (d.status === 'cancelled') throw new Error('Счёт отменён. Сначала верните его в черновик.');
    const existing = this.data.ledger.find(e => e.documentId === d.id);
    if (existing) {
      // Доход уже записан (например, прежняя версия упала между двумя записями): доводим счёт до «оплачен».
      if (d.status !== 'paid') {
        d.status = 'paid';
        d.paidAt = existing.date;
        d.updatedAt = this.clock();
        this.commit();
      }
      return { document: this.getDocument(id) ?? copyDoc(d), entry: this.entryCopy(existing.id, existing) };
    }
    const looksCompany = /^(ооо|ао|пао|зао|ип|оао|нко|ано)(?=\s|$|«|")/i.test(d.clientName.trim());
    const entry = this.makeEntry({
      kind: 'income', amount: d.total, description: `Оплата по счёту № ${d.number}: ${d.items.map(i => i.name).join(', ')}`,
      date: opts.date, payerType: opts.payerType ?? (looksCompany ? 'company' : 'person'),
      contactId: d.contactId, counterparty: d.clientName, documentId: d.id, payMethod: opts.payMethod,
    });
    this.data.ledger.push(entry);
    d.status = 'paid';
    d.paidAt = entry.date;
    d.updatedAt = this.clock();
    this.commit();
    // После удачной записи отдаём копии того, что реально лежит в данных.
    return { document: this.getDocument(id) ?? copyDoc(d), entry: this.entryCopy(entry.id, entry) };
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
      .map(d => ({ document: copyDoc(d), daysOverdue: d.dueDate && d.dueDate < now ? Math.floor((now - d.dueDate) / DAY) : 0 }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.document.date - b.document.date);
  }

  reminderText(id: string): string {
    const d = this.doc(id);
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
      const exp = inQ.filter(e => e.kind === 'expense' && !OWN_CONTRIBUTIONS_CATEGORY.test(e.category ?? ''));
      const expenses = round2(exp.filter(e => !e.noDocs).reduce((s, e) => s + e.amount, 0));
      const expensesNoDocs = round2(exp.filter(e => e.noDocs).reduce((s, e) => s + e.amount, 0));
      return { income, expenses, expensesNoDocs };
    };
    const { income, expenses, expensesNoDocs } = totals(ofYear(year));
    const rate = usnRate(regime, p.usnRate);
    const prev = totals(ofYear(year - 1));
    const contributionsFixed = p.fixedContributionsYear === year ? p.fixedContributions : contributionsFor(year).fixed;
    const extraBase = (inc: number, exp: number) => (regime === 'usn6' ? inc : inc - exp);
    const contributionsExtra = round2(onePercent(extraBase(income, expenses), year));
    const contributionsPrevExtra = round2(prev.income > 0 ? onePercent(extraBase(prev.income, prev.expenses), year - 1) : 0);
    let taxGross: number; let minTax = 0; let base: number; let tax: number; let deducted: number;
    if (regime === 'usn6') {
      base = income;
      taxGross = round2(income * rate / 100);
      const canDeduct = contributionsFixed + contributionsPrevExtra;
      deducted = round2(Math.min(canDeduct, p.hasEmployees ? taxGross * 0.5 : taxGross));
      tax = round2(taxGross - deducted);
    } else {
      // 1% можно учесть в расходах года начисления или года уплаты, но только один раз (письмо ФНС СД-4-3/12916@).
      deducted = round2(contributionsFixed + (p.usn15OnePercentTiming === 'next' ? contributionsPrevExtra : contributionsExtra));
      base = round2(Math.max(0, income - expenses - deducted));
      taxGross = round2(base * rate / 100);
      minTax = round2(income * 0.01);
      tax = round2(Math.max(taxGross, minTax));
    }
    const quarters = [1, 2, 3, 4].map(q => {
      const t = totals(ofYear(year), q);
      const cum = (regime === 'usn6' ? t.income : Math.max(0, t.income - t.expenses)) * rate / 100;
      return { quarter: q, income: t.income, expenses: t.expenses, taxCumulative: round2(cum) };
    });
    return {
      year, regime, income, expenses, expensesNoDocs, base: round2(base), taxGross, rate, minTax, contributionsFixed, contributionsExtra, taxAfterContributions: tax,
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
        for (let q = 0; q < 4; q++) {
          const qr = vat.rateByMonth.slice(q * 3, q * 3 + 3).filter(r => r > 0);
          if (!qr.length) continue;
          const rates = [...new Set(qr)].join('/');
          add(y, q * 3 + 3, 25, 'Декларация по НДС', `За ${q + 1} квартал ${y} (ставка ${rates}%)`);
          for (let k = 0; k < 3; k++) add(y, q * 3 + 3 + k, 28, 'Уплата НДС', `${k + 1}/3 налога за ${q + 1} квартал ${y}`);
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

  /** Доходы НПД, по которым срок чека прошёл: наличные и карта — сразу при оплате, перевод — 9-е число следующего месяца. */
  overdueReceipts(): LedgerEntry[] {
    const now = this.clock();
    return this.data.ledger.filter(e => e.kind === 'income' && e.receipt === 'pending' && npdReceiptDeadline(e.date, e.payMethod) < now).map(copyEntry);
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
    try { parsed = safeJsonParse(json, MAX_BYTES.backupJson); } catch { throw new Error('Файл не похож на резервную копию (неверный JSON или слишком большой)'); }
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) throw new Error('Это не резервная копия раздела «Бизнес»');
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
    const cell = (v: string) => csvSafe(v, ';');
    return [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  }
}

export function formatRub(n: number): string {
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} ₽`;
}

export const bizStore = new BizStore();
