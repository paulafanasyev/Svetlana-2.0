// Мост к приложению для Windows (Tauri). В настольной версии API-ключи облачных ИИ хранятся в
// Диспетчере учётных данных Windows и никогда не попадают в JavaScript: запрос к облаку выполняет
// нативная часть (src-tauri/src/secure_ai.rs) и сама подставляет ключ. Даже если на странице окажется
// чужой скрипт, прочитать ключ ему неоткуда — у фронтенда нет команды «выдать ключ».
import { safeJsonParse } from './SafeData';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** То, что видит интерфейс вместо ключа в настольной версии. */
export const NATIVE_KEY_PLACEHOLDER = '•••• хранится в Windows';

function invoker(): Invoke | null {
  const inv = (globalThis as any).__TAURI_INTERNALS__?.invoke;
  return typeof inv === 'function' ? (inv as Invoke) : null;
}

/** true — запущено как приложение для Windows (есть нативная часть). */
export function isNativeApp(): boolean {
  return invoker() !== null;
}

function need(): Invoke {
  const inv = invoker();
  if (!inv) throw new Error('Доступно только в приложении для Windows');
  return inv;
}

/** Сохранить ключ в хранилище Windows (пустое значение удаляет). */
export async function nativeSetSecret(name: string, value: string | null | undefined): Promise<void> {
  await need()('secret_set', { name, value: value ? value : null });
}

/** Есть ли ключ в хранилище Windows (сам ключ наружу не выдаётся). */
export async function nativeHasSecret(name: string): Promise<boolean> {
  return (await need()('secret_has', { name })) === true;
}

/** Запрос к облачному ИИ через нативную часть: адрес фиксирован, ключ подставляется там же. */
export async function nativeCloudChat(provider: string, model: string, body: Record<string, unknown>): Promise<any> {
  const text = await need()('ai_cloud_chat', { provider, model, body });
  return safeJsonParse(String(text ?? ''), 8 * 1024 * 1024);
}
