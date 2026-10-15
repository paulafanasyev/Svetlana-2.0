// Файлы и полное удаление ключей в приложении для Android.
// В Android WebView ссылка <a download href="blob:…"> ничего не скачивает. Поэтому на телефоне такие клики
// (экспорт CRM, книга доходов, документы, .ics) уходят в нативное окно «Сохранить как» — код страниц
// не меняется и одинаков на сайте, в Windows и в Android.
import { isAndroidApp } from '../platform';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const inv = (): Invoke | null => {
  const f = (globalThis as any).__TAURI_INTERNALS__?.invoke;
  return isAndroidApp() && typeof f === 'function' ? (f as Invoke) : null;
};

export const SAVE_MIMES = ['text/csv', 'application/json', 'text/html', 'text/calendar', 'text/plain'] as const;
export const MAX_SAVE_CHARS = 2_500_000;

/** Сохранить текстовый файл через системное окно телефона. true — сохранён, false — отменено. */
export async function androidSaveFile(name: string, mime: string, text: string): Promise<boolean> {
  const f = inv();
  if (!f) throw new Error('Доступно только в приложении для Android');
  const base = mime.split(';')[0].trim().toLowerCase();
  if (!(SAVE_MIMES as readonly string[]).includes(base)) throw new Error('Этот тип файла нельзя сохранить');
  if (text.length > MAX_SAVE_CHARS) throw new Error('Файл слишком большой');
  return (await f('save_file', { name: String(name).slice(0, 100), mime: base, text })) === true;
}

/** Удалить все ключи ИИ и сам ключ шифрования в Android Keystore (одно нативное подтверждение). */
export async function androidWipeSecrets(): Promise<number> {
  const f = inv();
  if (!f) return 0;
  const n = await f('secret_wipe_all');
  return typeof n === 'number' ? n : 0;
}

let installed = false;

/**
 * Телефон: перехватываем программное «скачивание» blob-ссылок и сохраняем через системное окно.
 * В браузере и Windows ничего не меняет. Идемпотентно.
 */
export function installAndroidDownloads(): void {
  if (installed || !isAndroidApp() || typeof URL === 'undefined' || typeof HTMLAnchorElement === 'undefined') return;
  installed = true;
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
    void blob.text()
      .then(text => androidSaveFile(name, blob.type || 'text/plain', text))
      .catch(e => { try { window.alert(String((e as any)?.message ?? e)); } catch { /* noop */ } });
  };
}
