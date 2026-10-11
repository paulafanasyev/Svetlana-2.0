// Memory Module - Short-term and long-term memory with RAG-like retrieval
// Безопасность: секреты (ключи, токены, пароли, коды из SMS, карты) вырезаются УЖЕ ПРИ ЗАПИСИ в память,
// поэтому их нет ни в оперативной памяти, ни в истории, ни на диске. Телефоны сохраняются.
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
const num = (v: unknown, def: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def);

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

class Memory {
  private shortTermMemory: MemoryItem[] = [];
  private longTermMemory: Map<string, MemoryItem> = new Map();
  private conversationContext: ConversationContext = { messages: [] };
  
  private readonly SHORT_TERM_LIMIT = 50;
  private readonly STORAGE_KEY = 'svetlana_memory';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      const stored = localStorage.getItem(this.STORAGE_KEY);
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
    } catch (e) {
      console.error('Failed to load memory:', e);
      this.longTermMemory = new Map();
      this.conversationContext = { messages: [] };
    }
  }

  private saveToStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      const now = Date.now();
      const ctx = this.conversationContext;
      const data = {
        longTerm: Array.from(this.longTermMemory.entries())
          .filter(([, item]) => !isExpired(item, now))
          .map(([id, item]) => [id, persistable(item)]),
        conversationContext: {
          messages: ctx.messages
            .filter(m => now - m.timestamp <= MESSAGE_TTL_MS)
            .map(m => ({ ...m, content: redactSecrets(m.content) })),
          currentTopic: ctx.currentTopic ? redactSecrets(ctx.currentTopic) : undefined,
          userMood: ctx.userMood,
        },
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save memory:', e);
    }
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

    return memoryItem;
  }

  getShortTerm(limit: number = 10): MemoryItem[] {
    return this.shortTermMemory.slice(-limit);
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
    this.saveToStorage();

    return memoryItem;
  }

  getFromLongTerm(id: string): MemoryItem | undefined {
    const item = this.longTermMemory.get(id);
    if (item) {
      item.accessCount++;
      item.lastAccessed = Date.now();
      this.saveToStorage();
    }
    return item;
  }

  getAllLongTerm(): MemoryItem[] {
    return Array.from(this.longTermMemory.values());
  }

  removeFromLongTerm(id: string) {
    this.longTermMemory.delete(id);
    this.saveToStorage();
  }

  retrieve(query: string, limit: number = 5): MemoryItem[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = Array.from(this.longTermMemory.values()).map(item => {
      let score = 0;
      const contentLower = item.content.toLowerCase();

      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          score += 10;
        }
      }

      const ageHours = (Date.now() - item.timestamp) / (1000 * 60 * 60);
      score += Math.max(0, 5 - ageHours / 24);

      score += item.importance * 5;

      score += Math.min(item.accessCount, 5);

      return { item, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.item);
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
    return this.conversationContext.messages.slice(-limit);
  }

  setConversationContext(context: Partial<ConversationContext>) {
    const clean: Partial<ConversationContext> = { ...context };
    if (context.messages) clean.messages = context.messages.map(m => ({ ...m, content: redactSecrets(m.content) }));
    if (context.currentTopic !== undefined) clean.currentTopic = redactSecrets(context.currentTopic);
    Object.assign(this.conversationContext, clean);
    this.saveToStorage();
  }

  getConversationContext(): ConversationContext {
    return this.conversationContext;
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
    };
  }

  clearAll() {
    this.shortTermMemory = [];
    this.longTermMemory.clear();
    this.conversationContext = { messages: [] };
    localStorage.removeItem(this.STORAGE_KEY);
  }
}

export const memory = new Memory();
