// Связь приложения с личным кабинетом на сайте «Мир Самозанятых».
// Привязка: одноразовый код из кабинета (XXXX-XXXX-XXXX, 10 минут) → токен устройства.
// Токен хранится только зашифрованным (SecretStore). Раз в 10 минут отправляется «пульс»:
// версия, флаги защиты и список установленных локальных моделей. Клиенты, финансы, голос,
// переписка и ключи в кабинет НЕ передаются никогда: тело запроса собирается по белому списку.
// Одинаково в Windows и Android. Телефон привязывается как platform 'android'; локальные модели он берёт у Ollama
// по адресу из настроек (компьютер в домашней сети), компьютер — у 127.0.0.1.
import { getSecret, setSecret, deleteSecret, secretStorageMode } from '../security/SecretStore';
import { loadTemplate } from '../voice/VoicePrint';
import { APP_VERSION as CURRENT_VERSION } from '../../version';
import { isAndroidApp } from '../../platform';

export const CABINET_ORIGINS = [
  'https://xn----8sba1acxdkgqms3b9euc.xn--p1ai', // мир-самозанятых.рф
  'https://mir-samozanyatykh-api-frankfurt.onrender.com',
] as const;
export type CabinetOrigin = (typeof CABINET_ORIGINS)[number];
const API = '/api/v1/devices';
const TOKEN_SECRET = 'cabinet.device_token';
const META_KEY = 'svetlana_cabinet_v1';
const CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
const TIMEOUT_MS = 10_000;
const MAX_REPLY = 64 * 1024;
export const HEARTBEAT_MS = 10 * 60_000;
/** Версия приложения — одна на всё приложение (src/version.ts). */
export const APP_VERSION = CURRENT_VERSION;
/** Кабинет уже принял код, но на этом устройстве привязку сохранить не удалось. */
export const LINK_SAVE_FAILED = 'Кабинет принял код, но сохранить привязку на этом устройстве не удалось. Отключите это устройство в личном кабинете, возьмите новый код и повторите.';
const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';
const OLLAMA_RE = /^http:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?$/;

/** Как устройство представляется кабинету. */
export function devicePlatform(): 'windows' | 'android' {
  return isAndroidApp() ? 'android' : 'windows';
}

/** Каталог моделей ПК (id совпадают с каталогом сайта). Сопоставление с именами моделей Ollama. */
const OLLAMA_TO_CATALOG: [RegExp, string][] = [
  [/^qwen3:4b/i, 'qwen3-4b-q4km'],
  [/t-lite/i, 't-lite-it-2.1-q4km'],
  [/gigachat/i, 'gigachat3.1-10b-a1.8b-q4km'],
  [/bge-m3/i, 'bge-m3'],
];

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }
function kv(): KV | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

export interface CabinetMeta { origin: CabinetOrigin; deviceId: string; linkedAt: number; lastOk?: number; lastError?: string }
export interface DeviceStatus { bridge_v2: boolean; voice_enrolled: boolean; secrets_encrypted: boolean; confirm_gate: boolean; paired_with: 'android' | null }
export interface DeviceModel { id: string; size_mb?: number }
export interface Heartbeat { app_version: string; status: DeviceStatus; models: DeviceModel[] }

/** Нормализует код из кабинета: регистр, пробелы и дефисы не важны. Бросает понятную ошибку. */
export function normalizeLinkCode(raw: string): string {
  const s = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!CODE_ALPHABET.test(s)) throw new Error('Код должен состоять из 12 символов, как в личном кабинете: XXXX-XXXX-XXXX');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export function assertCabinetOrigin(origin: string): CabinetOrigin {
  if (!(CABINET_ORIGINS as readonly string[]).includes(origin)) throw new Error('Неизвестный адрес личного кабинета');
  return origin as CabinetOrigin;
}

export function loadMeta(s: KV | null = kv()): CabinetMeta | null {
  const raw = s?.getItem(META_KEY);
  if (!raw || raw.length > 2000) return null;
  try {
    const o = JSON.parse(raw) as Partial<CabinetMeta>;
    if (typeof o.deviceId !== 'string' || typeof o.linkedAt !== 'number' || typeof o.origin !== 'string') return null;
    return { ...o, origin: assertCabinetOrigin(o.origin) } as CabinetMeta;
  } catch { return null; }
}
function saveMeta(m: CabinetMeta | null, s: KV | null = kv()): void {
  if (m) s?.setItem(META_KEY, JSON.stringify(m)); else s?.removeItem?.(META_KEY);
}
/** Запись служебного состояния пульса: переполненное хранилище не должно ронять пульс. */
function trySaveMeta(m: CabinetMeta | null, s: KV | null): void {
  try { saveMeta(m, s); } catch { /* не критично */ }
}
/** Та же ли это привязка: пока шёл запрос, её могли снять или заменить новой. */
export function sameLink(a: CabinetMeta | null, b: CabinetMeta | null): boolean {
  return !!a && !!b && a.deviceId === b.deviceId && a.linkedAt === b.linkedAt && a.origin === b.origin;
}

async function call(f: FetchLike, url: string, init: RequestInit): Promise<{ status: number; body: any }> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await f(url, { ...init, signal: ctl?.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    const text = (await res.text()).slice(0, MAX_REPLY + 1);
    if (text.length > MAX_REPLY) throw new Error('Слишком большой ответ сервера');
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: res.status, body };
  } finally { if (t) clearTimeout(t); }
}

const defaultFetch = (): FetchLike => {
  if (typeof fetch !== 'function') throw new Error('Нет доступа к сети');
  return fetch as unknown as FetchLike;
};

/** Привязать это устройство (компьютер или телефон) к личному кабинету по одноразовому коду. */
export async function linkDevice(opts: { code: string; name: string; origin?: string; fetchImpl?: FetchLike; storage?: KV | null }): Promise<CabinetMeta> {
  const code = normalizeLinkCode(opts.code);
  const origin = assertCabinetOrigin(opts.origin ?? CABINET_ORIGINS[0]);
  const platform = devicePlatform();
  const name = String(opts.name ?? '').trim().slice(0, 80) || (platform === 'android' ? 'Телефон' : 'Компьютер');
  const { status, body } = await call(opts.fetchImpl ?? defaultFetch(), `${origin}${API}/link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, platform, name, app_version: APP_VERSION }),
  });
  if (status !== 200 || typeof body?.device_token !== 'string' || typeof body?.device_id !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(body.device_token)) {
    throw new Error(typeof body?.message === 'string' ? body.message.slice(0, 200) : `Не удалось привязать (HTTP ${status})`);
  }
  const storage = opts.storage === undefined ? kv() : opts.storage;
  const meta: CabinetMeta = { origin, deviceId: body.device_id.slice(0, 64), linkedAt: Date.now() };
  // Кабинет уже создал устройство. Если сохранить локально не вышло, не оставляем
  // половинчатое состояние (токен без описания или наоборот) и честно говорим, что делать.
  try {
    await setSecret(TOKEN_SECRET, body.device_token);
    saveMeta(meta, storage);
  } catch {
    try { await deleteSecret(TOKEN_SECRET); } catch { /* уже нечего удалять */ }
    trySaveMeta(null, storage);
    throw new Error(LINK_SAVE_FAILED);
  }
  return meta;
}

/** Забыть привязку на этом устройстве (в кабинете устройство отключается кнопкой «Отключить»). */
export async function unlinkLocal(storage: KV | null = kv()): Promise<void> {
  // Сначала описание: даже если хранилище ключей сбоит, приложение перестанет считать себя привязанным.
  trySaveMeta(null, storage);
  await deleteSecret(TOKEN_SECRET);
}

/** Адрес Ollama из настроек «★ Светлана Локальная» (только домашняя сеть или это устройство). */
export function ollamaEndpoint(s: KV | null = kv()): string {
  try {
    const raw = s?.getItem('svetlana_ai_providers');
    const list = raw && raw.length < 200_000 ? JSON.parse(raw) : null;
    const p = Array.isArray(list) ? list.find((x: any) => x?.id === 'ollama') : null;
    const e = typeof p?.endpoint === 'string' ? p.endpoint.trim().replace(/\/+$/, '') : '';
    return OLLAMA_RE.test(e) ? e : DEFAULT_OLLAMA;
  } catch { return DEFAULT_OLLAMA; }
}

async function ollamaModels(f: FetchLike, endpoint: string): Promise<DeviceModel[]> {
  try {
    const { status, body } = await call(f, `${endpoint}/api/tags`, { method: 'GET' });
    if (status !== 200 || !Array.isArray(body?.models)) return [];
    const out = new Map<string, DeviceModel>();
    for (const m of body.models.slice(0, 200)) {
      const name = typeof m?.name === 'string' ? m.name : '';
      const hit = OLLAMA_TO_CATALOG.find(([re]) => re.test(name));
      if (hit && !out.has(hit[1])) out.set(hit[1], { id: hit[1], size_mb: typeof m.size === 'number' ? Math.round(m.size / 1e6) : undefined });
    }
    return [...out.values()];
  } catch { return []; }
}

/** Собрать пульс по белому списку полей. Ничего личного сюда не попадает. Одинаково на компьютере и телефоне. */
export async function collectHeartbeat(opts: { fetchImpl?: FetchLike | null; storage?: KV | null } = {}): Promise<Heartbeat> {
  const s = opts.storage === undefined ? kv() : opts.storage;
  // Защищённый мост v2 к Svetlana-home есть и в Windows, и в Android (страница «Телефон»).
  const paired = !!(await getSecret('bridge.code'));
  return {
    app_version: APP_VERSION,
    status: {
      bridge_v2: true,
      voice_enrolled: !!loadTemplate(s as any),
      secrets_encrypted: (await secretStorageMode()) === 'encrypted',
      confirm_gate: true,
      paired_with: paired ? 'android' : null,
    },
    models: opts.fetchImpl === null ? [] : await ollamaModels(opts.fetchImpl ?? defaultFetch(), ollamaEndpoint(s)),
  };
}

/**
 * Отправить пульс. 401 — устройство отключено в кабинете: локальная привязка стирается. Никогда не бросает.
 * Если пока шёл запрос привязку сняли или заменили, старое описание не возвращается и новое не трогается.
 */
export async function sendHeartbeat(opts: { fetchImpl?: FetchLike; storage?: KV | null; heartbeat?: Heartbeat } = {}): Promise<'ok' | 'unlinked' | 'not_linked' | 'error'> {
  const s = opts.storage === undefined ? kv() : opts.storage;
  const meta = loadMeta(s);
  if (!meta) return 'not_linked';
  let token: string | null = null;
  try { token = await getSecret(TOKEN_SECRET); } catch { return 'error'; }
  if (!token) return 'not_linked';
  const still = (): boolean => sameLink(loadMeta(s), meta);
  try {
    const f = opts.fetchImpl ?? defaultFetch();
    const hb = opts.heartbeat ?? await collectHeartbeat({ fetchImpl: f, storage: s });
    const { status } = await call(f, `${meta.origin}${API}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Device ${token}` },
      body: JSON.stringify(hb),
    });
    if (!still()) return 'not_linked';
    if (status === 401) {
      try { await unlinkLocal(s); } catch { /* описание уже стёрто */ }
      return 'unlinked';
    }
    if (status !== 200) { trySaveMeta({ ...meta, lastError: `HTTP ${status}` }, s); return 'error'; }
    trySaveMeta({ ...meta, lastOk: Date.now(), lastError: undefined }, s);
    return 'ok';
  } catch (e: any) {
    if (!still()) return 'not_linked';
    const aborted = e?.name === 'AbortError';
    trySaveMeta({ ...meta, lastError: aborted ? 'Нет ответа сервера' : 'Нет связи с кабинетом' }, s);
    return 'error';
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Запустить периодический пульс (идемпотентно). */
export function startHeartbeat(intervalMs = HEARTBEAT_MS): () => void {
  if (!timer) {
    void sendHeartbeat().catch(() => undefined);
    timer = setInterval(() => { void sendHeartbeat().catch(() => undefined); }, intervalMs);
  }
  return () => { if (timer) clearInterval(timer); timer = null; };
}
