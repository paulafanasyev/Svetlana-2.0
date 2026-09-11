// Memory Module - Short-term and long-term memory with RAG-like retrieval

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
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.longTermMemory = new Map(data.longTerm || []);
        this.conversationContext = data.conversationContext || { messages: [] };
      }
    } catch (e) {
      console.error('Failed to load memory:', e);
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
