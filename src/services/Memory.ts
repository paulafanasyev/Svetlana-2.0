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
    if (typeof localStorage === 'undefined') return;
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
    if (typeof localStorage === 'undefined') return;
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
