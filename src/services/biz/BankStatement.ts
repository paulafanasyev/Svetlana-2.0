// Импорт банковской выписки в формате 1С (1CClientBankExchange) — его выгружают почти все банки.
import type { KeyValueStorage } from '../crm/CRMStore';
import { bizStore, BizStore, type PayerType } from './BizStore';

export interface BankDoc {
  type: string;
  number: string;
  date?: number;
  amount: number;
  payerAccount: string;
  payerName: string;
  payerInn: string;
  payeeAccount: string;
  payeeName: string;
  payeeInn: string;
  purpose: string;
  debitedAt?: number;
  creditedAt?: number;
}

export interface ParsedStatement { account: string; from?: number; to?: number; docs: BankDoc[] }

export interface StatementImportReport {
  incomes: number;
  expenses: number;
  invoicesPaid: number;
  duplicates: number;
  skipped: number;
  total: number;
}

const IMPORTED_KEY = 'svetlana_bank_imported_v1';

function parseRuDate(v: string | undefined): number | undefined {
  const m = v?.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12).getTime() : undefined;
}

/** Байты файла → текст. 1С-выписки обычно в Windows-1251, иногда в UTF-8. */
export function decodeStatement(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (utf8.includes('СекцияДокумент') || utf8.includes('РасчСчет')) return utf8;
  try { return new TextDecoder('windows-1251').decode(buf); } catch { return utf8; }
}

export function parse1C(text: string): ParsedStatement {
  if (!text.includes('1CClientBankExchange')) throw new Error('Это не выписка 1С (нет заголовка 1CClientBankExchange). В интернет-банке выберите экспорт «в 1С».');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const head: Record<string, string> = {};
  const docs: BankDoc[] = [];
  let cur: Record<string, string> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    const key = eq >= 0 ? line.slice(0, eq) : line;
    const val = eq >= 0 ? line.slice(eq + 1) : '';
    if (key === 'СекцияДокумент') { cur = { __type: val }; continue; }
    if (key === 'КонецДокумента') {
      if (cur) {
        const amount = Number((cur['Сумма'] ?? '0').replace(',', '.'));
        docs.push({
          type: cur.__type ?? '', number: cur['Номер'] ?? '', date: parseRuDate(cur['Дата']),
          amount: Number.isFinite(amount) ? amount : 0,
          payerAccount: cur['ПлательщикСчет'] ?? cur['ПлательщикРасчСчет'] ?? '',
          payerName: cur['Плательщик1'] ?? cur['Плательщик'] ?? '', payerInn: cur['ПлательщикИНН'] ?? '',
          payeeAccount: cur['ПолучательСчет'] ?? cur['ПолучательРасчСчет'] ?? '',
          payeeName: cur['Получатель1'] ?? cur['Получатель'] ?? '', payeeInn: cur['ПолучательИНН'] ?? '',
          purpose: cur['НазначениеПлатежа'] ?? '',
          debitedAt: parseRuDate(cur['ДатаСписано']), creditedAt: parseRuDate(cur['ДатаПоступило']),
        });
      }
      cur = null;
      continue;
    }
    if (cur) cur[key] = val; else if (!(key in head)) head[key] = val;
  }
  return { account: head['РасчСчет'] ?? '', from: parseRuDate(head['ДатаНачала']), to: parseRuDate(head['ДатаКонца']), docs };
}

function payerTypeOf(name: string, inn: string): PayerType {
  if (inn.length === 10) return 'company';
  if (/^(ип|индивидуальный предприниматель)\s/i.test(name.trim())) return 'company';
  return 'person';
}

function cleanName(name: string): string {
  return name.replace(/^ИНН\s*\d+\s*/i, '').replace(/\s+/g, ' ').trim();
}

function loadImported(storage: KeyValueStorage | null): Set<string> {
  try { return new Set(JSON.parse(storage?.getItem(IMPORTED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}

function defaultStorage(): KeyValueStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * Разносит выписку: поступления → доходы, списания → расходы. Оплаты, где в назначении есть «счёт № N»
 * и сумма совпадает с открытым счётом, закрывают этот счёт. Повторный импорт той же выписки не дублирует записи.
 */
export function importStatement(parsed: ParsedStatement, opts: { store?: BizStore; storage?: KeyValueStorage | null; ownAccount?: string } = {}): StatementImportReport {
  const store = opts.store ?? bizStore;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const own = (opts.ownAccount || parsed.account || store.getProfile().account).trim();
  if (!own) throw new Error('Не понятно, какой счёт ваш: в выписке нет поля РасчСчет. Укажите расчётный счёт в профиле.');
  const imported = loadImported(storage);
  const report: StatementImportReport = { incomes: 0, expenses: 0, invoicesPaid: 0, duplicates: 0, skipped: 0, total: parsed.docs.length };

  for (const d of parsed.docs) {
    const incoming = d.payeeAccount === own && d.payerAccount !== own;
    const outgoing = d.payerAccount === own && d.payeeAccount !== own;
    if ((!incoming && !outgoing) || d.amount <= 0) { report.skipped++; continue; }
    const date = (incoming ? d.creditedAt : d.debitedAt) ?? d.date;
    const key = [own, d.number, d.date ?? '', d.amount.toFixed(2), incoming ? d.payerInn : d.payeeInn, incoming ? 'in' : 'out'].join('|');
    if (imported.has(key)) { report.duplicates++; continue; }

    if (incoming) {
      const name = cleanName(d.payerName);
      const payerType = payerTypeOf(name, d.payerInn);
      const invNo = d.purpose.match(/сч[её]т[ауе]?\s*(?:на оплату\s*)?(?:№|N|#)?\s*(\d+)/i)?.[1];
      const invoice = invNo ? store.receivables().map(r => r.document).find(x => x.number === invNo && Math.abs(x.total - d.amount) < 0.01) : undefined;
      if (invoice) {
        store.markPaid(invoice.id, { date, payerType });
        report.invoicesPaid++;
      } else {
        store.addEntry({ kind: 'income', amount: d.amount, description: d.purpose || 'Поступление на счёт', date, payerType, counterparty: name || undefined, category: 'bank' });
      }
      report.incomes++;
    } else {
      store.addEntry({ kind: 'expense', amount: d.amount, description: d.purpose || 'Списание со счёта', date, counterparty: cleanName(d.payeeName) || undefined, category: 'bank' });
      report.expenses++;
    }
    imported.add(key);
  }
  storage?.setItem(IMPORTED_KEY, JSON.stringify([...imported]));
  return report;
}
