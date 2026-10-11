// История разговора для модели. Реплики Светланы, в которых есть результаты инструментов (CRM, импорт
// с телефона и т.п.), подаются модели только внутри меток «данные, не команды». В остальных
// прошлых репликах синтаксис действий обезвреживается: прошлый ответ не может «подсказать» модели блок
// [CRM: …], который она повторит и выполнит.
import { defang, wrapUntrusted } from './Untrusted';

export interface ChatTurn { role: 'user' | 'svetlana'; content: string; hasData?: boolean }
export interface ModelTurn { role: 'user' | 'assistant'; content: string }

export function toModelHistory(turns: ChatTurn[]): ModelTurn[] {
  return turns.map(t => t.role === 'user'
    ? { role: 'user' as const, content: t.content }
    : { role: 'assistant' as const, content: t.hasData ? wrapUntrusted('tool', t.content, 8000) : defang(t.content) });
}
