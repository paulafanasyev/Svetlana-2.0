// Маскировка секретов и личных данных перед записью в журналы и экспортом журналов:
// API-ключи, Bearer-токены, код подключения телефона, номера карт и телефонов, картинки (скриншоты) и
// поля с «секретными» именами (apiKey, api_token, auth_token, private_key, password, secret, session, pin, otp…).
// Для долговременной памяти (localStorage) — redactSecrets/redactDeep: то же, но телефоны сохраняются
// (они нужны Светлане, чтобы звонить и писать), а пароли и коды из SMS скрываются.

const MAX_STRING = 4000;
const MAX_DEPTH = 4;
const SECRET_KEY_RE = /api[-_]?key|secret|passw|authorization|cookie|pairing[-_]?code|private[-_]?key|credential|session|token$|^(pin|otp|apiKey|key|cvv|cvc)$/i;
const IMAGE_KEY_RE = /^(image|screenshot|screen|png|jpeg|base64|bitmap)$/i;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Ключи, токены, код подключения, карты, пароли «пароль: …», коды из SMS. Телефоны не трогаем. */
export function redactSecrets(input: unknown): string {
  let s = String(input ?? '');
  s = s.replace(/\b(?:sk|gsk|xai|rk|pk)[-_][A-Za-z0-9_-]{12,}/g, '[ключ скрыт]');
  s = s.replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[ключ скрыт]');
  s = s.replace(/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, '[ключ скрыт]');
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[ключ скрыт]');
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [скрыто]');
  s = s.replace(/\b[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/g, '[код подключения скрыт]');
  s = s.replace(/((?:парол[ьяеи]|password|passwd|pin|пин|cvv|cvc)\s*[:=]\s*)\S+/gi, '$1[скрыто]');
  s = s.replace(/((?:код|code)\s*[:=]?\s*)\d{4,8}(?!\d)/gi, '$1[скрыто]');
  s = s.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, m => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? `[карта ••${digits.slice(-4)}]` : m;
  });
  s = s.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, '[изображение скрыто]');
  return s;
}

/** Маскирует секреты внутри произвольного текста (для журналов: ещё и телефоны). */
export function redactText(input: unknown): string {
  let s = String(input ?? '');
  s = s.replace(/\b(?:sk|gsk|xai|rk|pk)[-_][A-Za-z0-9_-]{12,}/g, '[ключ скрыт]');
  s = s.replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[ключ скрыт]');
  s = s.replace(/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, '[ключ скрыт]');
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[ключ скрыт]');
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [скрыто]');
  s = s.replace(/\b[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/g, '[код подключения скрыт]');
  s = s.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, m => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? `[карта ••${digits.slice(-4)}]` : m;
  });
  s = s.replace(/(?<![\d\w])\+?\d[\d\s().-]{8,16}\d(?!\d)/g, m => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 12 ? `[телефон ••${digits.slice(-2)}]` : m;
  });
  s = s.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, '[изображение скрыто]');
  return s;
}

/** Глубокая копия значения для журнала: секреты скрыты, картинки выброшены, размер ограничен. */
export function redactValue(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v.length > 1000 && /^[A-Za-z0-9+/=\s]+$/.test(v)) return `[данные ${v.length} символов скрыты]`;
    const r = redactText(v);
    return r.length > MAX_STRING ? `${r.slice(0, MAX_STRING)}…` : r;
  }
  if (typeof v !== 'object') return String(typeof v);
  if (depth >= MAX_DEPTH) return '[…]';
  if (v instanceof Error) return { name: v.name, message: redactText(v.message) };
  if (Array.isArray(v)) return v.slice(0, 100).map(x => redactValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 100)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (SECRET_KEY_RE.test(k)) { out[k] = val == null || val === '' ? val : '[скрыто]'; continue; }
    if (IMAGE_KEY_RE.test(k) && typeof val === 'string') { out[k] = `[изображение ${val.length} символов скрыто]`; continue; }
    out[k] = redactValue(val, depth + 1);
  }
  return out;
}

/** Для памяти: как redactValue, но телефоны сохраняются и без обрезки длинных строк. */
export function redactDeep<T>(v: T, depth = 0): T {
  if (typeof v === 'string') return redactSecrets(v) as unknown as T;
  if (v == null || typeof v !== 'object') return v;
  if (depth >= 8) return undefined as unknown as T;
  if (Array.isArray(v)) return v.map(x => redactDeep(x, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (SECRET_KEY_RE.test(k)) { out[k] = val == null || val === '' ? val : '[скрыто]'; continue; }
    out[k] = redactDeep(val, depth + 1);
  }
  return out as T;
}
