// Безопасный разбор и вывод данных: лимиты размеров, JSON без загрязнения прототипов,
// CSV без формул, удаление управляющих символов. Используется всеми импортами/экспортами.

export const MAX_BYTES = {
  backupJson: 20 * 1024 * 1024,   // резервные копии CRM/бизнеса
  csv: 5 * 1024 * 1024,           // CSV контактов
  statement: 20 * 1024 * 1024,    // выписка 1С
  storage: 10 * 1024 * 1024,      // одна запись localStorage
} as const;

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Проверка размера файла ДО чтения в память. */
export function assertFileSize(file: { size: number }, max: number, label = 'Файл'): void {
  if (!Number.isFinite(file.size) || file.size < 0) throw new Error(`${label}: не удалось определить размер`);
  if (file.size > max) throw new Error(`${label} слишком большой: ${(file.size / 1048576).toFixed(1)} МБ, максимум ${(max / 1048576).toFixed(0)} МБ`);
}

/** JSON.parse с лимитом размера и вырезанием ключей __proto__/constructor/prototype. */
export function safeJsonParse(text: string, maxChars: number = MAX_BYTES.backupJson): unknown {
  if (typeof text !== 'string') throw new Error('Ожидался текст JSON');
  if (text.length > maxChars) throw new Error('Данные слишком большие');
  return JSON.parse(text, (key, value) => (BAD_KEYS.has(key) ? undefined : value));
}

/** Обычный объект (не массив, не null) без опасных ключей. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Копия аргументов инструмента: только простые значения, глубина ≤ 3, строки ≤ 2000 символов. */
export function sanitizeArgs(v: unknown, depth = 0): Record<string, unknown> {
  if (!isPlainObject(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v).slice(0, 40)) {
    if (BAD_KEYS.has(k) || !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k)) continue;
    if (typeof val === 'string') out[k] = val.slice(0, 2000);
    else if (typeof val === 'number') { if (Number.isFinite(val)) out[k] = val; }
    else if (typeof val === 'boolean') out[k] = val;
    else if (Array.isArray(val)) out[k] = val.slice(0, 50).filter(x => ['string', 'number', 'boolean'].includes(typeof x));
    else if (isPlainObject(val) && depth < 2) out[k] = sanitizeArgs(val, depth + 1);
  }
  return out;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g;

/** Удаляет управляющие символы и символы смены направления текста (Trojan Source). */
export function stripControl(s: unknown, keepNewlines = true): string {
  const str = String(s ?? '').replace(CONTROL, '');
  return keepNewlines ? str : str.replace(/[\r\n\t]+/g, ' ');
}

/**
 * Ячейка CSV, безопасная для Excel/LibreOffice/Google Sheets: если первый значимый символ
 * (после пробелов и управляющих) — = + - @ или ячейка начинается с табуляции/CR/LF, добавляем апостроф.
 */
export function csvSafe(value: unknown, sep = ';'): string {
  const v = String(value ?? '');
  const risky = /^[\s\u00a0]*[=+\-@\uff1d\uff0b\uff0d\uff20]/.test(v) || /^[\t\r\n]/.test(v);
  const safe = risky ? `'${v}` : v;
  const needsQuote = safe.includes('"') || safe.includes(sep) || /[\r\n,]/.test(safe);
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}
