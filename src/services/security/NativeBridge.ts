// Мост к нативной части приложения Светланы: Windows (Tauri, src-tauri/src/secure_ai.rs) и Android
// (android-hands, SecureAi.kt — те же команды, те же проверки и лимиты). API-ключи облачных ИИ хранятся в
// Диспетчере учётных данных Windows или в Android Keystore и никогда не попадают в JavaScript: запрос к облаку
// выполняет нативная часть и сама подставляет ключ. Даже если на странице окажется чужой скрипт, прочитать ключ
// ему неоткуда — у фронтенда нет команды «выдать ключ».
// Разрешение на облако привязано к случайному ID разговора, который выдаёт нативная часть (подобрать его нельзя).
import { safeJsonParse } from './SafeData';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** То, что видит интерфейс вместо ключа в приложении (Windows или Android). */
export const NATIVE_KEY_PLACEHOLDER = '•••• хранится на устройстве';

const CONVERSATION_ID_RE = /^[0-9a-f]{32}$/;
let conversationId: string | null = null;

function invoker(): Invoke | null {
  const inv = (globalThis as any).__TAURI_INTERNALS__?.invoke;
  return typeof inv === 'function' ? (inv as Invoke) : null;
}

/** true — запущено как приложение (Windows или Android, есть нативная часть). */
export function isNativeApp(): boolean {
  return invoker() !== null;
}

function need(): Invoke {
  const inv = invoker();
  if (!inv) throw new Error('Доступно только в приложении Светланы для Windows или Android');
  return inv;
}

/** Новый разговор: следующий запрос получит новый ID и, значит, новое подтверждение в нативном окне. */
export function resetNativeConversation(): void {
  conversationId = null;
}

async function currentConversation(inv: Invoke): Promise<string> {
  if (!conversationId) {
    const id = await inv('ai_new_conversation');
    conversationId = typeof id === 'string' && CONVERSATION_ID_RE.test(id) ? id : null;
  }
  return conversationId ?? '';
}

/** Сохранить ключ в защищённое хранилище устройства (пустое значение удаляет). */
export async function nativeSetSecret(name: string, value: string | null | undefined): Promise<void> {
  await need()('secret_set', { name, value: value ? value : null });
}

/** Есть ли ключ в хранилище (сам ключ наружу не выдаётся). */
export async function nativeHasSecret(name: string): Promise<boolean> {
  return (await need()('secret_has', { name })) === true;
}

/** Запрос к облачному ИИ через нативную часть: адрес фиксирован, ключ подставляется там же. */
export async function nativeCloudChat(provider: string, model: string, body: Record<string, unknown>): Promise<any> {
  const inv = need();
  const ask = async () => inv('ai_cloud_chat', { provider, model, conversation: await currentConversation(inv), body });
  let text: unknown;
  try {
    text = await ask();
  } catch (e) {
    // ID устарел (приложение долго открыто) — просим новый один раз.
    if (!String((e as any)?.message ?? e).includes('CONVERSATION_UNKNOWN')) throw e;
    conversationId = null;
    text = await ask();
  }
  return safeJsonParse(String(text ?? ''), 8 * 1024 * 1024);
}
