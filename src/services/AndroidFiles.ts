// То, чего в Android WebView нет самого по себе, чтобы интерфейс работал как на сайте и в Windows (код страниц один):
// - скачивание файлов (<a download href="blob:…">) → системное окно «Сохранить как»;
// - печать (window.print и печать из iframe) → системное окно печати Android (там же «Сохранить как PDF»);
// - копирование (navigator.clipboard.writeText) → буфер обмена телефона;
// - http-адреса домашней сети (Ollama/LM Studio на компьютере, Svetlana-home) → нативная команда lan_http:
//   страница открыта по https и сама по http ходить не может. Первая отправка данных на новое устройство —
//   только после нативного подтверждения; любые другие адреса идут обычным fetch (и CSP).
// Всё ставится в main.tsx до первого рендера (installAndroidDownloads); в браузере и Windows ничего не меняет.
import { isAndroidApp } from '../platform';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const inv = (): Invoke | null => {
  const f = (globalThis as any).__TAURI_INTERNALS__?.invoke;
  return isAndroidApp() && typeof f === 'function' ? (f as Invoke) : null;
};
const need = (): Invoke => {
  const f = inv();
  if (!f) throw new Error('Доступно только в приложении для Android');
  return f;
};
const errText = (e: unknown): string => (typeof e === 'string' ? e : String((e as { message?: unknown } | null)?.message ?? e ?? 'Ошибка'));

export const SAVE_MIMES = ['text/csv', 'application/json', 'text/html', 'text/calendar', 'text/plain'] as const;
export const MAX_SAVE_CHARS = 2_500_000;
/** Символ UTF-8 — не больше 4 байт: больший blob отклоняем, даже не читая его в память. */
export const MAX_SAVE_BYTES = MAX_SAVE_CHARS * 4;
export const TOO_BIG = 'Файл слишком большой';

/** Сохранить текстовый файл через системное окно телефона. true — сохранён, false — отменено. */
export async function androidSaveFile(name: string, mime: string, text: string): Promise<boolean> {
  const f = need();
  const base = mime.split(';')[0].trim().toLowerCase();
  if (!(SAVE_MIMES as readonly string[]).includes(base)) throw new Error('Этот тип файла нельзя сохранить');
  if (text.length > MAX_SAVE_CHARS) throw new Error(TOO_BIG);
  return (await f('save_file', { name: String(name).slice(0, 100), mime: base, text })) === true;
}

/**
 * Удалить все ключи ИИ и сам ключ шифрования в Android Keystore (одно нативное подтверждение).
 * «Отмена» в окне телефона — ошибка: вызывающий ничего другого удалять не должен.
 */
export async function androidWipeSecrets(): Promise<number> {
  const f = inv();
  if (!f) return 0;
  const n = await f('secret_wipe_all');
  return typeof n === 'number' ? n : 0;
}

/** Печать или PDF через системное окно телефона (документ рисуется без скриптов и сети). */
export async function androidPrintHtml(html: string, title = ''): Promise<void> {
  if (html.length > MAX_SAVE_CHARS) throw new Error(TOO_BIG);
  await need()('print_html', { html, title: String(title).slice(0, 80) });
}

/** Скопировать в буфер обмена телефона. */
export async function androidCopyText(text: string): Promise<void> {
  await need()('clipboard_set', { text: String(text).slice(0, 100_000) });
}

export interface PhoneContact { id: string; name: string; phones: string[] }

/** Контакты этого телефона (разрешение «Контакты» и подтверждение — в нативной части). */
export async function androidListContacts(): Promise<PhoneContact[]> {
  const r = (await need()('contacts_list')) as { contacts?: unknown } | null;
  const list = Array.isArray(r?.contacts) ? r!.contacts as unknown[] : [];
  const out: PhoneContact[] = [];
  for (const raw of list.slice(0, 10_000)) {
    const c = raw as { id?: unknown; name?: unknown; phones?: unknown } | null;
    const name = typeof c?.name === 'string' ? c.name.slice(0, 200) : '';
    if (!name) continue;
    const phones = Array.isArray(c?.phones) ? (c!.phones as unknown[]).filter((p): p is string => typeof p === 'string').map(p => p.slice(0, 40)).slice(0, 10) : [];
    out.push({ id: String(c?.id ?? '').slice(0, 40), name, phones });
  }
  return out;
}

/** http-адрес домашней сети или этого телефона (только IP, без имён): такие запросы делает нативная часть. */
const LAN_URL = /^http:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?(?:[/?]|$)/;
export function isLanUrl(url: string): boolean { return LAN_URL.test(String(url ?? '')); }

const abortError = () => {
  try { return new DOMException('Запрос отменён', 'AbortError'); } catch { const e = new Error('Запрос отменён'); e.name = 'AbortError'; return e; }
};

/**
 * fetch для адресов домашней сети через телефон: GET и POST с текстом (JSON). Ошибки — как у fetch (TypeError),
 * чтобы код страниц («Оллама не запущена…», «Телефон не отвечает…») работал без изменений.
 */
export async function androidLanFetch(url: string, init: RequestInit = {}, invoke: Invoke | null = inv()): Promise<Response> {
  if (!invoke) throw new TypeError('Failed to fetch');
  if (!isLanUrl(url)) throw new TypeError('Failed to fetch');
  const method = String(init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new TypeError(`Failed to fetch: метод ${method} не поддерживается`);
  const body = init.body == null ? '' : typeof init.body === 'string' ? init.body : null;
  if (body === null) throw new TypeError('Failed to fetch: тело запроса должно быть текстом');
  const signal = init.signal ?? null;
  if (signal?.aborted) throw abortError();
  const job = invoke('lan_http', { url, method, body });
  let r: unknown;
  try {
    r = await (signal
      ? Promise.race([job, new Promise<never>((_, rej) => signal.addEventListener('abort', () => rej(abortError()), { once: true }))])
      : job);
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === 'AbortError') throw e;
    throw new TypeError(`Failed to fetch: ${errText(e)}`);
  }
  const o = r as { status?: unknown; body?: unknown } | null;
  const status = typeof o?.status === 'number' && o.status >= 200 && o.status <= 599 ? o.status : 502;
  const text = typeof o?.body === 'string' ? o.body : '';
  const empty = status === 204 || status === 205 || status === 304;
  return new Response(empty ? null : text, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

let installed = false;

/**
 * Телефон: скачивание, печать, копирование и домашняя сеть через нативную часть (см. выше).
 * В браузере и Windows ничего не меняет. Идемпотентно.
 */
export function installAndroidDownloads(): void {
  if (installed || !isAndroidApp() || typeof window === 'undefined' || typeof URL === 'undefined' || typeof HTMLAnchorElement === 'undefined') return;
  installed = true;
  const alertError = (e: unknown) => { try { window.alert(errText(e)); } catch { /* noop */ } };

  // Скачивание blob-ссылок → «Сохранить как».
  const blobs = new Map<string, Blob>();
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = create(obj);
    if (obj instanceof Blob && blobs.size < 20) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = (url: string) => { blobs.delete(url); revoke(url); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const blob = this.download && this.href.startsWith('blob:') ? blobs.get(this.href) : undefined;
    if (!blob) return click.call(this);
    const name = this.download;
    if (blob.size > MAX_SAVE_BYTES) { alertError(TOO_BIG); return; }
    void blob.text()
      .then(text => androidSaveFile(name, blob.type || 'text/plain', text))
      .catch(alertError);
  };

  // Печать: в WebView window.print() ничего не делает. Печатаем тот же документ системным окном.
  const printDoc = (w: Window) => {
    let html = '';
    let title = '';
    try { html = '<!doctype html>' + w.document.documentElement.outerHTML; title = w.document.title; } catch { /* чужой документ */ }
    if (!html) return;
    void androidPrintHtml(html, title).catch(alertError);
  };
  const patchPrint = (w: Window | null) => {
    if (!w) return;
    try {
      if ((w as any).__svetlanaPrint) return;
      Object.defineProperty(w, '__svetlanaPrint', { value: true });
      w.print = () => printDoc(w);
    } catch { /* чужое окно */ }
  };
  patchPrint(window);
  const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  if (desc?.get) {
    const get = desc.get;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      enumerable: desc.enumerable,
      get(this: HTMLIFrameElement) {
        const w = get.call(this) as Window | null;
        patchPrint(w);
        return w;
      },
    });
  }

  // Копирование в буфер обмена телефона (в WebView writeText часто недоступен).
  try {
    const clip = navigator.clipboard as Clipboard | undefined;
    if (clip) Object.defineProperty(clip, 'writeText', { configurable: true, value: (text: string) => androidCopyText(text) });
    else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => androidCopyText(text) } });
  } catch { /* остаётся как есть */ }

  // Домашняя сеть по http: Ollama/LM Studio на компьютере и Svetlana-home.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (isLanUrl(url)) return androidLanFetch(url, init ?? {});
    return nativeFetch(input, init);
  }) as typeof fetch;
}
