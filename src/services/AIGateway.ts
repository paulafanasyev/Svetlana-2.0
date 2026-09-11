// Real AI Gateway - connects to actual LLM providers

export interface AIProvider {
  id: string;
  name: string;
  type: 'online' | 'offline';
  endpoint: string;
  apiKey?: string;
  model: string;
  enabled: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  provider: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class AIGateway {
  private providers: Map<string, AIProvider> = new Map();
  private activeProvider: string | null = null;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    const stored = localStorage.getItem('svetlana_ai_providers');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        data.forEach((p: AIProvider) => {
          this.providers.set(p.id, p);
          if (p.enabled && !this.activeProvider) {
            this.activeProvider = p.id;
          }
        });
      } catch (e) {
        console.error('Failed to load AI providers:', e);
      }
    }
  }

  private saveToStorage() {
    const data = Array.from(this.providers.values());
    localStorage.setItem('svetlana_ai_providers', JSON.stringify(data));
  }

  addProvider(provider: AIProvider) {
    this.providers.set(provider.id, provider);
    if (provider.enabled) {
      this.activeProvider = provider.id;
    }
    this.saveToStorage();
  }

  removeProvider(id: string) {
    this.providers.delete(id);
    if (this.activeProvider === id) {
      this.activeProvider = null;
      // Find another enabled provider
      for (const [pid, p] of this.providers) {
        if (p.enabled) {
          this.activeProvider = pid;
          break;
        }
      }
    }
    this.saveToStorage();
  }

  updateProvider(id: string, updates: Partial<AIProvider>) {
    const provider = this.providers.get(id);
    if (provider) {
      Object.assign(provider, updates);
      if (updates.enabled) {
        this.activeProvider = id;
      }
      this.saveToStorage();
    }
  }

  getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  getActiveProvider(): AIProvider | undefined {
    return this.activeProvider ? this.providers.get(this.activeProvider) : undefined;
  }

  setActiveProvider(id: string) {
    const provider = this.providers.get(id);
    if (provider && provider.enabled) {
      this.activeProvider = id;
      this.saveToStorage();
    }
  }

  async chat(messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }): Promise<AIResponse> {
    const provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No active AI provider configured');
    }

    switch (provider.id) {
      case 'openai':
        return this.callOpenAI(provider, messages, options);
      case 'anthropic':
        return this.callAnthropic(provider, messages, options);
      case 'groq':
        return this.callGroq(provider, messages, options);
      case 'openrouter':
        return this.callOpenRouter(provider, messages, options);
      case 'deepseek':
        return this.callDeepSeek(provider, messages, options);
      case 'ollama':
        return this.callOllama(provider, messages, options);
      default:
        throw new Error(`Provider ${provider.id} not implemented`);
    }
  }

  private async callOpenAI(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      provider: provider.name,
      model: provider.model,
      usage: data.usage,
    };
  }

  private async callAnthropic(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: options?.max_tokens ?? 4096,
        system: systemMessage?.content,
        messages: chatMessages,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.content[0].text,
      provider: provider.name,
      model: provider.model,
      usage: data.usage,
    };
  }

  private async callGroq(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Groq API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      provider: provider.name,
      model: provider.model,
      usage: data.usage,
    };
  }

  private async callOpenRouter(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenRouter API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      provider: provider.name,
      model: provider.model,
      usage: data.usage,
    };
  }

  private async callDeepSeek(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`DeepSeek API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      provider: provider.name,
      model: provider.model,
      usage: data.usage,
    };
  }

  private async callOllama(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch(`${provider.endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.message.content,
      provider: provider.name,
      model: provider.model,
    };
  }

  async testConnection(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider) return false;

    try {
      const testMessages: ChatMessage[] = [
        { role: 'user', content: 'Hello' }
      ];
      await this.chat(testMessages);
      return true;
    } catch (error) {
      console.error(`Connection test failed for ${providerId}:`, error);
      return false;
    }
  }
}

export const aiGateway = new AIGateway();
