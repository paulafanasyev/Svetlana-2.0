// Шлюз разрешений для действий, которые предлагает модель (LLM) или распознаёт голос.
// Принцип: текст модели — не согласие пользователя. Любое изменение данных из ответа модели
// или по голосу выполняется только после явного подтверждения с показом точных параметров.

export type ActionSource = 'user' | 'voice' | 'llm';

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

export function needsConfirmation(tool: string, source: ActionSource): boolean {
  return source !== 'user' && !READ_ONLY.has(tool);
}

export interface ActionRequest { tool: string; args: Record<string, unknown>; source: ActionSource }
export interface ActionSummary { title: string; lines: string[]; sourceLabel: string }

export function summarizeAction(req: ActionRequest): ActionSummary {
  const lines = Object.entries(req.args)
    .filter(([, v]) => v !== undefined && v !== '' && typeof v !== 'object')
    .slice(0, 12)
    .map(([k, v]) => `${ARG_LABELS[k] ?? k}: ${String(v).slice(0, 200)}`);
  return {
    title: LABELS[req.tool] ?? req.tool,
    lines,
    sourceLabel: req.source === 'llm' ? 'Предложено нейросетью' : req.source === 'voice' ? 'Распознано голосом' : 'Команда пользователя',
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
  try { const v = JSON.parse(logStorage()?.getItem(LOG_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function record(e: ActionLogEntry): void {
  const s = logStorage();
  if (!s) return;
  try { s.setItem(LOG_KEY, JSON.stringify([...actionLog(), e].slice(-200))); } catch { /* storage full */ }
}

// ---------- ограничение частоты для действий не от пользователя ----------
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
let recent: number[] = [];

/** true — действие можно выполнять. */
export async function authorizeAction(req: ActionRequest, now: number = Date.now()): Promise<boolean> {
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
