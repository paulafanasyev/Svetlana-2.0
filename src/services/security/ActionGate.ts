// Шлюз разрешений для действий, которые предлагает модель (LLM) или распознаёт голос.
// Принцип: текст модели — не согласие пользователя. Любое изменение данных из ответа модели
// или по голосу выполняется только после явного подтверждения с показом точных параметров.
// Голос строже: запись голоса владельца можно воспроизвести, поэтому по голосу даже чтение данных
// (контакты, финансы, записи) показывается только после нажатия — воспроизведённая запись ничего не узнает.

import { safeJsonParse, stripControl } from './SafeData';

/**
 * Происхождение действия. 'user' засчитывается только вместе с жестом пользователя (см. userGesture):
 * без него действие считается 'unknown' и требует подтверждения. По умолчанию везде 'unknown'.
 */
export type ActionSource = 'user' | 'voice' | 'llm' | 'unknown';

/** Неподделываемое подтверждение «это сделал человек»: выдаётся только по настоящему (isTrusted) событию браузера. */
export interface UserGesture { readonly __gesture: true }
const gestures = new WeakSet<object>();
const GESTURE_TTL_MS = 5_000;

/**
 * Жест по настоящему событию. Если указан [tool], жест привязан к этому действию: нажатие на кнопку
 * «Записать доход» нельзя потратить на другой инструмент.
 */
export function userGesture(event: { isTrusted?: boolean } | null | undefined, tool?: string): UserGesture | undefined {
  if (!event || event.isTrusted !== true) return undefined;
  const g = Object.freeze({ __gesture: true as const, at: Date.now(), tool: typeof tool === 'string' && tool ? tool : null });
  gestures.add(g);
  return g;
}
function validGesture(g: UserGesture | undefined, now: number, tool: string): boolean {
  if (!g || !gestures.has(g)) return false;
  const { at, tool: boundTo } = g as unknown as { at: number; tool: string | null };
  gestures.delete(g); // одноразовый
  if (boundTo !== null && boundTo !== tool) return false; // жест для другого действия
  return now - at <= GESTURE_TTL_MS;
}

/** Строгость источника: голос строже всех (даже чтение — по нажатию), затем модель, затем неизвестный. */
const STRICTNESS: Record<ActionSource, number> = { user: 0, unknown: 1, llm: 2, voice: 3 };

/**
 * Самый строгий из источников: если хоть один не 'user', действие не считается командой пользователя,
 * а действие, предложенное моделью в голосовом разговоре, остаётся голосовым ('voice' не понижается до 'llm').
 */
export function stricterSource(a: ActionSource | undefined, b: ActionSource | undefined): ActionSource {
  const x = a ?? 'unknown';
  const y = b ?? 'unknown';
  const sx = STRICTNESS[x] ?? STRICTNESS.voice;
  const sy = STRICTNESS[y] ?? STRICTNESS.voice;
  if (sx === 0 && sy === 0) return 'user';
  return sx >= sy ? x : y;
}

/** Глубоко замороженная копия: подтверждается и выполняется один и тот же неизменяемый объект. */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.values(v as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

/** Инструменты, которые только читают данные и ничего не меняют. */
const READ_ONLY = new Set([
  'crm_find_contacts', 'crm_stats',
  'biz_receivables', 'biz_tax_summary', 'biz_find_support', 'biz_analytics', 'biz_check_inn',
  'biz_free_slots', 'biz_agenda', 'biz_booking_reminders',
]);

const LABELS: Record<string, string> = {
  crm_add_contact: 'Добавить контакт', crm_update_contact: 'Изменить контакт', crm_add_note: 'Добавить заметку',
  crm_add_task: 'Создать задачу', crm_complete_task: 'Закрыть задачу', crm_create_deal: 'Создать сделку',
  crm_move_deal: 'Перевести сделку', crm_import_phone_contacts: 'Импортировать контакты с телефона',
  crm_find_contacts: 'Показать контакты', crm_stats: 'Показать сводку CRM',
  biz_set_profile: 'Изменить бизнес-профиль', biz_add_income: 'Записать доход', biz_add_expense: 'Записать расход',
  biz_create_document: 'Создать документ', biz_mark_paid: 'Отметить счёт оплаченным',
  biz_book: 'Записать клиента', biz_cancel_booking: 'Отменить запись', biz_complete_booking: 'Отметить визит',
};

const ARG_LABELS: Record<string, string> = {
  amount: 'Сумма', client: 'Клиент', name: 'Имя', description: 'Описание', service: 'Услуга', type: 'Тип',
  invoice: 'Счёт', when: 'Когда', date: 'Дата', phone: 'Телефон', text: 'Текст', stage: 'Этап', regime: 'Режим',
  payerType: 'Плательщик', payMethod: 'Способ оплаты', category: 'Категория', title: 'Название', value: 'Сумма',
};

export function isReadOnlyTool(tool: string): boolean {
  return READ_ONLY.has(tool);
}

/**
 * Нужно ли явное подтверждение. Команда пользователя (настоящий жест) — нет. Голос — всегда, даже для чтения
 * (запись голоса можно воспроизвести). Остальные источники — для всего, что меняет данные.
 */
export function needsConfirmation(tool: string, source: ActionSource): boolean {
  if (source === 'user') return false;
  if (source === 'voice') return true;
  return !READ_ONLY.has(tool);
}

export interface ActionRequest { tool: string; args: Record<string, unknown>; source: ActionSource; gesture?: UserGesture }
export interface ActionSummary { title: string; lines: string[]; sourceLabel: string }

export function summarizeAction(req: ActionRequest): ActionSummary {
  // Показываем ВСЕ параметры, которые будут выполнены, без обрезки (строки уже ограничены 2000 символами),
  // массивы и вложенные объекты — как JSON; управляющие и bidi-символы удаляются, чтобы текст нельзя было замаскировать.
  const lines = Object.entries(req.args)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${ARG_LABELS[k] ?? stripControl(k, false)}: ${stripControl(typeof v === 'object' ? JSON.stringify(v) : String(v), false)}`);
  return {
    title: LABELS[req.tool] ?? stripControl(req.tool, false),
    lines,
    sourceLabel: req.source === 'llm' ? 'Предложено нейросетью' : req.source === 'voice' ? 'Распознано голосом'
      : req.source === 'user' ? 'Команда пользователя' : 'Автоматическое действие',
  };
}

export type Confirmer = (req: ActionRequest, summary: ActionSummary) => Promise<boolean>;

const defaultConfirmer: Confirmer = async (_req, s) => {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false; // нет интерфейса — запрещаем
  return window.confirm(`${s.sourceLabel}: ${s.title}\n${s.lines.join('\n')}\n\nВыполнить?`);
};

let confirmer: Confirmer = defaultConfirmer;

/** Интерфейс регистрирует своё окно подтверждения; возвращает функцию отмены регистрации. */
export function setActionConfirmer(fn: Confirmer): () => void {
  confirmer = fn;
  return () => { if (confirmer === fn) confirmer = defaultConfirmer; };
}

// ---------- журнал действий (локально, последние 200) ----------
const LOG_KEY = 'svetlana_action_log_v1';
export interface ActionLogEntry { t: number; tool: string; source: ActionSource; decision: 'auto' | 'approved' | 'denied' }

function logStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function actionLog(): ActionLogEntry[] {
  try {
    const v = safeJsonParse(logStorage()?.getItem(LOG_KEY) ?? '[]', 200_000);
    if (!Array.isArray(v)) return [];
    const sources: ActionSource[] = ['user', 'voice', 'llm', 'unknown'];
    return v.slice(-200).filter((e): e is ActionLogEntry => !!e && typeof e === 'object' && typeof e.t === 'number' && typeof e.tool === 'string'
      && sources.includes(e.source) && ['auto', 'approved', 'denied'].includes(e.decision))
      .map(e => ({ t: e.t, tool: stripControl(e.tool, false).slice(0, 60), source: e.source, decision: e.decision }));
  } catch { return []; }
}

function record(e: ActionLogEntry): void {
  const s = logStorage();
  if (!s) return;
  try { s.setItem(LOG_KEY, JSON.stringify([...actionLog(), e].slice(-200))); } catch { /* storage full */ }
}

// ---------- ограничение частоты для действий не от пользователя ----------
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
let recent: number[] = [];

/** true — действие можно выполнять. Все инструменты проходят сюда из ToolRegistry.executeTool. */
export async function authorizeAction(input: ActionRequest, now: number = Date.now()): Promise<boolean> {
  // 'user' без настоящего жеста пользователя (или с жестом для другого действия) понижаем до 'unknown'.
  const source: ActionSource = input.source === 'user' && !validGesture(input.gesture, now, input.tool) ? 'unknown' : input.source;
  const req: ActionRequest = { tool: input.tool, args: deepFreeze(input.args), source };
  if (!needsConfirmation(req.tool, req.source)) {
    record({ t: now, tool: req.tool, source: req.source, decision: 'auto' });
    return true;
  }
  recent = recent.filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    record({ t: now, tool: req.tool, source: req.source, decision: 'denied' });
    return false;
  }
  recent.push(now);
  let ok = false;
  try { ok = await confirmer(req, summarizeAction(req)); } catch { ok = false; }
  record({ t: now, tool: req.tool, source: req.source, decision: ok ? 'approved' : 'denied' });
  return ok;
}

/** Для тестов. */
export function resetActionGate(): void { recent = []; confirmer = defaultConfirmer; }
