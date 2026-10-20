// Memory Module - Short-term and long-term memory with RAG-like retrieval
// Безопасность: секреты (ключи, токены, пароли, коды из SMS, карты) вырезаются УЖЕ ПРИ ЗАПИСИ в память,
// поэтому их нет ни в оперативной памяти, ни в истории, ни на диске. Телефоны сохраняются.
// Все читающие методы отдают КОПИИ: изменить память в обход очистки секретов через полученный объект нельзя.
// Устаревшие записи удаляются и из оперативной памяти (pruneLongTerm), а долгая память не растёт бесконечно:
// сверх LONG_TERM_LIMIT уходят самые неважные и давно ненужные (предпочтения и факты — в последнюю очередь).
// Хранилище переполнено: сначала уходят старые записи о разговорах и действиях (повтор записи), а если и так
// не удалось — saveFailed в getStats() и подписчики onSaveError узнают об этом (молча не теряем).
import { safeJsonParse, stripControl, MAX_BYTES } from './security/SafeData';
import { redactSecrets, redactDeep } from './security/Redact';

export interface MemoryItem {
  id: string;
  type: 'conversation' | 'action' | 'preference' | 'fact';
  content: string;
  metadata?: Record<string, any>;
  timestamp: number;
  importance: number; // 0-1
  accessCount: number;
  lastAccessed: number;
}

export interface ConversationContext {
  messages: { role: string; content: string; timestamp: number }[];
  currentTopic?: string;
  userMood?: string;
}

const MEMORY_TYPES: MemoryItem['type'][] = ['conversation', 'action', 'preference', 'fact'];
const ROLES = ['user', 'assistant', 'system'];
const DAY = 24 * 60 * 60 * 1000;
/** Сколько храним на диске: переписку — 7 дней, записи о разговорах и действиях — 30 дней. */
export const MESSAGE_TTL_MS = 7 * DAY;
export const EPISODIC_TTL_MS = 30 * DAY;
/** Не больше стольких записей долгой памяти: иначе хранилище браузера переполнится и память перестанет сохраняться. */
export const LONG_TERM_LIMIT = 1000;
export const MEMORY_SAVE_FAILED = 'Память Светланы не сохраняется: хранилище устройства переполнено или недоступно. После перезапуска последние записи могут пропасть.';
const num = (v: unknown, def: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def);

/** Глубокая копия (для данных, которые отдаём наружу). */
function clone<T>(v: T): T {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)) as T; }
}
const copyItem = (i: MemoryItem): MemoryItem => (i.metadata ? { ...i, metadata: clone(i.metadata) } : { ...i });
const copyMessage = <M extends { role: string; content: string }>(m: M): M => ({ ...m });

function toMemoryItem(v: unknown): MemoryItem | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.content !== 'string') return undefined;
  const now = Date.now();
  return {
    id: stripControl(r.id).slice(0, 80),
    type: MEMORY_TYPES.includes(r.type as MemoryItem['type']) ? (r.type as MemoryItem['type']) : 'fact',
    content: stripControl(r.content).slice(0, 10_000),
    metadata: r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? (r.metadata as Record<string, any>) : undefined,
    timestamp: num(r.timestamp, now, 0, 4_102_444_800_000),
    importance: num(r.importance, 0.5, 0, 1),
    accessCount: Math.floor(num(r.accessCount, 0, 0, 1e9)),
    lastAccessed: num(r.lastAccessed, now, 0, 4_102_444_800_000),
  };
}

function toMessage(v: unknown): ConversationContext['messages'][number] | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.content !== 'string' || !ROLES.includes(r.role as string)) return undefined;
  return { role: r.role as string, content: stripControl(r.content).slice(0, 20_000), timestamp: num(r.timestamp, Date.now(), 0, 4_102_444_800_000) };
}

export function isExpired(item: Pick<MemoryItem, 'type' | 'timestamp'>, now = Date.now()): boolean {
  return (item.type === 'conversation' || item.type === 'action') && now - item.timestamp > EPISODIC_TTL_MS;
}

/** Запись без секретов (и для памяти, и для диска). */
export function persistable(item: MemoryItem): MemoryItem {
  return { ...item, content: redactSecrets(item.content), metadata: item.metadata ? redactDeep(item.metadata) : undefined };
}

/** Предпочтения и факты ценнее записей о разговорах и действиях. */
const keepRank = (i: MemoryItem): number => (i.type === 'preference' || i.type === 'fact' ? 1 : 0);

/**
 * Какие записи долгой памяти удалить: все устаревшие и, если записей больше limit, самые неважные
 * (сначала разговоры и действия, затем меньшая важность, затем давнее всего нужные).
 */
export function pruneLongTerm(items: MemoryItem[], now = Date.now(), limit = LONG_TERM_LIMIT): string[] {
  const drop = items.filter(i => isExpired(i, now)).map(i => i.id);
  const gone = new Set(drop);
  const alive = items.filter(i => !gone.has(i.id));
  const extra = alive.length - Math.max(0, limit);
  if (extra > 0) {
    const order = [...alive].sort((a, b) =>
      keepRank(a) - keepRank(b) || a.importance - b.importance || a.lastAccessed - b.lastAccessed);
    for (const i of order.slice(0, extra)) drop.push(i.id);
  }
  return drop;
}

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
function defaultStorage(): KV | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export class Memory {
  private shortTermMemory: MemoryItem[] = [];
  private longTermMemory: Map<string, MemoryItem> = new Map();
  private conversationContext: ConversationContext = { messages: [] };
  private saveFailed = false;
  private saveErrorListeners = new Set<(message: string) => void>();
  
  private readonly SHORT_TERM_LIMIT = 50;
  private readonly STORAGE_KEY = 'svetlana_memory';
  private readonly store: () => KV | null;

  constructor(store: () => KV | null = defaultStorage) {
    this.store = store;
    this.loadFromStorage();
  }

  /** Удалить устаревшие и лишние записи долгой памяти (и в оперативной памяти, а не только на диске). */
  private prune(now = Date.now(), limit = LONG_TERM_LIMIT) {
    for (const id of pruneLongTerm(Array.from(this.longTermMemory.values()), now, limit)) this.longTermMemory.delete(id);
    this.conversationContext.messages = this.conversationContext.messages.filter(m => now - m.timestamp <= MESSAGE_TTL_MS);
  }

  private loadFromStorage() {
    try {
      const kv = this.store();
      if (!kv) return;
      const stored = kv.getItem(this.STORAGE_KEY);
      if (!stored) return;
      const data = safeJsonParse(stored, MAX_BYTES.storage) as { longTerm?: unknown; conversationContext?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      const now = Date.now();
      if (Array.isArray(data.longTerm)) {
        for (const pair of data.longTerm.slice(0, 5000)) {
          const item = Array.isArray(pair) ? toMemoryItem(pair[1]) : undefined;
          if (item && !isExpired(item, now)) this.longTermMemory.set(item.id, persistable(item));
        }
      }
      const ctx = data.conversationContext as { messages?: unknown; currentTopic?: unknown; userMood?: unknown } | undefined;
      if (ctx && typeof ctx === 'object' && Array.isArray(ctx.messages)) {
        this.conversationContext = {
          messages: ctx.messages.slice(-20).map(toMessage)
            .filter((m): m is ConversationContext['messages'][number] => !!m && now - m.timestamp <= MESSAGE_TTL_MS)
            .map(m => ({ ...m, content: redactSecrets(m.content) })),
          currentTopic: typeof ctx.currentTopic === 'string' ? redactSecrets(stripControl(ctx.currentTopic).slice(0, 200)) : undefined,
          userMood: typeof ctx.userMood === 'string' ? stripControl(ctx.userMood).slice(0, 50) : undefined,
        };
      }
      this.prune(now);
    } catch (e) {
      console.error('Failed to load memory:', e instanceof Error ? e.name : 'error');
      this.longTermMemory = new Map();
      this.conversationContext = { messages: [] };
    }
  }

  private serialize(): string {
    const ctx = this.conversationContext;
    return JSON.stringify({
      longTerm: Array.from(this.longTermMemory.entries()).map(([id, item]) => [id, persistable(item)]),
      conversationContext: {
        messages: ctx.messages.map(m => ({ ...m, content: redactSecrets(m.content) })),
        currentTopic: ctx.currentTopic ? redactSecrets(ctx.currentTopic) : undefined,
        userMood: ctx.userMood,
      },
    });
  }

  /** Сохранить на диск. Не влезло — освобождаем место и пробуем ещё раз; не вышло — сообщаем. */
  private saveToStorage(): boolean {
    const kv = this.store();
    if (!kv) return true;
    const now = Date.now();
    this.prune(now);
    const attempt = () => { kv.setItem(this.STORAGE_KEY, this.serialize()); };
    try {
      attempt();
      this.saveFailed = false;
      return true;
    } catch {
      try {
        // Освобождаем место: половина лимита (сначала разговоры и действия) и последние 10 сообщений.
        this.prune(now, Math.max(50, Math.floor(this.longTermMemory.size / 2)));
        this.conversationContext.messages = this.conversationContext.messages.slice(-10);
        attempt();
        this.saveFailed = false;
        return true;
      } catch (e) {
        const first = !this.saveFailed;
        this.saveFailed = true;
        console.error('Failed to save memory:', e instanceof Error ? e.name : 'error');
        if (first) for (const l of [...this.saveErrorListeners]) { try { l(MEMORY_SAVE_FAILED); } catch { /* подписчик не ломает память */ } }
        return false;
      }
    }
  }

  /** Узнать, что память перестала сохраняться (сообщение приходит один раз, пока сбой не пройдёт). */
  onSaveError(listener: (message: string) => void): () => void {
    this.saveErrorListeners.add(listener);
    return () => { this.saveErrorListeners.delete(listener); };
  }

  /** true — последнее сохранение на диск удалось. */
  isPersisted(): boolean {
    return !this.saveFailed;
  }

  addToShortTerm(item: Omit<MemoryItem, 'id' | 'timestamp' | 'accessCount' | 'lastAccessed'>) {
    const memoryItem: MemoryItem = persistable({
      ...item,
      id: `stm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    });

    this.shortTermMemory.push(memoryItem);

    if (this.shortTermMemory.length > this.SHORT_TERM_LIMIT) {
      this.shortTermMemory.shift();
    }

    return copyItem(memoryItem);
  }

  getShortTerm(limit: number = 10): MemoryItem[] {
    return this.shortTermMemory.slice(-limit).map(copyItem);
  }

  clearShortTerm() {
    this.shortTermMemory = [];
  }

  addToLongTerm(item: Omit<MemoryItem, 'id' | 'timestamp' | 'accessCount' | 'lastAccessed'>) {
    const memoryItem: MemoryItem = persistable({
      ...item,
      id: `ltm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    });

    this.longTermMemory.set(memoryItem.id, memoryItem);
    // В оперативной памяти тоже не больше LONG_TERM_LIMIT, даже если хранилища нет.
    this.prune();
    this.saveToStorage();

    return copyItem(memoryItem);
  }

  getFromLongTerm(id: string): MemoryItem | undefined {
    const item = this.longTermMemory.get(id);
    if (item && isExpired(item)) {
      this.longTermMemory.delete(id);
      this.saveToStorage();
      return undefined;
    }
    if (item) {
      item.accessCount++;
      item.lastAccessed = Date.now();
      this.saveToStorage();
    }
    return item ? copyItem(item) : undefined;
  }

  getAllLongTerm(): MemoryItem[] {
    const now = Date.now();
    return Array.from(this.longTermMemory.values()).filter(i => !isExpired(i, now)).map(copyItem);
  }

  removeFromLongTerm(id: string) {
    this.longTermMemory.delete(id);
    this.saveToStorage();
  }

  retrieve(query: string, limit: number = 5): MemoryItem[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const now = Date.now();

    const scored = Array.from(this.longTermMemory.values()).filter(item => !isExpired(item, now)).map(item => {
      let score = 0;
      const contentLower = item.content.toLowerCase();

      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          score += 10;
        }
      }

      const ageHours = (now - item.timestamp) / (1000 * 60 * 60);
      score += Math.max(0, 5 - ageHours / 24);

      score += item.importance * 5;

      score += Math.min(item.accessCount, 5);

      return { item, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => copyItem(s.item));
  }

  addMessage(role: string, content: string) {
    this.conversationContext.messages.push({
      role,
      content: redactSecrets(content),
      timestamp: Date.now(),
    });

    if (this.conversationContext.messages.length > 20) {
      this.conversationContext.messages.shift();
    }

    this.saveToStorage();
  }

  getConversationHistory(limit: number = 10): { role: string; content: string }[] {
    const now = Date.now();
    return this.conversationContext.messages.filter(m => now - m.timestamp <= MESSAGE_TTL_MS).slice(-limit).map(copyMessage);
  }

  setConversationContext(context: Partial<ConversationContext>) {
    const clean: Partial<ConversationContext> = { ...context };
    if (context.messages) clean.messages = context.messages.map(m => ({ ...m, content: redactSecrets(m.content) }));
    if (context.currentTopic !== undefined) clean.currentTopic = redactSecrets(context.currentTopic);
    Object.assign(this.conversationContext, clean);
    this.saveToStorage();
  }

  getConversationContext(): ConversationContext {
    const ctx = this.conversationContext;
    return { ...ctx, messages: ctx.messages.map(copyMessage) };
  }

  clearConversation() {
    this.conversationContext = { messages: [] };
    this.saveToStorage();
  }

  getStats() {
    return {
      shortTermCount: this.shortTermMemory.length,
      longTermCount: this.longTermMemory.size,
      conversationMessages: this.conversationContext.messages.length,
      saveFailed: this.saveFailed,
    };
  }

  clearAll() {
    this.shortTermMemory = [];
    this.longTermMemory.clear();
    this.conversationContext = { messages: [] };
    this.saveFailed = false;
    try {
      this.store()?.removeItem(this.STORAGE_KEY);
    } catch { /* хранилище недоступно: в оперативной памяти уже пусто */ }
  }
}

export const memory = new Memory();
