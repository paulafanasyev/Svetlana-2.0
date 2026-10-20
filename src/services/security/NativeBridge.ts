// Мост к нативной части приложения Светланы: Windows (Tauri, src-tauri/src/secure_ai.rs) и Android
// (android-hands, SecureAi.kt — те же команды, те же проверки и лимиты). API-ключи облачных ИИ хранятся в
// Диспетчере учётных данных Windows или в Android Keystore и никогда не попадают в JavaScript: запрос к облаку
// выполняет нативная часть и сама подставляет ключ. Даже если на странице окажется чужой скрипт, прочитать ключ
// ему неоткуда — у фронтенда нет команды «выдать ключ».
// Разрешение на облако привязано к случайному ID разговора, который выдаёт нативная часть (подобрать его нельзя).
// Ответ нативной части ждём не бесконечно (с запасом на окно подтверждения): иначе чат навсегда завис бы в «думает».
import { safeJsonParse } from './SafeData';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** То, что видит интерфейс вместо ключа в приложении (Windows или Android). */
export const NATIVE_KEY_PLACEHOLDER = '•••• хранится на устройстве';

/** Сколько ждать ответ облачного ИИ через приложение (включая окно подтверждения). */
export const NATIVE_AI_TIMEOUT_MS = 180_000;
export const NATIVE_AI_TIMEOUT_TEXT = 'Приложение не дождалось ответа нейросети. Попробуйте ещё раз.';

const CONVERSATION_ID_RE = /^[0-9a-f]{32}$/;
let conversationId: string | null = null;
/** Идёт выдача нового ID: параллельные запросы ждут один и тот же ответ, а не просят каждый свой. */
let pending: Promise<string> | null = null;
/** Номер выдачи: сброс разговора делает начатую выдачу устаревшей. */
let pendingGen = 0;

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

/** Обещание с пределом по времени: поздний ответ просто отбрасывается. */
export function withDeadline<T>(p: Promise<T>, ms: number, text: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(text)), ms); });
  return Promise.race([p, t]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

/** Новый разговор: следующий запрос получит новый ID и, значит, новое подтверждение в нативном окне. */
export function resetNativeConversation(): void {
  conversationId = null;
  pending = null;
  pendingGen++;
}

async function currentConversation(inv: Invoke): Promise<string> {
  if (conversationId) return conversationId;
  if (!pending) {
    const gen = ++pendingGen;
    const req = (async () => {
      const id = await withDeadline(inv('ai_new_conversation'), 30_000, NATIVE_AI_TIMEOUT_TEXT);
      const ok = typeof id === 'string' && CONVERSATION_ID_RE.test(id) ? id : null;
      if (gen === pendingGen) conversationId = ok; // разговор не сбросили, пока ждали ответ
      return ok ?? '';
    })();
    pending = req;
    // Когда выдача закончилась (успешно или с ошибкой), следующий запрос может попросить новый ID.
    req.then(
      () => { if (pending === req) pending = null; },
      () => { if (pending === req) pending = null; },
    );
  }
  return pending;
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
export async function nativeCloudChat(provider: string, model: string, body: Record<string, unknown>, timeoutMs = NATIVE_AI_TIMEOUT_MS): Promise<any> {
  const inv = need();
  const ask = async () => withDeadline(
    (async () => inv('ai_cloud_chat', { provider, model, conversation: await currentConversation(inv), body }))(),
    timeoutMs, NATIVE_AI_TIMEOUT_TEXT,
  );
  let text: unknown;
  try {
    text = await ask();
  } catch (e) {
    // ID устарел (приложение долго открыто) — просим новый один раз.
    if (!String((e as any)?.message ?? e).includes('CONVERSATION_UNKNOWN')) throw e;
    resetNativeConversation();
    text = await ask();
  }
  return safeJsonParse(String(text ?? ''), 8 * 1024 * 1024);
}
