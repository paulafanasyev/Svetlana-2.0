// Защищённый протокол моста ПК ↔ телефон (Svetlana-home), версия 2.
// Код подключения по сети больше не передаётся. Из кода и случайной «соли» телефона (PBKDF2-SHA256,
// 100 000 итераций) обе стороны получают общий ключ AES-GCM 256. Каждый запрос и ответ зашифрован
// и подписан этим ключом; в запрос входят время и одноразовый номер, поэтому перехваченный запрос
// нельзя ни прочитать, ни подделать, ни повторить. Ответ привязан к номеру запроса: чужое устройство
// в сети не может выдать себя за ваш телефон.

export const BRIDGE_PROTOCOL = 2;
export const BRIDGE_PBKDF2_ITER = 100_000;
const LABEL = 'svetlana-bridge-v2';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ''; u.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** «abcd-efgh» и «ABCDEFGH» — один и тот же код. */
export function normalizeCode(raw: string | null | undefined): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Общий ключ из кода подключения и соли телефона. Ключ неизвлекаемый. */
export async function deriveBridgeKey(code: string, saltB64: string, iterations = BRIDGE_PBKDF2_ITER): Promise<CryptoKey> {
  const c = normalizeCode(code);
  if (c.length < 8) throw new Error('Код подключения слишком короткий');
  if (!B64_RE.test(saltB64) || unb64(saltB64).length < 16) throw new Error('Телефон прислал неверные параметры защиты');
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', enc.encode(c), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export const requestAad = (route: string, ts: number, nonce: string) => `${LABEL}\nreq\n${route}\n${ts}\n${nonce}`;
export const responseAad = (route: string, nonce: string) => `${LABEL}\nres\n${route}\n${nonce}`;

export interface SealOptions { ts?: number; nonce?: Uint8Array; iv?: Uint8Array }

/** Зашифровать запрос. Возвращает тело запроса и одноразовый номер (нужен для проверки ответа). */
export async function sealRequest(key: CryptoKey, route: string, plaintext: string, o: SealOptions = {}): Promise<{ body: string; nonce: string }> {
  const ts = o.ts ?? Date.now();
  const nonce = b64(o.nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const iv = o.iv ? new Uint8Array(o.iv) : globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(requestAad(route, ts, nonce)) }, key, enc.encode(plaintext)));
  return { body: JSON.stringify({ v: BRIDGE_PROTOCOL, ts, nonce, iv: b64(iv), ct: b64(ct) }), nonce };
}

/** Расшифровать и проверить ответ телефона. Бросает ошибку, если ответ подделан или не к этому запросу. */
export async function openResponse(key: CryptoKey, route: string, nonce: string, body: string): Promise<string> {
  let o: { v?: unknown; iv?: unknown; ct?: unknown };
  try { o = JSON.parse(body); } catch { throw new Error(BAD_REPLY); }
  if (!o || o.v !== BRIDGE_PROTOCOL || typeof o.iv !== 'string' || typeof o.ct !== 'string' || !B64_RE.test(o.iv) || !B64_RE.test(o.ct)) throw new Error(BAD_REPLY);
  try {
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(o.iv), additionalData: enc.encode(responseAad(route, nonce)) }, key, unb64(o.ct));
    return dec.decode(pt);
  } catch { throw new Error(BAD_REPLY); }
}

export const BAD_REPLY = 'Ответ не прошёл проверку подлинности: это не ваш телефон или данные изменены в сети';

/** Адрес телефона: только домашняя сеть (10.x, 172.16–31.x, 192.168.x) или этот компьютер. Без логинов и путей. */
export function validateBridgeEndpoint(raw: string): string {
  const v = String(raw ?? '').trim().replace(/\/+$/, '');
  const m = /^(https?):\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(v)
    ?? /^(https?):\/\/(localhost)(?::(\d{1,5}))?$/.exec(v);
  const fail = () => new Error('Адрес телефона должен быть в домашней сети, например http://192.168.1.20:8080');
  if (!m) throw fail();
  if (m[2] === 'localhost') return v;
  const o = m.slice(2, 6).map(Number);
  if (o.some(n => n > 255)) throw fail();
  const port = m[6] ? Number(m[6]) : 80;
  if (port < 1 || port > 65535) throw fail();
  const [a, b] = o;
  const ok = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
  if (!ok) throw fail();
  return v;
}
