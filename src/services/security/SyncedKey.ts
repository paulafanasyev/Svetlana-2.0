// Одна запись хранилища на несколько окон приложения (две вкладки сайта, сайт и приложение в одном профиле).
// Хранилища CRM и «Бизнеса» пишут запись целиком, поэтому без проверки второе окно со старой копией
// молча стирало бы то, что добавили в первом. Два способа защиты:
// 1) окно узнаёт о чужой записи по событию storage и сразу берёт свежие данные (onOtherTabWrite);
// 2) перед записью хранилище сверяет, что запись на диске та же, что оно читало или писало само (readRaw).
//    Если нет, изменение отменяется, свежие данные подхватываются, а человек видит просьбу повторить.
import type { KeyValueStorage } from '../crm/CRMStore';

/** Текущая запись на диске. undefined — прочитать нельзя (тогда проверка пропускается). */
export function readRaw(s: KeyValueStorage, key: string): string | null | undefined {
  try { return s.getItem(key); } catch { return undefined; }
}

/** Запись изменилась не нами: то, что на диске, не совпадает с тем, что мы читали или писали последними. */
export function changedElsewhere(disk: string | null | undefined, last: string | null | undefined): boolean {
  return disk !== undefined && last !== undefined && disk !== last;
}

/**
 * Другое окно записало ключ в localStorage: вызвать cb с новым значением (null — ключ удалён или всё очищено).
 * Работает только для настоящего localStorage (в тестах и в памяти событий нет). Возвращает отписку.
 */
export function onOtherTabWrite(s: KeyValueStorage, key: string, cb: (raw: string | null) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined;
  let ls: Storage | undefined;
  try { ls = typeof localStorage !== 'undefined' ? localStorage : undefined; } catch { ls = undefined; }
  if (!ls || (s as unknown) !== ls) return () => undefined;
  const h = (e: StorageEvent) => {
    if (e.storageArea !== ls) return;
    if (e.key === key) cb(e.newValue);
    else if (e.key === null) cb(null);
  };
  window.addEventListener('storage', h);
  return () => window.removeEventListener('storage', h);
}
