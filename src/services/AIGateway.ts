// Real AI Gateway - connects to actual LLM providers
// Defaults to local offline provider (Ollama / Local Svetlana) on Windows/Desktop
// Безопасность: API-ключи хранятся зашифрованными (SecretStore), в localStorage — только настройки без ключей.
// В приложении для Windows ключи облачных ИИ лежат в Диспетчере учётных данных Windows и вообще не
// попадают в JavaScript: запрос в облако делает нативная часть (security/NativeBridge, src-tauri/src/secure_ai.rs).
// В приложении для Android то же самое делает SecureAi.kt (Android Keystore). В обоих приложениях облако —
// ТОЛЬКО через нативную часть (сторонний прокси не используется): окно подтверждения не обойти.
// На телефоне локальные модели компьютера (127.0.0.1) не вызываются вообще.
// Адреса проверяются: локальные модели — только 127.0.0.1/localhost, облачные — только официальные адреса,
// прокси — только свой сервер. Подменённый адрес не получит ни ключ, ни переписку.
// Локальная модель при ошибке НИКОГДА не переключается на облако сама: переписка не покидает
// компьютер без явного выбора облачного провайдера пользователем (см. fallbackCandidates).
// Вызовы инструментов от модели проходят строгую проверку по схеме инструмента (security/ToolCallSchema).
// «★ Светлана Сервер» (id 'svetlana') — единая Светлана на мир-самозанятых.рф в полном режиме (см. SvetlanaCore).
// Запись ключа асинхронна (в Windows — после окна подтверждения): addProvider/updateProvider/removeProvider возвращают
// промис, и проверку соединения нужно делать только после него.
import { getSecret, setSecret } from './security/SecretStore';
import { safeJsonParse, stripControl, MAX_BYTES } from './security/SafeData';
import { isNativeApp, nativeSetSecret, nativeHasSecret, nativeCloudChat, NATIVE_KEY_PLACEHOLDER } from './security/NativeBridge';
import { stripUntrusted } from './security/Untrusted';
import { validateToolCalls } from './security/ToolCallSchema';
import { SVETLANA_CORE_ORIGIN, SVETLANA_CORE_MODEL, toSvetlanaCoreBody, contentOf, callSvetlanaCoreWeb } from './SvetlanaCore';
import { isAndroidApp } from '../platform';

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

/** На телефоне локальные модели компьютера не вызываются: переписка не уходит на 127.0.0.1 телефона. */
export const OFFLINE_NOT_ON_ANDROID = 'На телефоне локальные модели компьютера не работают: нажмите «Настройка» и подключите «★ Светлана Сервер» или облачный ИИ.';

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
  svetlana: [SVETLANA_CORE_ORIGIN],
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

const FALLBACK_ORDER = ['ollama', 'lmstudio', 'svetlana', 'groq', 'openai', 'anthropic', 'deepseek'];

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
      // У единой Светланы одна «модель» — профиль полного режима.
      model: r.id === 'svetlana' ? SVETLANA_CORE_MODEL : stripControl(String(r.model ?? '')).slice(0, 100),
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
    // На телефоне локальная модель компьютера по умолчанию не выбирается.
    this.activeProvider = isAndroidApp() ? null : 'ollama';
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
        // Приложение (Windows или Android): ключ переносим в хранилище системы и стираем из браузерного хранилища;
        // в памяти JavaScript остаётся только отметка «ключ есть».
        const name = secretName(p.id);
        const legacy = p.apiKey && p.apiKey !== NATIVE_KEY_PLACEHOLDER ? p.apiKey : await getSecret(name);
        if (legacy) {
          try { await nativeSetSecret(name, legacy); await setSecret(name, null); } catch (e) { console.error('Не удалось перенести ключ в хранилище приложения', e); }
        }
        p.apiKey = undefined;
        try { if (await nativeHasSecret(name)) p.apiKey = NATIVE_KEY_PLACEHOLDER; } catch { /* нет хранилища */ }
        continue;
      }
      if (!p.apiKey) { const k = await getSecret(secretName(p.id)); if (k) p.apiKey = k; }
    }
    if (isAndroidApp()) this.dropOfflineOnAndroid();
  }

  /** Телефон: если активна локальная модель компьютера — берём первый включённый облачный с ключом, иначе «не выбран». */
  private dropOfflineOnAndroid() {
    const cur = this.getActiveProvider();
    if (cur && cur.type !== 'offline') return;
    const order = ['svetlana', ...FALLBACK_ORDER];
    const online = [...this.providers.values()].filter(p => p.type === 'online' && p.enabled && !!p.apiKey);
    online.sort((a, b) => (order.indexOf(a.id) + 100) % 100 - (order.indexOf(b.id) + 100) % 100);
    this.activeProvider = online[0]?.id ?? null;
  }

  private saveToStorage() {
    // Ключи в localStorage не пишем никогда.
    const data = Array.from(this.providers.values()).map(({ apiKey: _k, ...rest }) => rest);
    localStorage.setItem('svetlana_ai_providers', JSON.stringify(data));
    if (this.activeProvider) {
      localStorage.setItem('svetlana_active_provider', this.activeProvider);
    }
  }

  /** Записать ключ провайдера. Промис завершается, когда ключ реально записан (или с ошибкой). */
  private storeKey(p: AIProvider): Promise<void> {
    const name = secretName(p.id);
    if (isNativeApp()) {
      // Отметка «ключ есть» из интерфейса никогда не перезаписывает настоящий ключ.
      if (p.apiKey === NATIVE_KEY_PLACEHOLDER) return Promise.resolve();
      const value = p.apiKey ?? null;
      p.apiKey = value ? NATIVE_KEY_PLACEHOLDER : undefined;
      void setSecret(name, null);
      return nativeSetSecret(name, value).catch(async (e) => {
        console.error('Не удалось сохранить ключ в хранилище приложения', e);
        // Отметка должна совпадать с хранилищем (например, пользователь нажал «Отмена» в окне подтверждения).
        try { p.apiKey = (await nativeHasSecret(name)) ? NATIVE_KEY_PLACEHOLDER : undefined; } catch { p.apiKey = undefined; }
        throw e;
      });
    }
    return Promise.resolve(setSecret(name, p.apiKey ?? null)).then(() => undefined);
  }

  /** Добавить провайдера. Дождитесь промиса перед проверкой соединения: ключ записывается асинхронно. */
  addProvider(provider: AIProvider): Promise<void> {
    const p = sanitizeProvider(provider);
    if (!p) throw new Error('Некорректные настройки провайдера (адрес или идентификатор)');
    this.providers.set(p.id, p);
    if (p.enabled) {
      this.activeProvider = p.id;
    }
    const saved = this.storeKey(p);
    this.saveToStorage();
    return saved;
  }

  removeProvider(id: string): Promise<void> {
    this.providers.delete(id);
    const jobs: Promise<unknown>[] = [Promise.resolve(setSecret(secretName(id), null))];
    if (isNativeApp()) jobs.push(nativeSetSecret(secretName(id), null));
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
    return Promise.all(jobs).then(() => undefined);
  }

  updateProvider(id: string, updates: Partial<AIProvider>): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) return Promise.resolve();
    const next = sanitizeProvider({ ...provider, ...updates, id });
    if (!next) throw new Error('Некорректные настройки провайдера (адрес)');
    Object.assign(provider, next);
    if (updates.enabled) {
      this.activeProvider = id;
    }
    const saved = 'apiKey' in updates ? this.storeKey(provider) : Promise.resolve();
    this.saveToStorage();
    return saved;
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
      throw new Error('ИИ не настроен: откройте «Настройка» или «Модели ИИ»');
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
    // Телефон: локальные модели компьютера не вызываем вообще (до любого fetch).
    if (provider.type === 'offline' && isAndroidApp()) throw new Error(OFFLINE_NOT_ON_ANDROID);
    // Повторная проверка адреса перед каждым запросом: объект провайдера мог быть изменён в обход updateProvider.
    validateEndpoint(provider);
    // Единая Светлана: всегда напрямую на свой сервер (без стороннего прокси), в приложениях — через нативную часть.
    if (provider.id === 'svetlana') {
      return isNativeApp() ? this.callNative(provider, messages, options) : this.callSvetlanaCore(provider, messages);
    }
    // Приложения (Windows и Android): облачный запрос делает нативная часть, ключ в JavaScript не попадает.
    // Прокси в приложениях не используется: иначе переписка ушла бы мимо окна подтверждения.
    if (provider.type === 'online' && isNativeApp()) {
      return this.callNative(provider, messages, options);
    }
    const proxy = this.getProxyUrl();
    if ((proxy || provider.useProxy) && provider.type === 'online') {
      return this.callViaProxy(proxy || '/api/ai-proxy', provider, messages, options);
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

  /** Единая Светлана из веб-версии (в приложениях — callNative). */
  private async callSvetlanaCore(provider: AIProvider, messages: ChatMessage[]): Promise<AIResponse> {
    const content = await callSvetlanaCoreWeb(provider.apiKey || '', toSvetlanaCoreBody(messages));
    return { content, provider: provider.name, model: provider.model };
  }

  /** Облачный запрос через нативную часть приложения (без ключа в теле запроса). */
  private async callNative(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const temperature = options?.temperature ?? 0.7;
    let body: Record<string, unknown>;
    if (provider.id === 'svetlana') {
      body = { ...toSvetlanaCoreBody(messages) };
    } else if (provider.id === 'anthropic') {
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
    if (provider.id === 'svetlana') {
      return { content: contentOf(data), provider: provider.name, model: provider.model };
    }
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
    let response: Response;
    try {
      response = await fetch(`${provider.endpoint}/api/chat`, {
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
    } catch {
      throw new Error(`Ollama не запущена на ${provider.endpoint}. Установите её (ollama.com/download) или выберите другой ИИ в «Настройке».`);
    }

    if (!response.ok) {
      throw new Error(response.status === 404
        ? `В Ollama нет модели ${provider.model}. Скачайте её (ollama pull ${provider.model}) или выберите другую в «Настройке».`
        : `Локальный сервер Ollama ответил ошибкой ${response.status} на ${provider.endpoint}.`);
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
        { role: 'user', content: 'Привет! Это проверка связи.' }
      ];
      await this.chat(testMessages, { max_tokens: 50 }, providerId);
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
      throw new Error('ИИ не настроен: откройте «Настройка» или «Модели ИИ»');
    }

    const response = await this.chat(messages, options, providerId);
    // Только инструменты из этого запроса и только аргументы, точно совпадающие со схемой.
    const toolCalls = validateToolCalls(this.extractToolCalls(response.content), tools);
    
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
          if (json && typeof json.tool === 'string' && /^[a-z0-9_]{1,60}$/.test(json.tool) && json.arguments && typeof json.arguments === 'object' && !Array.isArray(json.arguments)) {
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
