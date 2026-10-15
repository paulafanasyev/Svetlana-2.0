// Команды, которые есть только в приложении для Android: голос телефона и «руки» (спец. возможности).
// Ключи и облако идут через те же команды, что в Windows (NativeBridge.ts), здесь только то, чего в Windows нет.
// Руки ничего не делают без спроса: телефон сам показывает список шагов в своём окне и ждёт «ОК».
import { isAndroidApp } from '../platform';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function inv(): Invoke {
  const f = (globalThis as any).__TAURI_INTERNALS__?.invoke;
  if (!isAndroidApp() || typeof f !== 'function') throw new Error('Доступно только в приложении для Android');
  return f as Invoke;
}

type SimpleAction = 'back' | 'home' | 'recents' | 'notifications' | 'read_screen';

export type HandsAction =
  | { type: 'open_app'; name: string }
  | { type: 'tap'; target: string }
  | { type: 'type'; text: string; field?: string }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: SimpleAction }
  | { type: 'wait'; ms: number };

export const MAX_ACTIONS = 12;
const SIMPLE: readonly SimpleAction[] = ['back', 'home', 'recents', 'notifications', 'read_screen'];

/** Распознать фразу голосом телефона (русский). Пустая строка — ничего не расслышала или остановлено. */
export async function androidListen(): Promise<string> {
  const t = await inv()('voice_listen');
  return typeof t === 'string' ? t.slice(0, 500) : '';
}
export async function androidStopListening(): Promise<void> { await inv()('voice_stop'); }

/** Озвучить текст голосом телефона. Промис завершается, когда фраза произнесена или остановлена. */
export async function androidSpeak(text: string): Promise<void> {
  await inv()('tts_speak', { text: text.slice(0, 3900) });
}
export async function androidStopSpeaking(): Promise<void> { await inv()('tts_stop'); }

export async function handsStatus(): Promise<{ enabled: boolean }> {
  const s = (await inv()('hands_status')) as { enabled?: unknown } | null;
  return { enabled: s?.enabled === true };
}
export async function handsOpenSettings(): Promise<void> { await inv()('hands_open_settings'); }

/** Выполнить шаги. Телефон покажет их и спросит подтверждение; вернёт отчёт по шагам. */
export async function handsRun(actions: HandsAction[]): Promise<string> {
  const r = await inv()('hands_run', { actions: actions.slice(0, MAX_ACTIONS) });
  return typeof r === 'string' ? r.slice(0, 5000) : '';
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function sanitize(a: unknown): HandsAction | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : '';
  if ((SIMPLE as readonly string[]).includes(type)) return { type: type as SimpleAction };
  switch (type) {
    case 'open_app': { const name = str(o.name, 60); return name ? { type: 'open_app', name } : null; }
    case 'tap': { const target = str(o.target, 80); return target ? { type: 'tap', target } : null; }
    case 'type': {
      const text = typeof o.text === 'string' && o.text ? o.text.slice(0, 2000) : null;
      if (!text) return null;
      const field = str(o.field, 80);
      return field ? { type: 'type', text, field } : { type: 'type', text };
    }
    case 'scroll': return { type: 'scroll', direction: o.direction === 'up' ? 'up' : 'down' };
    case 'wait': {
      const ms = Number(o.ms);
      return { type: 'wait', ms: Number.isFinite(ms) ? Math.min(5000, Math.max(200, Math.round(ms))) : 1000 };
    }
    default: return null;
  }
}

const JSON_BLOCK = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/;

/** Отделить текст ответа от блока ```json {"actions": [...]}```. Неизвестные шаги отбрасываются. */
export function extractActions(reply: string): { text: string; actions: HandsAction[] } {
  const src = String(reply ?? '');
  const m = JSON_BLOCK.exec(src);
  if (!m) return { text: src.trim(), actions: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(m[1]); } catch { return { text: src.trim(), actions: [] }; }
  const list = (parsed as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(list)) return { text: src.trim(), actions: [] };
  const actions = list.slice(0, MAX_ACTIONS).map(sanitize).filter((a): a is HandsAction => a !== null);
  if (!actions.length) return { text: src.trim(), actions: [] };
  return { text: (src.slice(0, m.index) + src.slice(m.index + m[0].length)).trim(), actions };
}

export function normText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/["'«»“”„.,!?:;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Быстрые команды без ИИ (работают даже без ключа): «открой Telegram», «назад», «пролистай»… */
export function quickActions(input: string): HandsAction[] | null {
  let t = normText(input);
  for (const p of ['света ', 'светлана ', 'светочка ', 'пожалуйста ']) if (t.startsWith(p)) t = t.slice(p.length);
  if (t.endsWith(' пожалуйста')) t = t.slice(0, -' пожалуйста'.length);
  t = t.trim();
  switch (t) {
    case 'назад': return [{ type: 'back' }];
    case 'домой': case 'на главный экран': case 'главный экран': return [{ type: 'home' }];
    case 'что на экране': case 'прочитай экран': return [{ type: 'read_screen' }];
    case 'уведомления': case 'открой уведомления': case 'покажи уведомления': return [{ type: 'notifications' }];
  }
  let m = /^(?:пролистай|прокрути|листай)(?:\s+(вниз|вверх))?$/.exec(t);
  if (m) return [{ type: 'scroll', direction: m[1] === 'вверх' ? 'up' : 'down' }];
  m = /^(?:открой|запусти)\s+(?:приложение\s+)?(.{2,40})$/.exec(t);
  if (m) return [{ type: 'open_app', name: m[1] }];
  m = /^(?:нажми|тапни|кликни)(?:\s+на)?\s+(.{1,60})$/.exec(t);
  if (m) return [{ type: 'tap', target: m[1] }];
  m = /^\s*(?:света,?\s+)?(?:напечатай|введи)\s+(.+)$/i.exec(String(input ?? '').trim());
  if (m) return [{ type: 'type', text: m[1].trim().slice(0, 2000) }];
  return null;
}

/** Инструкция для ИИ: как предлагать шаги для рук. Выполняет их только телефон и только после «ОК». */
export const HANDS_SYSTEM_PROMPT = [
  'Ты Светлана, помощник на телефоне Android. Пользователь просит сделать что-то на телефоне.',
  'Ответь одной короткой фразой по-русски и добавь блок ```json {"actions":[...]}```.',
  'Разрешённые шаги: {"type":"open_app","name":"Telegram"}, {"type":"tap","target":"текст кнопки"}, {"type":"type","text":"что напечатать","field":"подпись поля"},',
  '{"type":"scroll","direction":"down"} или "up", {"type":"back"}, {"type":"home"}, {"type":"notifications"}, {"type":"read_screen"}, {"type":"wait","ms":1000}.',
  `Не больше ${MAX_ACTIONS} шагов. Ничего не отправляй, не оплачивай и не удаляй без прямой просьбы. Телефон покажет шаги и спросит подтверждение.`,
  'Если просьба не про действия на телефоне, ответь текстом без блока json.',
].join('\n');
