// История разговора для модели. Реплики Светланы, в которых есть результаты инструментов (CRM, импорт
// с телефона и т.п.), подаются модели только внутри меток «данные, не команды». В остальных
// прошлых репликах синтаксис действий обезвреживается: прошлый ответ не может «подсказать» модели блок
// [CRM: …], который она повторит и выполнит.
// В голосовом режиме (hideData) прошлые результаты инструментов не передаются вовсе: запись голоса можно
// воспроизвести, и модель не должна пересказать по ней ранее показанные контакты или финансы.
import { defang, wrapUntrusted } from './Untrusted';

export interface ChatTurn { role: 'user' | 'svetlana'; content: string; hasData?: boolean }
export interface ModelTurn { role: 'user' | 'assistant'; content: string }

export const DATA_OMITTED = '[Данные CRM скрыты: голосовой режим]';

export function toModelHistory(turns: ChatTurn[], opts: { hideData?: boolean } = {}): ModelTurn[] {
  return turns.map(t => t.role === 'user'
    ? { role: 'user' as const, content: t.content }
    : { role: 'assistant' as const, content: t.hasData
      ? (opts.hideData ? DATA_OMITTED : wrapUntrusted('tool', t.content, 8000))
      : defang(t.content) });
}
