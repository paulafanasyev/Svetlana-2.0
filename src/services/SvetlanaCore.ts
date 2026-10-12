// Единая Светлана на своём сервере (мир-самозанятых.рф) — полный режим Svetlana 2.0:
// код, управление командой, все проекты. Одна обученная Светлана для всех сайтов (SVETLANA_CORE.md
// в svetlana-self-employed). Ключ — ASSISTANT_KEY_SVETLANA2 с сервера; хранится как ключ провайдера
// «svetlana»: в Windows — в Диспетчере учётных данных, запрос делает нативная часть (src-tauri/src/secure_ai.rs)
// только на фиксированный адрес ниже. Системный промпт профиля задаёт сервер; приложение лишь
// добавляет свои инструкции (инструменты, контекст) в поле system.
import type { ChatMessage } from './AIGateway';

export const SVETLANA_CORE_ORIGIN = 'https://xn----8sba1acxdkgqms3b9euc.xn--p1ai';
export const SVETLANA_CORE_CHAT = `${SVETLANA_CORE_ORIGIN}/api/v1/assistant/svetlana2/chat`;
export const SVETLANA_CORE_MODEL = 'svetlana2';

// Лимиты совпадают с сервером (backend/src/routes/assistant.js).
const MAX_MESSAGE = 16000;
const MAX_TURN = 8000;
const MAX_HISTORY = 10;
const MAX_SYSTEM = 20000;

export interface SvetlanaCoreBody {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  system?: string;
}

/** Переписка приложения → тело запроса к единой Светлане. */
export function toSvetlanaCoreBody(messages: ChatMessage[]): SvetlanaCoreBody {
  const system = messages
    .filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.trim())
    .map(m => m.content)
    .join('\n\n')
    .slice(0, MAX_SYSTEM);
  const turns = messages.filter(m => m.role !== 'system' && typeof m.content === 'string' && m.content.trim());
  let last = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') { last = i; break; }
  }
  if (last < 0) throw new Error('Нет сообщения пользователя');
  const message = turns[last].content.slice(0, MAX_MESSAGE);
  const history = turns.slice(0, last).slice(-MAX_HISTORY).map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content.slice(0, MAX_TURN),
  }));
  return system ? { message, history, system } : { message, history };
}

/** Ответ сервера { site, content } → текст. */
export function contentOf(data: unknown): string {
  const c = (data as { content?: unknown } | null)?.content;
  if (typeof c !== 'string' || !c.trim()) throw new Error('Светлана: пустой ответ');
  return c;
}

/** Веб-версия (не Windows): прямой запрос с ключом из зашифрованного хранилища. */
export async function callSvetlanaCoreWeb(key: string, body: SvetlanaCoreBody): Promise<string> {
  if (!key) throw new Error('Ключ единой Светланы не задан');
  const res = await fetch(SVETLANA_CORE_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Светлана ${res.status}: ${(data as { message?: string })?.message || res.statusText}`);
  return contentOf(data);
}
