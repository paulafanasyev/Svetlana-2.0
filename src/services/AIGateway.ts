// Real AI Gateway - connects to actual LLM providers
// Defaults to local offline provider (Ollama / Local Svetlana) on Windows/Desktop
// Безопасность: API-ключи хранятся зашифрованными (SecretStore), в localStorage — только настройки без ключей.
// В приложении для Windows ключи облачных ИИ лежат в Диспетчере учётных данных Windows и вообще не
// попадают в JavaScript: запрос в облако делает нативная часть (security/NativeBridge, src-tauri/src/secure_ai.rs).
// Адреса проверяются: локальные модели — только 127.0.0.1/localhost, облачные — только официальные адреса,
// прокси — только свой сервер. Подменённый адрес не получит ни ключ, ни переписку.
// Локальная модель при ошибке НИКОГДА не переключается на облако сама: переписка не покидает
// компьютер без явного выбора облачного провайдера пользователем (см. fallbackCandidates).
import { getSecret, setSecret } from './security/SecretStore';
import { safeJsonParse, stripControl, MAX_BYTES } from './security/SafeData';
import { isNativeApp, nativeSetSecret, nativeHasSecret, nativeCloudChat, NATIVE_KEY_PLACEHOLDER } from './security/NativeBridge';
import { stripUntrusted } from './security/Untrusted';

export interface AIProvider {
  id: string;
  name: string;
  type: 'online' | 'offline';
  endpoint: string;
  apiKey?: string;
  model: string;
  enabled: boolean;
  useProxy?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  provider: string;
  model: string;
  toolCalls?: StructuredToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StructuredToolCall {
  tool: string;
  arguments: Record<string, any>;
  requestId: string;
  timestamp: number;
}

const DEFAULT_OFFLINE_PROVIDERS: AIProvider[] = [
  {
    id: 'ollama',
    name: '★ Светлана Локальная (Ollama / Offline)',
    type: 'offline',
    endpoint: 'http://127.0.0.1:11434',
    model: 'svetlana:latest',
    enabled: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Локальный сервер)',
    type: 'offline',
    endpoint: 'http://127.0.0.1:1234',
    model: 'default',
    enabled: false,
  },
];

/** Официальные адреса облачных сервисов, у которых адрес берётся из настроек. */
const OFFICIAL_ENDPOINTS: Record<string, string[]> = {
  mistral: ['https://api.mistral.ai/v1'],
  google: ['https://generativelanguage.googleapis.com/v1beta', 'https://generativelanguage.googleapis.com/v1'],
};
const LOCAL_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/;

/** Проверка адреса провайдера. Возвращает нормализованный адрес или бросает ошибку. */
export function validateEndpoint(p: Pick<AIProvider, 'id' | 'type' | 'endpoint'>): string {
  const e = String(p.endpoint ?? '').trim().replace(/\/+$/, '');
  if (p.type === 'offline') {
    if (!LOCAL_RE.test(e)) throw new Error('Локальная модель должна работать на этом компьютере: адрес http://127.0.0.1:порт или http://localhost:порт');
    return e;
  }
  const official = OFFICIAL_ENDPOINTS[p.id];
  if (official && !official.includes(e)) throw new Error(`Для ${p.id} разрешён только официальный адрес: ${official[0]}`);
  return e;
}

/** Прокси: только свой сервер (путь вида /api/...) или локальный адрес. */
export function validateProxyUrl(url: string): string {
  const u = url.trim();
  if (/^\/[A-Za-z0-9/_-]*$/.test(u) && !u.startsWith('//')) return u;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/[A-Za-z0-9/_-]*)?$/.test(u)) return u;
  throw new Error('Прокси может быть только на своём сервере (/api/...) или на этом компьютере');
}

const FALLBACK_ORDER = ['ollama', 'lmstudio', 'groq', 'openai', 'anthropic', 'deepseek'];

/**
 * Запасные провайдеры при ошибке [failed]. Только включённые и только ТОГО ЖЕ типа:
 * локальная модель → только другая локальная (переписка не уходит в интернет),
 * облачная → другая облачная, которую пользователь сам включил.
 */
export function fallbackCandidates(all: AIProvider[], failed: Pick<AIProvider, 'id' | 'type'>): AIProvider[] {
  const byId = new Map(all.map(p => [p.id, p] as const));
  return FALLBACK_ORDER
    .map(id => byId.get(id))
    .filter((p): p is AIProvider => !!p && p.enabled && p.id !== failed.id && p.type === failed.type);
}

const secretName = (id: string) => `ai.${id}`;

function sanitizeProvider(v: unknown): AIProvider | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(r.id)) return null;
  const type = r.type === 'online' ? 'online' : 'offline';
  try {
    const endpoint = validateEndpoint({ id: r.id, type, endpoint: String(r.endpoint ?? '') });
    return {
      id: r.id, type, endpoint,
      name: stripControl(String(r.name ?? r.id)).slice(0, 100),
      model: stripControl(String(r.model ?? '')).slice(0, 100),
      enabled: r.enabled === true,
      useProxy: r.useProxy === true ? true : undefined,
      apiKey: typeof r.apiKey === 'string' && r.apiKey ? r.apiKey.slice(0, 500) : undefined,
    };
  } catch { return null; }
}

class AIGateway {
  private providers: Map<string, AIProvider> = new Map();
  private activeProvider: string | null = null;
  private proxyUrl: string | null = null;
  /** Ключи расшифровываются асинхронно при старте; запросы к ИИ ждут этого. */
  readonly ready: Promise<void>;

  constructor() {
    this.initDefaultProviders();
    this.ready = this.loadFromStorage();
  }

  private initDefaultProviders() {
    for (const p of DEFAULT_OFFLINE_PROVIDERS) {
      this.providers.set(p.id, { ...p });
    }
    this.activeProvider = 'ollama';
  }

  setProxyUrl(url: string | null) {
    this.proxyUrl = url ? validateProxyUrl(url) : null;
    if (this.proxyUrl) {
      sessionStorage.setItem('svetlana_ai_proxy', this.proxyUrl);
    } else {
      sessionStorage.removeItem('svetlana_ai_proxy');
    }
  }

  getProxyUrl(): string | null {
    if (this.proxyUrl) return this.proxyUrl;
    try {
      const s = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('svetlana_ai_proxy') : null;
      return s ? validateProxyUrl(s) : null;
    } catch { return null; }
  }

  private async loadFromStorage(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem('svetlana_ai_providers');
    if (stored) {
      try {
        const data = safeJsonParse(stored, MAX_BYTES.storage);
        let migrated = false;
        if (Array.isArray(data)) {
          for (const raw of data.slice(0, 50)) {
            const p = sanitizeProvider(raw);
            if (!p) continue;
            if (p.apiKey) { await setSecret(secretName(p.id), p.apiKey); migrated = true; } // старый открытый ключ → шифрование
            this.providers.set(p.id, p);
          }
        }
        const savedActive = localStorage.getItem('svetlana_active_provider');
        if (savedActive && this.providers.has(savedActive)) {
          this.activeProvider = savedActive;
        }
        if (migrated) this.saveToStorage();
      } catch (e) {
        console.error('Failed to load AI providers:', e);
      }
    }
    const native = isNativeApp();
    for (const p of this.providers.values()) {
      if (native) {
        // Приложение для Windows: ключ переносим в хранилище Windows и стираем из браузерного хранилища;
        // в памяти JavaScript остаётся только отметка «ключ есть».
        const name = secretName(p.id);
        const legacy = p.apiKey && p.apiKey !== NATIVE_KEY_PLACEHOLDER ? p.apiKey : await getSecret(name);
        if (legacy) {
          try { await nativeSetSecret(name, legacy); await setSecret(name, null); } catch (e) { console.error('Не удалось перенести ключ в хранилище Windows', e); }
        }
        p.apiKey = undefined;
        try { if (await nativeHasSecret(name)) p.apiKey = NATIVE_KEY_PLACEHOLDER; } catch { /* нет хранилища */ }
        continue;
      }
      if (!p.apiKey) { const k = await getSecret(secretName(p.id)); if (k) p.apiKey = k; }
    }
  }

  private saveToStorage() {
    // Ключи в localStorage не пишем никогда.
    const data = Array.from(this.providers.values()).map(({ apiKey: _k, ...rest }) => rest);
    localStorage.setItem('svetlana_ai_providers', JSON.stringify(data));
    if (this.activeProvider) {
      localStorage.setItem('svetlana_active_provider', this.activeProvider);
    }
  }

  private storeKey(p: AIProvider) {
    if (isNativeApp()) {
      // Отметка «ключ есть» из интерфейса никогда не перезаписывает настоящий ключ.
      if (p.apiKey === NATIVE_KEY_PLACEHOLDER) return;
      const value = p.apiKey ?? null;
      p.apiKey = value ? NATIVE_KEY_PLACEHOLDER : undefined;
      void nativeSetSecret(secretName(p.id), value).catch(e => console.error('Не удалось сохранить ключ в хранилище Windows', e));
      void setSecret(secretName(p.id), null);
      return;
    }
    void setSecret(secretName(p.id), p.apiKey ?? null);
  }

  addProvider(provider: AIProvider) {
    const p = sanitizeProvider(provider);
    if (!p) throw new Error('Некорректные настройки провайдера (адрес или идентификатор)');
    this.providers.set(p.id, p);
    if (p.enabled) {
      this.activeProvider = p.id;
    }
    this.storeKey(p);
    this.saveToStorage();
  }

  removeProvider(id: string) {
    this.providers.delete(id);
    void setSecret(secretName(id), null);
    if (isNativeApp()) void nativeSetSecret(secretName(id), null).catch(() => undefined);
    if (this.activeProvider === id) {
      this.activeProvider = null;
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
      const next = sanitizeProvider({ ...provider, ...updates, id });
      if (!next) throw new Error('Некорректные настройки провайдера (адрес)');
      Object.assign(provider, next);
      if (updates.enabled) {
        this.activeProvider = id;
      }
      if ('apiKey' in updates) this.storeKey(provider);
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

  async chat(messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }, providerId?: string): Promise<AIResponse> {
    await this.ready;
    const provider = providerId ? this.providers.get(providerId) : this.getActiveProvider();
    if (!provider) {
      throw new Error('No AI provider configured');
    }

    try {
      return await this.callProvider(provider, messages, options);
    } catch (error: any) {
      if (!providerId && this.providers.size > 1) {
        // Только тот же тип: локальная модель не отправляет переписку в облако молча.
        const fallbackProviders = fallbackCandidates(this.getAllProviders(), provider);
        for (const fallback of fallbackProviders) {
          try {
            console.warn(`Provider ${provider.name} failed, trying fallback: ${fallback.name}`);
            return await this.callProvider(fallback, messages, options);
          } catch (fallbackError) {
            console.error(`Fallback ${fallback.name} also failed:`, fallbackError);
            continue;
          }
        }
      }
      throw error;
    }
  }

  private async callProvider(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    // Повторная проверка адреса перед каждым запросом: объект провайдера мог быть изменён в обход updateProvider.
    validateEndpoint(provider);
    const proxy = this.getProxyUrl();
    if ((proxy || provider.useProxy) && provider.type === 'online') {
      return this.callViaProxy(proxy || '/api/ai-proxy', provider, messages, options);
    }
    // Приложение для Windows: облачный запрос делает нативная часть, ключ в JavaScript не попадает.
    if (provider.type === 'online' && isNativeApp()) {
      return this.callNative(provider, messages, options);
    }

    switch (provider.id) {
      case 'ollama':
        return this.callOllama(provider, messages, options);
      case 'lmstudio':
        return this.callLMStudio(provider, messages, options);
      case 'openai':
        return this.callOpenAI(provider, messages, options);
      case 'anthropic':
        return this.callAnthropic(provider, messages, options);
      case 'google':
        return this.callGoogle(provider, messages, options);
      case 'mistral':
        return this.callMistral(provider, messages, options);
      case 'groq':
        return this.callGroq(provider, messages, options);
      case 'openrouter':
        return this.callOpenRouter(provider, messages, options);
      case 'deepseek':
        return this.callDeepSeek(provider, messages, options);
      default:
        // Generic offline fallback
        if (provider.type === 'offline') {
          return this.callOllama(provider, messages, options);
        }
        throw new Error(`Provider ${provider.id} not implemented`);
    }
  }

  /** Облачный запрос через нативную часть Windows-приложения (без ключа в теле запроса). */
  private async callNative(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const temperature = options?.temperature ?? 0.7;
    let body: Record<string, unknown>;
    if (provider.id === 'anthropic') {
      body = { model: provider.model, max_tokens: options?.max_tokens ?? 4096, system: systemMessage?.content, messages: chatMessages, temperature };
    } else if (provider.id === 'google') {
      body = {
        contents: chatMessages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
        generationConfig: { temperature, maxOutputTokens: options?.max_tokens },
      };
    } else {
      body = { model: provider.model, messages, temperature, max_tokens: options?.max_tokens ?? 4096 };
    }
    const data: any = await nativeCloudChat(provider.id, provider.model, body);
    const content = provider.id === 'anthropic' ? data?.content?.[0]?.text
      : provider.id === 'google' ? data?.candidates?.[0]?.content?.parts?.[0]?.text
      : data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error(`${provider.name}: пустой ответ`);
    return { content, provider: provider.name, model: provider.model, usage: provider.id === 'google' ? undefined : data?.usage };
  }

  private async callViaProxy(proxyEndpoint: string, provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch(validateProxyUrl(proxyEndpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: provider.id,
        model: provider.model,
        messages,
        options,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`AI Proxy error: ${err.error || response.statusText}`);
    }

    return await response.json();
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
      throw new Error(`Локальный сервер Ollama не отвечает на ${provider.endpoint}. Запустите Ollama с моделью ${provider.model}`);
    }

    const data = await response.json();
    return {
      content: data.message?.content || '',
      provider: provider.name,
      model: provider.model,
    };
  }

  private async callLMStudio(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch(`${provider.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      provider: provider.name,
      model: provider.model,
      usage: data.usage,
    };
  }

  /** OpenAI-совместимые облачные API с фиксированным официальным адресом. */
  private async callOpenAICompatible(url: string, label: string, provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey || ''}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`${label} API error: ${error.error?.message || error.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      provider: provider.name,
      model: provider.model,
      usage: data.usage,
    };
  }

  private callOpenAI(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://api.openai.com/v1/chat/completions', 'OpenAI', provider, messages, options);
  }

  private callGroq(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', 'Groq', provider, messages, options);
  }

  private callOpenRouter(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://openrouter.ai/api/v1/chat/completions', 'OpenRouter', provider, messages, options);
  }

  private callDeepSeek(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible('https://api.deepseek.com/v1/chat/completions', 'DeepSeek', provider, messages, options);
  }

  private callMistral(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    return this.callOpenAICompatible(`${validateEndpoint(provider)}/chat/completions`, 'Mistral', provider, messages, options);
  }

  private async callAnthropic(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey || '',
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
      const error = await response.json().catch(() => ({}));
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

  private async callGoogle(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    
    const contents = chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Ключ — в заголовке, а не в адресе: адреса попадают в журналы и историю.
    const response = await fetch(
      `${validateEndpoint(provider)}/models/${encodeURIComponent(provider.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey || '' },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.max_tokens,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Google API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.candidates[0].content.parts[0].text,
      provider: provider.name,
      model: provider.model,
      usage: data.usageMetadata ? {
        prompt_tokens: data.usageMetadata.promptTokenCount,
        completion_tokens: data.usageMetadata.candidatesTokenCount,
        total_tokens: data.usageMetadata.totalTokenCount,
      } : undefined,
    };
  }

  async testConnection(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider) return false;

    try {
      const testMessages: ChatMessage[] = [
        { role: 'user', content: 'Hello' }
      ];
      await this.chat(testMessages, undefined, providerId);
      return true;
    } catch (error) {
      console.error(`Connection test failed for ${providerId}:`, error);
      return false;
    }
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: object[],
    options?: { temperature?: number; max_tokens?: number },
    providerId?: string
  ): Promise<AIResponse> {
    await this.ready;
    const provider = providerId ? this.providers.get(providerId) : this.getActiveProvider();
    if (!provider) {
      throw new Error('No AI provider configured');
    }

    const response = await this.chat(messages, options, providerId);
    const toolCalls = this.extractToolCalls(response.content);
    
    return {
      ...response,
      toolCalls,
    };
  }

  private extractToolCalls(content: string): StructuredToolCall[] {
    const toolCalls: StructuredToolCall[] = [];
    // Блоки, скопированные моделью из данных (⟦ДАННЫЕ⟧), не считаются командами.
    const jsonMatches = stripUntrusted(content).match(/```json\s*([\s\S]*?)\s*```/g);
    if (jsonMatches) {
      for (const match of jsonMatches.slice(0, 10)) {
        try {
          const json = safeJsonParse(match.replace(/```json\s*|\s*```/g, ''), 50_000) as { tool?: unknown; arguments?: unknown } | null;
          if (json && typeof json.tool === 'string' && /^[a-z0-9_]{1,60}$/.test(json.tool) && json.arguments && typeof json.arguments === 'object') {
            toolCalls.push({
              tool: json.tool,
              arguments: json.arguments as Record<string, any>,
              requestId: `tc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              timestamp: Date.now(),
            });
          }
        } catch {}
      }
    }
    return toolCalls;
  }
}

export const aiGateway = new AIGateway();
