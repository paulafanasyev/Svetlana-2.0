// Memory Module - Short-term and long-term memory with RAG-like retrieval
import { safeJsonParse, stripControl, MAX_BYTES } from './security/SafeData';

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
const num = (v: unknown, def: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def);

/** Память из localStorage считается недоверенной: собираем запись поле за полем, мусор отбрасываем. */
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
      if (Array.isArray(data.longTerm)) {
        for (const pair of data.longTerm.slice(0, 5000)) {
          const item = Array.isArray(pair) ? toMemoryItem(pair[1]) : undefined;
          if (item) this.longTermMemory.set(item.id, item);
        }
      }
      const ctx = data.conversationContext as { messages?: unknown; currentTopic?: unknown; userMood?: unknown } | undefined;
      if (ctx && typeof ctx === 'object' && Array.isArray(ctx.messages)) {
        this.conversationContext = {
          messages: ctx.messages.slice(-20).map(toMessage).filter((m): m is ConversationContext['messages'][number] => !!m),
          currentTopic: typeof ctx.currentTopic === 'string' ? stripControl(ctx.currentTopic).slice(0, 200) : undefined,
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
      const data = {
        longTerm: Array.from(this.longTermMemory.entries()),
        conversationContext: this.conversationContext,
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save memory:', e);
    }
  }

  // Short-term memory (working memory)
  addToShortTerm(item: Omit<MemoryItem, 'id' | 'timestamp' | 'accessCount' | 'lastAccessed'>) {
    const memoryItem: MemoryItem = {
      ...item,
      id: `stm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    this.shortTermMemory.push(memoryItem);

    // Maintain limit
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

  // Long-term memory
  addToLongTerm(item: Omit<MemoryItem, 'id' | 'timestamp' | 'accessCount' | 'lastAccessed'>) {
    const memoryItem: MemoryItem = {
      ...item,
      id: `ltm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };

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

  // RAG-like retrieval
  retrieve(query: string, limit: number = 5): MemoryItem[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    // Score all memories
    const scored = Array.from(this.longTermMemory.values()).map(item => {
      let score = 0;
      const contentLower = item.content.toLowerCase();

      // Keyword matching
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          score += 10;
        }
      }

      // Recency bonus
      const ageHours = (Date.now() - item.timestamp) / (1000 * 60 * 60);
      score += Math.max(0, 5 - ageHours / 24); // Decay over 5 days

      // Importance bonus
      score += item.importance * 5;

      // Access frequency bonus
      score += Math.min(item.accessCount, 5);

      return { item, score };
    });

    // Sort by score and return top N
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.item);
  }

  // Conversation context
  addMessage(role: string, content: string) {
    this.conversationContext.messages.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // Keep last 20 messages
    if (this.conversationContext.messages.length > 20) {
      this.conversationContext.messages.shift();
    }

    this.saveToStorage();
  }

  getConversationHistory(limit: number = 10): { role: string; content: string }[] {
    return this.conversationContext.messages.slice(-limit);
  }

  setConversationContext(context: Partial<ConversationContext>) {
    Object.assign(this.conversationContext, context);
    this.saveToStorage();
  }

  getConversationContext(): ConversationContext {
    return this.conversationContext;
  }

  clearConversation() {
    this.conversationContext = { messages: [] };
    this.saveToStorage();
  }

  // Statistics
  getStats() {
    return {
      shortTermCount: this.shortTermMemory.length,
      longTermCount: this.longTermMemory.size,
      conversationMessages: this.conversationContext.messages.length,
    };
  }

  // Clear all memory
  clearAll() {
    this.shortTermMemory = [];
    this.longTermMemory.clear();
    this.conversationContext = { messages: [] };
    localStorage.removeItem(this.STORAGE_KEY);
  }
}

export const memory = new Memory();
