// Real AI Gateway - connects to actual LLM providers
// Defaults to local offline provider (Ollama / Local Svetlana) on Windows/Desktop
// Безопасность: API-ключи хранятся зашифрованными (SecretStore), в localStorage — только настройки без ключей.
// В приложении для Windows ключи облачных ИИ лежат в Диспетчере учётных данных Windows и вообще не
// попадают в JavaScript: запрос в облако делает нативная часть (security/NativeBridge, src-tauri/src/secure_ai.rs).
// В приложении для Android то же самое делает SecureAi.kt (Android Keystore). В обоих приложениях облако —
// ТОЛЬКО через нативную часть (сторонний прокси не используется): окно подтверждения не обойти.
// GigaChat (Сбер, бесплатный тариф) — только в приложениях: его сервер подписан сертификатом Минцифры и не отвечает
// браузеру (CORS), поэтому вход по ключу авторизации и запрос делает нативная часть (secure_ai.rs / SecureAi.kt).
// AnyModel (anymodel.org) и OpenCode Zen (opencode.ai/zen) — шлюзы ко многим моделям с одним ключом,
// OpenAI-совместимый /chat/completions на фиксированном официальном адресе (сайт, Windows и Android).
// Локальные модели (Ollama, LM Studio и др.): на компьютере и сайте — только 127.0.0.1/localhost; в приложении
// для Android — ещё и компьютер в домашней сети (10.x, 172.16–31.x, 192.168.x): запрос делает телефон
// (команда lan_http, первая отправка на новый адрес — после нативного подтверждения, см. AndroidFiles).
// Облачные — только официальные адреса (список для КАЖДОГО сервиса, неизвестный облачный сервис отклоняется),
// прокси — только свой сервер. Подменённый адрес не получит ни ключ, ни переписку.
// Исключение — «Свой ИИ» (id 'custom', только приложение для Android): любой OpenAI-совместимый сервер по https.
// Его адрес хранится вместе с ключом в Android Keystore и меняется только через нативное окно с адресом
// целиком (SecureAi.kt): страница не может незаметно увести ключ или переписку на другой сервер.
// Локальная модель при ошибке НИКОГДА не переключается на облако сама: переписка не покидает
// домашнюю сеть без явного выбора облачного провайдера пользователем (см. fallbackCandidates).
// Вызовы инструментов от модели проходят строгую проверку по схеме инструмента (security/ToolCallSchema).
// «★ Светлана Сервер» (id 'svetlana') — единая Светлана на мир-самозанятых.рф в полном режиме (см. SvetlanaCore).
// Запись ключа асинхронна (в Windows — после окна подтверждения): addProvider/updateProvider/removeProvider возвращают
// промис, и проверку соединения нужно делать только после него. Если ключ не сохранён («Отмена»),
// addProvider и updateProvider откатываются: прежние настройки и активный выбор возвращаются.
// Пустой или странный ответ модели — понятная ошибка (textOrFail), а не пустая реплика Светланы и не TypeError.
// Каждый запрос из браузера ограничен по времени (fetchAi, 2 минуты), а текст ошибки сервиса проходит через scrubApiError:
// сам ключ и похожие на ключ строки вырезаются (как ErrorText.kt и scrub_error в приложениях), длина ограничена.
import { getSecret, setSecret } from './security/SecretStore';
import { safeJsonParse, stripControl, MAX_BYTES } from './security/SafeData';
import { isNativeApp, nativeSetSecret, nativeHasSecret, nativeCloudChat, NATIVE_KEY_PLACEHOLDER } from './security/NativeBridge';
import { stripUntrusted } from './security/Untrusted';
import { validateToolCalls } from './security/ToolCallSchema';
import { SVETLANA_CORE_ORIGIN, SVETLANA_CORE_MODEL, toSvetlanaCoreBody, contentOf, callSvetlanaCoreWeb } from './SvetlanaCore';
import { isAndroidApp } from '../platform';

export interface AIProvider {
  id: string;
  name: string;
  type: 'online' | 'offline';
  endpoint: string;
  apiKey?: string;
  model: string;
  enabled: boolean;
  useProxy?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  provider: string;
  model: string;
  toolCalls?: StructuredToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StructuredToolCall {
  tool: string;
  arguments: Record<string, any>;
  requestId: string;
  timestamp: number;
}

const DEFAULT_OFFLINE_PROVIDERS: AIProvider[] = [
  {
    id: 'ollama',
    name: '★ Светлана Локальная (Ollama / Offline)',
    type: 'offline',
    endpoint: 'http://127.0.0.1:11434',
    model: 'svetlana:latest',
    enabled: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Локальный сервер)',
    type: 'offline',
    endpoint: 'http://127.0.0.1:1234',
    model: 'default',
    enabled: false,
  },
];

/** GigaChat работает только в приложениях (нативная часть): браузер к нему не подключится. */
export const GIGACHAT_WEB_ONLY = 'GigaChat работает в приложениях Светланы для Windows и Android. На сайте браузер не может к нему подключиться: выберите другой ИИ или откройте приложение.';

/** Сколько ждать ответа ИИ из браузера (локальные модели на слабом ПК думают долго). */
export const AI_TIMEOUT_MS = 120_000;
export const AI_TIMEOUT_TEXT = 'ИИ не ответил за 2 минуты. Проверьте интернет и попробуйте ещё раз или выберите другой ИИ.';

/** fetch с ограничением времени: зависший сервер не оставляет чат в вечном «Думаю…». */
export async function fetchAi(url: string, init: RequestInit, ms = AI_TIMEOUT_MS, f: typeof fetch = fetch): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(AI_TIMEOUT_TEXT);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const HIDDEN_KEY = '[ключ скрыт]';
const KEY_LIKE = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}|[A-Za-z0-9_-]{40,})\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const INVISIBLE = /[-\u001F\u007F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * Текст ошибки облачного сервиса для экрана и журнала: без самого ключа (любой длины), без похожих на ключ
 * строк, без управляющих и невидимых символов, не длиннее 300 знаков.
 */
export function scrubApiError(raw: unknown, secrets: Array<string | undefined | null> = []): string {
  let t = typeof raw === 'string' ? raw : raw == null ? '' : (() => { try { return JSON.stringify(raw); } catch { return String(raw); } })();
  for (const s of secrets) if (s && s.length >= 3 && s !== NATIVE_KEY_PLACEHOLDER) t = t.split(s).join(HIDDEN_KEY);
  t = t.replace(INVISIBLE, ' ').replace(BEARER, `$1 ${HIDDEN_KEY}`).replace(KEY_LIKE, HIDDEN_KEY);
  return t.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** «Сервис ответил ошибкой» без секретов: код + очищенное сообщение сервиса. */
async function apiError(label: string, response: Response, key?: string): Promise<Error> {
  const body: any = await response.json().catch(() => ({}));
  const msg = body?.error?.message ?? body?.message ?? (typeof body?.error === 'string' ? body.error : '') ?? '';
  const clean = scrubApiError(msg || response.statusText, [key]);
  return new Error(`${label} API error: ${response.status}${clean ? ` ${clean}` : ''}`);
}

/** В журнал — только очищенный текст ошибки, без самого объекта (в нём может быть ключ). */
const logText = (e: unknown): string => scrubApiError((e as { message?: unknown } | null)?.message ?? e);

/** «Ключ авторизации» GigaChat из Studio: без слова Basic, пробелов и переносов (их часто копируют вместе с ключом). */
export function normalizeGigachatKey(k: string): string {
  return String(k ?? '').trim().replace(/^Basic\s+/i, '').replace(/\s+/g, '');
}

/** Температура для GigaChat: он не принимает 0, диапазон 0.1–2. */
export function gigachatTemperature(t: unknown): number {
  const n = typeof t === 'number' && Number.isFinite(t) ? t : 0.7;
  return Math.min(2, Math.max(0.1, n));
}

/** Текст ответа модели или понятная ошибка: пустой или странный ответ не выдаётся за ответ Светланы. */
export function textOrFail(label: string, v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${label}: модель вернула пустой ответ. Попробуйте ещё раз или выберите другую модель.`);
  }
  return v;
}

/** «Свой ИИ»: любой OpenAI-совместимый сервер по https. Пока только в приложении для Android (SecureAi.kt). */
export const CUSTOM_AI_ID = 'custom';
export const CUSTOM_AI_ANDROID_ONLY = 'Свой ИИ пока подключается только в приложении для Android.';
export const CUSTOM_AI_BAD_URL = 'Свой ИИ: нужен адрес вида https://api.example.com/v1 (только https, без логина и параметров)';
export const CUSTOM_AI_REENTER_KEY = 'Адрес своего ИИ изменился: введите ключ ещё раз (или очистите поле, если сервер работает без ключа).';
const CUSTOM_HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CUSTOM_PATH_RE = /^(\/[A-Za-z0-9._~-]+)*$/;

/** Адрес своего ИИ: https, имя хоста, путь до /chat/completions (сам хвост отрезается). Как customEndpoint в SecureAi.kt. */
export function normalizeCustomEndpoint(raw: string): string {
  let s = String(raw ?? '').trim().replace(/\/+$/, '');
  s = s.replace(/\/chat\/completions$/i, '');
  const m = /^https:\/\/([^/:?#@\s]+)(?::(\d{1,5}))?(\/[^?#\s]*)?$/i.exec(s);
  if (!m || s.length > 200) throw new Error(CUSTOM_AI_BAD_URL);
  const host = m[1].toLowerCase();
  const port = m[2] ? Number(m[2]) : null;
  const path = m[3] ?? '';
  if (!CUSTOM_HOST_RE.test(host) || (port !== null && (port < 1 || port > 65535)) || !CUSTOM_PATH_RE.test(path)) {
    throw new Error(CUSTOM_AI_BAD_URL);
  }
  return `https://${host}${port !== null ? `:${port}` : ''}${path}`;
}

/** Официальные адреса КАЖДОГО облачного сервиса. Другие адреса и неизвестные сервисы отклоняются. */
const OFFICIAL_ENDPOINTS: Record<string, string[]> = {
  openai: ['https://api.openai.com/v1'],
  anthropic: ['https://api.anthropic.com/v1'],
  groq: ['https://api.groq.com/openai/v1'],
  openrouter: ['https://openrouter.ai/api/v1'],
  deepseek: ['https://api.deepseek.com/v1', 'https://api.deepseek.com'],
  mistral: ['https://api.mistral.ai/v1'],
  google: ['https://generativelanguage.googleapis.com/v1beta', 'https://generativelanguage.googleapis.com/v1'],
  svetlana: [SVETLANA_CORE_ORIGIN],
  gigachat: ['https://api.giga.chat/v1'],
  anymodel: ['https://anymodel.org/v1'],
  opencode: ['https://opencode.ai/zen/v1'],
};
/** Шлюзы с OpenAI-совместимым /chat/completions (как ANYMODEL_CHAT/OPENCODE_CHAT в secure_ai.rs и SecureAi.kt). */
export const GATEWAY_CHAT_URLS: Record<string, { url: string; label: string }> = {
  anymodel: { url: 'https://anymodel.org/v1/chat/completions', label: 'AnyModel' },
  opencode: { url: 'https://opencode.ai/zen/v1/chat/completions', label: 'OpenCode Zen' },
};
const LOCAL_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/;
/** Телефон: ещё и компьютер в домашней сети (только IP, без имён). */
const LAN_RE = /^http:\/\/(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/;

/** Все части IP-адреса не больше 255. */
const octetsOk = (e: string) => (/^http:\/\/(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(e)?.slice(1) ?? []).every(n => Number(n) <= 255);

/** Проверка адреса провайдера. Возвращает нормализованный адрес или бросает ошибку. */
export function validateEndpoint(p: Pick<AIProvider, 'id' | 'type' | 'endpoint'>): string {
  const e = String(p.endpoint ?? '').trim().replace(/\/+$/, '');
  if (p.id === CUSTOM_AI_ID) {
    if (p.type !== 'online') throw new Error(CUSTOM_AI_BAD_URL);
    if (!isAndroidApp()) throw new Error(CUSTOM_AI_ANDROID_ONLY);
    return normalizeCustomEndpoint(e);
  }
  if (p.type === 'offline') {
    if (isAndroidApp()) {
      if (!LAN_RE.test(e) || !octetsOk(e)) throw new Error('Локальная модель: адрес компьютера в домашней сети, например http://192.168.1.10:11434 (или http://127.0.0.1:порт, если модель запущена на самом телефоне)');
      return e;
    }
    if (!LOCAL_RE.test(e)) throw new Error('Локальная модель должна работать на этом компьютере: адрес http://127.0.0.1:порт или http://localhost:порт');
    return e;
  }
  const official = OFFICIAL_ENDPOINTS[p.id];
  if (!official) throw new Error(`Облачный сервис «${p.id}» не поддерживается`);
  if (!official.includes(e)) throw new Error(`Для ${p.id} разрешён только официальный адрес: ${official[0]}`);
  return e;
}

/** Прокси: только свой сервер (путь вида /api/...) или локальный адрес. */
export function validateProxyUrl(url: string): string {
  const u = url.trim();
  if (/^\/[A-Za-z0-9/_-]*$/.test(u) && !u.startsWith('//')) return u;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/[A-Za-z0-9/_-]*)?$/.test(u)) return u;
  throw new Error('Прокси может быть только на своём сервере (/api/...) или на этом компьютере');
}

const FALLBACK_ORDER = ['ollama', 'lmstudio', 'svetlana', 'groq', 'openai', 'anthropic', 'deepseek', 'gigachat', 'anymodel', 'opencode'];

/**
 * Запасные провайдеры при ошибке [failed]. Только включённые и только ТОГО ЖЕ типа:
 * локальная модель → только другая локальная (переписка не уходит в интернет),
 * облачная → другая облачная, которую пользователь сам включил.
 */
export function fallbackCandidates(all: AIProvider[], failed: Pick<AIProvider, 'id' | 'type'>): AIProvider[] {
  const byId = new Map(all.map(p => [p.id, p] as const));
  return FALLBACK_ORDER
    .map(id => byId.get(id))
    .filter((p): p is AIProvider => !!p && p.enabled && p.id !== failed.id && p.type === failed.type);
}

const secretName = (id: string) => `ai.${id}`;

/** Ключ из настроек: для GigaChat — чистый «Ключ авторизации» (отметку «ключ в хранилище» не трогаем). */
function keyOf(id: string, v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const k = id === 'gigachat' && v !== NATIVE_KEY_PLACEHOLDER ? normalizeGigachatKey(v) : v;
  return k ? k.slice(0, 500) : undefined;
}

function sanitizeProvider(v: unknown): AIProvider | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(r.id)) return null;
  const type = r.type === 'online' ? 'online' : 'offline';
  try {
    const endpoint = validateEndpoint({ id: r.id, type, endpoint: String(r.endpoint ?? '') });
    return {
      id: r.id, type, endpoint,
      name: stripControl(String(r.name ?? r.id)).slice(0, 100),
      // У единой Светланы одна «модель» — профиль полного режима.
      model: r.id === 'svetlana' ? SVETLANA_CORE_MODEL : stripControl(String(r.model ?? '')).slice(0, 100),
      enabled: r.enabled === true,
      useProxy: r.useProxy === true ? true : undefined,
      apiKey: keyOf(r.id, r.apiKey),
    };
  } catch { return null; }
}

class AIGateway {
  private providers: Map<string, AIProvider> = new Map();
  private activeProvider: string | null = null;
  private proxyUrl: string | null = null;
  /** Ключи расшифровываются асинхронно при старте; запросы к ИИ ждут этого. */
  readonly ready: Promise<void>;

  constructor() {
    this.initDefaultProviders();
    this.ready = this.loadFromStorage();
  }

  private initDefaultProviders() {
    for (const p of DEFAULT_OFFLINE_PROVIDERS) {
      this.providers.set(p.id, { ...p });
    }
    // На телефоне локальная модель по умолчанию не выбирается: сначала нужен адрес компьютера.
    this.activeProvider = isAndroidApp() ? null : 'ollama';
  }

  setProxyUrl(url: string | null) {
    this.proxyUrl = url ? validateProxyUrl(url) : null;
    if (this.proxyUrl) {
      sessionStorage.setItem('svetlana_ai_proxy', this.proxyUrl);
    } else {
      sessionStorage.removeItem('svetlana_ai_proxy');
    }
  }

  getProxyUrl(): string | null {
    if (this.proxyUrl) return this.proxyUrl;
    try {
      const s = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('svetlana_ai_proxy') : null;
      return s ? validateProxyUrl(s) : null;
    } catch { return null; }
  }

  private async loadFromStorage(): Promise<void> {
    // В приватном режиме доступ к хранилищу может бросить ошибку: тогда работаем с настройками по умолчанию,
    // а не роняем ready (иначе любой запрос к ИИ падал бы с непонятной ошибкой).
    let stored: string | null = null;
    try {
      if (typeof localStorage === 'undefined') return;
      stored = localStorage.getItem('svetlana_ai_providers');
    } catch (e) {
      console.error('Хранилище настроек недоступно, ИИ работает с настройками по умолчанию:', logText(e));
    }
    if (stored) {
      try {
        const data = safeJsonParse(stored, MAX_BYTES.storage);
        let migrated = false;
        if (Array.isArray(data)) {
          for (const raw of data.slice(0, 50)) {
            const p = sanitizeProvider(raw);
            if (!p) continue;
            if (p.apiKey) { await setSecret(secretName(p.id), p.apiKey); migrated = true; } // старый открытый ключ → шифрование
            this.providers.set(p.id, p);
          }
        }
        const savedActive = localStorage.getItem('svetlana_active_provider');
        if (savedActive && this.providers.has(savedActive)) {
          this.activeProvider = savedActive;
        }
        if (migrated) this.saveToStorage();
      } catch (e) {
        console.error('Failed to load AI providers:', logText(e));
      }
    }
    const native = isNativeApp();
    for (const p of this.providers.values()) {
      if (native) {
        // Приложение (Windows или Android): ключ переносим в хранилище системы и стираем из браузерного хранилища;
        // в памяти JavaScript остаётся только отметка «ключ есть».
        // У своего ИИ в хранилище лежит пара «адрес + ключ»: старый одиночный ключ туда не переносим.
        const name = secretName(p.id);
        const legacy = p.id === CUSTOM_AI_ID ? null : p.apiKey && p.apiKey !== NATIVE_KEY_PLACEHOLDER ? p.apiKey : await getSecret(name);
        if (legacy) {
          try { await nativeSetSecret(name, legacy); await setSecret(name, null); } catch (e) { console.error('Не удалось перенести ключ в хранилище приложения', logText(e)); }
        }
        p.apiKey = undefined;
        try { if (await nativeHasSecret(name)) p.apiKey = NATIVE_KEY_PLACEHOLDER; } catch { /* нет хранилища */ }
        continue;
      }
      if (!p.apiKey) { const k = await getSecret(secretName(p.id)); if (k) p.apiKey = k; }
    }
  }

  private saveToStorage() {
    // Ключи в localStorage не пишем никогда.
    const data = Array.from(this.providers.values()).map(({ apiKey: _k, ...rest }) => rest);
    try {
      localStorage.setItem('svetlana_ai_providers', JSON.stringify(data));
      if (this.activeProvider) {
        localStorage.setItem('svetlana_active_provider', this.activeProvider);
      }
    } catch (e) {
      // Нет места или хранилище недоступно: настройки действуют до перезапуска, работа не прерывается.
      console.error('Не удалось сохранить настройки ИИ:', logText(e));
    }
  }

  /** Записать ключ провайдера. Промис завершается, когда ключ реально записан (или с ошибкой). */
  private storeKey(p: AIProvider): Promise<void> {
    const name = secretName(p.id);
    if (isNativeApp()) {
      // Отметка «ключ есть» из интерфейса никогда не перезаписывает настоящий ключ.
      if (p.apiKey === NATIVE_KEY_PLACEHOLDER) return Promise.resolve();
      // Свой ИИ: адрес уходит в хранилище вместе с ключом (ключ может быть пустым), телефон покажет адрес в окне.
      const value = p.id === CUSTOM_AI_ID
        ? JSON.stringify({ endpoint: p.endpoint, key: p.apiKey ?? '' })
        : p.apiKey ?? null;
      p.apiKey = value ? NATIVE_KEY_PLACEHOLDER : undefined;
      // Браузерную копию стираем фоном; её ошибка не должна становиться необработанным промисом.
      void Promise.resolve(setSecret(name, null)).catch(() => undefined);
      return nativeSetSecret(name, value).catch(async (e) => {
        console.error('Не удалось сохранить ключ в хранилище приложения', logText(e));
        // Отметка должна совпадать с хранилищем (например, пользователь нажал «Отмена» в окне подтверждения).
        try { p.apiKey = (await nativeHasSecret(name)) ? NATIVE_KEY_PLACEHOLDER : undefined; } catch { p.apiKey = undefined; }
        throw e;
      });
    }
    return Promise.resolve(setSecret(name, p.apiKey ?? null)).then(() => undefined);
  }

  /** Свой ИИ: сменить адрес без ключа нельзя — иначе старый ключ ушёл бы на новый сервер (или адрес в интерфейсе разошёлся бы с хранилищем). */
  private guardCustomEndpoint(before: AIProvider | undefined, next: AIProvider) {
    if (next.id === CUSTOM_AI_ID && before && before.endpoint !== next.endpoint && next.apiKey === NATIVE_KEY_PLACEHOLDER) {
      throw new Error(CUSTOM_AI_REENTER_KEY);
    }
  }

  /**
   * Добавить провайдера. Дождитесь промиса перед проверкой соединения: ключ записывается асинхронно.
   * Если ключ не сохранён — откат: новый провайдер удаляется, у существующего возвращаются прежние
   * настройки (отметка ключа — по факту хранилища), активным снова становится прежний.
   */
  addProvider(provider: AIProvider): Promise<void> {
    // Понятная ошибка адреса своего ИИ (вместо общей «некорректные настройки»).
    if (provider?.id === CUSTOM_AI_ID) validateEndpoint(provider);
    const p = sanitizeProvider(provider);
    if (!p) throw new Error('Некорректные настройки провайдера (адрес или идентификатор)');
    const before = this.providers.get(p.id);
    this.guardCustomEndpoint(before, p);
    const prev = before ? { ...before } : undefined;
    const prevActive = this.activeProvider;
    this.providers.set(p.id, p);
    if (p.enabled) {
      this.activeProvider = p.id;
    }
    const saved = this.storeKey(p);
    this.saveToStorage();
    return saved.catch((e: unknown) => {
      if (prev) this.providers.set(p.id, { ...prev, apiKey: p.apiKey });
      else this.providers.delete(p.id);
      this.activeProvider = prevActive && this.providers.has(prevActive) ? prevActive : null;
      this.saveToStorage();
      throw e;
    });
  }

  removeProvider(id: string): Promise<void> {
    this.providers.delete(id);
    const jobs: Promise<unknown>[] = [Promise.resolve(setSecret(secretName(id), null))];
    if (isNativeApp()) jobs.push(nativeSetSecret(secretName(id), null));
    if (this.activeProvider === id) {
      this.activeProvider = null;
      for (const [pid, p] of this.providers) {
        if (p.enabled) {
          this.activeProvider = pid;
          break;
        }
      }
    }
    this.saveToStorage();
    return Promise.all(jobs).then(() => undefined);
  }

  /**
   * Изменить провайдера. Если новый ключ не сохранён («Отмена» или ошибка хранилища) — откат как в addProvider:
   * прежние настройки и активный выбор возвращаются, иначе старый ключ ушёл бы с новой моделью или адресом.
   */
  updateProvider(id: string, updates: Partial<AIProvider>): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) return Promise.resolve();
    const next = sanitizeProvider({ ...provider, ...updates, id });
    if (!next) throw new Error('Некорректные настройки провайдера (адрес)');
    this.guardCustomEndpoint(provider, next);
    const prev = { ...provider };
    const prevActive = this.activeProvider;
    Object.assign(provider, next);
    if (updates.enabled) {
      this.activeProvider = id;
    }
    // У своего ИИ адрес лежит в хранилище вместе с ключом: новый адрес записывается туда же.
    const saved = 'apiKey' in updates ? this.storeKey(provider) : Promise.resolve();
    this.saveToStorage();
    return saved.catch((e: unknown) => {
      // В приложении отметка ключа уже сверена с хранилищем (storeKey), на сайте возвращается прежний ключ.
      Object.assign(provider, prev, { apiKey: isNativeApp() ? provider.apiKey : prev.apiKey });
      this.activeProvider = prevActive;
      this.saveToStorage();
      throw e;
    });
  }

  getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  getActiveProvider(): AIProvider | undefined {
    return this.activeProvider ? this.providers.get(this.activeProvider) : undefined;
  }

  setActiveProvider(id: string) {
    const provider = this.providers.get(id);
    if (provider && provider.enabled) {
      this.activeProvider = id;
      this.saveToStorage();
    }
  }

  async chat(messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }, providerId?: string): Promise<AIResponse> {
    await this.ready;
    const provider = providerId ? this.providers.get(providerId) : this.getActiveProvider();
    if (!provider) {
      throw new Error('ИИ не настроен: откройте «Настройка» или «Модели ИИ»');
    }

    try {
      return await this.callProvider(provider, messages, options);
    } catch (error: any) {
      if (!providerId && this.providers.size > 1) {
        // Только тот же тип: локальная модель не отправляет переписку в облако молча.
        const fallbackProviders = fallbackCandidates(this.getAllProviders(), provider);
        for (const fallback of fallbackProviders) {
          try {
            console.warn(`Provider ${provider.name} failed, trying fallback: ${fallback.name}`);
            return await this.callProvider(fallback, messages, options);
          } catch (fallbackError) {
            console.error(`Fallback ${fallback.name} also failed:`, logText(fallbackError));
            continue;
          }
        }
      }
      throw error;
    }
  }

  private async callProvider(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    // Повторная проверка адреса перед каждым запросом: объект провайдера мог быть изменён в обход updateProvider.
    validateEndpoint(provider);
    // Единая Светлана: всегда напрямую на свой сервер (без стороннего прокси), в приложениях — через нативную часть.
    if (provider.id === 'svetlana') {
      return isNativeApp() ? this.callNative(provider, messages, options) : this.callSvetlanaCore(provider, messages);
    }
    // Приложения (Windows и Android): облачный запрос делает нативная часть, ключ в JavaScript не попадает.
    // Прокси в приложениях не используется: иначе переписка ушла бы мимо окна подтверждения.
    // Свой ИИ — тоже только так: адрес берётся из хранилища телефона, а не со страницы.
    if (provider.type === 'online' && isNativeApp()) {
      return this.callNative(provider, messages, options);
    }
    if (provider.id === CUSTOM_AI_ID) {
      throw new Error(CUSTOM_AI_ANDROID_ONLY);
    }
    // GigaChat — только через нативную часть приложения (ключ не уходит ни в прокси, ни в браузерный запрос).
    if (provider.id === 'gigachat') {
      throw new Error(GIGACHAT_WEB_ONLY);
    }
    const proxy = this.getProxyUrl();
    if ((proxy || provider.useProxy) && provider.type === 'online') {
      return this.callViaProxy(proxy || '/api/ai-proxy', provider, messages, options);
    }

    const gateway = GATEWAY_CHAT_URLS[provider.id];
    if (gateway && provider.type === 'online') {
      return this.callOpenAICompatible(gateway.url, gateway.label, provider, messages, options);
    }

    switch (provider.id) {
      case 'ollama':
        return this.callOllama(provider, messages, options);
      case 'lmstudio':
        return this.callLMStudio(provider, messages, options);
      case 'openai':
        return this.callOpenAI(provider, messages, options);
      case 'anthropic':
        return this.callAnthropic(provider, messages, options);
      case 'google':
        return this.callGoogle(provider, messages, options);
      case 'mistral':
        return this.callMistral(provider, messages, options);
      case 'groq':
        return this.callGroq(provider, messages, options);
      case 'openrouter':
        return this.callOpenRouter(provider, messages, options);
      case 'deepseek':
        return this.callDeepSeek(provider, messages, options);
      default:
        // Generic offline fallback
        if (provider.type === 'offline') {
          return this.callOllama(provider, messages, options);
        }
        throw new Error(`Облачный сервис «${provider.id}» не поддерживается`);
    }
  }

  /** Единая Светлана из веб-версии (в приложениях — callNative). */
  private async callSvetlanaCore(provider: AIProvider, messages: ChatMessage[]): Promise<AIResponse> {
    const content = await callSvetlanaCoreWeb(provider.apiKey || '', toSvetlanaCoreBody(messages));
    return { content, provider: provider.name, model: provider.model };
  }

  /** Облачный запрос через нативную часть приложения (без ключа в теле запроса). */
  private async callNative(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const temperature = options?.temperature ?? 0.7;
    let body: Record<string, unknown>;
    if (provider.id === 'svetlana') {
      body = { ...toSvetlanaCoreBody(messages) };
    } else if (provider.id === 'anthropic') {
      body = { model: provider.model, max_tokens: options?.max_tokens ?? 4096, system: systemMessage?.content, messages: chatMessages, temperature };
    } else if (provider.id === 'google') {
      body = {
        contents: chatMessages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
        generationConfig: { temperature, maxOutputTokens: options?.max_tokens },
      };
    } else if (provider.id === 'gigachat') {
      body = { model: provider.model, messages, temperature: gigachatTemperature(temperature), max_tokens: options?.max_tokens ?? 4096 };
    } else {
      body = { model: provider.model, messages, temperature, max_tokens: options?.max_tokens ?? 4096 };
    }
    const data: any = await nativeCloudChat(provider.id, provider.model, body);
    if (provider.id === 'svetlana') {
      return { content: contentOf(data), provider: provider.name, model: provider.model };
    }
    const content = provider.id === 'anthropic' ? data?.content?.[0]?.text
      : provider.id === 'google' ? data?.candidates?.[0]?.content?.parts?.[0]?.text
      : data?.choices?.[0]?.message?.content;
    // Пустая строка — тоже ошибка, а не «успешный» пустой ответ Светланы.
    return { content: textOrFail(provider.name, content), provider: provider.name, model: provider.model, usage: provider.id === 'google' ? undefined : data?.usage };
  }

  private async callViaProxy(proxyEndpoint: string, provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetchAi(validateProxyUrl(proxyEndpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: provider.id,
        model: provider.model,
        messages,
        options,
      }),
    });

    if (!response.ok) throw await apiError('AI Proxy', response, provider.apiKey);

    // Ответ прокси проверяем так же, как ответ модели: странный JSON не выдаётся за ответ Светланы.
    const data: any = await response.json().catch(() => null);
    return {
      content: textOrFail('AI Proxy', data?.content),
      provider: typeof data?.provider === 'string' ? data.provider.slice(0, 100) : provider.name,
      model: typeof data?.model === 'string' ? data.model.slice(0, 100) : provider.model,
      usage: data?.usage && typeof data.usage === 'object' ? data.usage : undefined,
    };
  }

  private async callOllama(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    let response: Response;
    try {
      response = await fetchAi(`${provider.endpoint}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.7,
          },
        }),
      });
    } catch (e: any) {
      if (e?.message === AI_TIMEOUT_TEXT) throw e;
      const why = typeof e?.message === 'string' && /Отменено пользователем/.test(e.message) ? ' В окне телефона нажата «Отмена».' : '';
      throw new Error(isAndroidApp()
        ? `Ollama не отвечает на ${provider.endpoint}.${why} Проверьте: Ollama запущена на компьютере с OLLAMA_HOST=0.0.0.0, телефон и компьютер в одной Wi‑Fi сети, адрес в «Модели ИИ» верный.`
        : `Ollama не запущена на ${provider.endpoint}. Установите её (ollama.com/download) или выберите другой ИИ в «Настройке».`);
    }

    if (!response.ok) {
      throw new Error(response.status === 404
        ? `В Ollama нет модели ${provider.model}. Скачайте её (ollama pull ${provider.model}) или выберите другую в «Настройке».`
        : `Локальный сервер Ollama ответил ошибкой ${response.status} на ${provider.endpoint}.`);
    }

    const data = await response.json();
    return {
      content: textOrFail('Ollama', data?.message?.content),
      provider: provider.name,
      model: provider.model,
    };
  }

  private async callLMStudio(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetchAi(`${provider.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.status} ${scrubApiError(response.statusText)}`);
    }

    const data = await response.json();
    return {
      content: textOrFail('LM Studio', data?.choices?.[0]?.message?.content),
      provider: provider.name,
      model: provider.model,
      usage: data?.usage,
    };
  }

  /** OpenAI-совместимые облачные API с фиксированным официальным адресом. */
  private async callOpenAICompatible(url: string, label: string, provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetchAi(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey || ''}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) throw await apiError(label, response, provider.apiKey);

    const data = await response.json();
    return {
      content: textOrFail(label, data?.choices?.[0]?.message?.content),
      provider: provider.name,
      model: provider.model,
      usage: data?.usage,
    };
  }

  private callOpenAI(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://api.openai.com/v1/chat/completions', 'OpenAI', provider, messages, options);
  }

  private callGroq(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', 'Groq', provider, messages, options);
  }

  private callOpenRouter(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://openrouter.ai/api/v1/chat/completions', 'OpenRouter', provider, messages, options);
  }

  private callDeepSeek(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://api.deepseek.com/v1/chat/completions', 'DeepSeek', provider, messages, options);
  }

  private callMistral(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible(`${validateEndpoint(provider)}/chat/completions`, 'Mistral', provider, messages, options);
  }

  private async callAnthropic(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetchAi('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: options?.max_tokens ?? 4096,
        system: systemMessage?.content,
        messages: chatMessages,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!response.ok) throw await apiError('Anthropic', response, provider.apiKey);

    const data = await response.json();
    return {
      content: textOrFail('Anthropic', data?.content?.[0]?.text),
      provider: provider.name,
      model: provider.model,
      usage: data?.usage,
    };
  }

  private async callGoogle(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    
    const contents = chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Ключ — в заголовке, а не в адресе: адреса попадают в журналы и историю.
    const response = await fetchAi(
      `${validateEndpoint(provider)}/models/${encodeURIComponent(provider.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey || '' },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.max_tokens,
          },
        }),
      }
    );

    if (!response.ok) throw await apiError('Google', response, provider.apiKey);

    const data = await response.json();
    return {
      content: textOrFail('Google', data?.candidates?.[0]?.content?.parts?.[0]?.text),
      provider: provider.name,
      model: provider.model,
      usage: data?.usageMetadata ? {
        prompt_tokens: data.usageMetadata.promptTokenCount,
        completion_tokens: data.usageMetadata.candidatesTokenCount,
        total_tokens: data.usageMetadata.totalTokenCount,
      } : undefined,
    };
  }

  async testConnection(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider) return false;

    try {
      const testMessages: ChatMessage[] = [
        { role: 'user', content: 'Привет! Это проверка связи.' }
      ];
      await this.chat(testMessages, { max_tokens: 50 }, providerId);
      return true;
    } catch (error) {
      console.error(`Connection test failed for ${providerId}:`, logText(error));
      return false;
    }
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: object[],
    options?: { temperature?: number; max_tokens?: number },
    providerId?: string
  ): Promise<AIResponse> {
    await this.ready;
    const provider = providerId ? this.providers.get(providerId) : this.getActiveProvider();
    if (!provider) {
      throw new Error('ИИ не настроен: откройте «Настройка» или «Модели ИИ»');
    }

    const response = await this.chat(messages, options, providerId);
    // Только инструменты из этого запроса и только аргументы, точно совпадающие со схемой.
    const toolCalls = validateToolCalls(this.extractToolCalls(response.content), tools);
    
    return {
      ...response,
      toolCalls,
    };
  }

  private extractToolCalls(content: string): StructuredToolCall[] {
    const toolCalls: StructuredToolCall[] = [];
    // Блоки, скопированные моделью из данных (⟦ДАННЫЕ⟧), не считаются командами.
    const jsonMatches = stripUntrusted(content).match(/```json\s*([\s\S]*?)\s*```/g);
    if (jsonMatches) {
      for (const match of jsonMatches.slice(0, 10)) {
        try {
          const json = safeJsonParse(match.replace(/```json\s*|\s*```/g, ''), 50_000) as { tool?: unknown; arguments?: unknown } | null;
          if (json && typeof json.tool === 'string' && /^[a-z0-9_]{1,60}$/.test(json.tool) && json.arguments && typeof json.arguments === 'object' && !Array.isArray(json.arguments)) {
            toolCalls.push({
              tool: json.tool,
              arguments: json.arguments as Record<string, any>,
              requestId: `tc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              timestamp: Date.now(),
            });
          }
        } catch {}
      }
    }
    return toolCalls;
  }
}

export const aiGateway = new AIGateway();
