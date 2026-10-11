// Маскировка секретов перед сохранением на диск (localStorage): API-ключи, токены, пароли,
// коды из SMS и номера банковских карт (по алгоритму Луна). Телефоны и обычные числа не трогаем.
const KEY = '[ключ скрыт]';
const PATTERNS: [RegExp, string][] = [
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, KEY],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, KEY],
  [/\bgsk_[A-Za-z0-9]{16,}/g, KEY],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, KEY],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, KEY],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [скрыто]'],
  [/((?:парол[ьяеи]|password|passwd|pin|пин|cvv|cvc)\s*[:=]\s*)\S+/gi, '$1[скрыто]'],
  [/((?:код|code)\s*[:=]?\s*)\d{4,8}\b/gi, '$1[скрыто]'],
];
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out.replace(CARD, m => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[карта скрыта]' : m;
  });
}

/** То же для вложенных объектов (metadata): маскируются все строки, глубина ограничена. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return undefined as unknown as T;
  if (typeof value === 'string') return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map(v => redactDeep(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = redactDeep(v, depth + 1);
    return o as T;
  }
  return value;
}
