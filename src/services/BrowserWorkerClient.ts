const URL_KEY = 'svetlana_browser_worker_url_v1';
const TOKEN_KEY = 'svetlana_browser_worker_token_v1';

type NativeBridge = {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};
type SvetlanaWindow = Window & {
  __TAURI_INTERNALS__?: NativeBridge;
  __SVETLANA_PLATFORM__?: string;
};

function appWindow(): SvetlanaWindow | null {
  try { return typeof window !== 'undefined' ? window as SvetlanaWindow : null; } catch { return null; }
}
function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function nativeInvoke(): NativeBridge['invoke'] | null {
  const bridge = appWindow()?.__TAURI_INTERNALS__;
  return typeof bridge?.invoke === 'function' ? bridge.invoke.bind(bridge) : null;
}
function normalizeLoopbackEndpoint(input: string): string {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new Error('Browser Worker должен работать только на этом устройстве (localhost/127.0.0.1).');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Разрешены только HTTP/HTTPS.');
  return url.origin;
}
export interface BrowserWorkerConfig { endpoint: string; token: string }
export interface BrowserObservation { url: string; title: string; aria: string; text: string; timestamp: number }

class BrowserWorkerClient {
  /** Native Android and packaged Tauri builds manage their own browser runtime. */
  usesNativeRuntime(): boolean {
    const w = appWindow();
    return w?.__SVETLANA_PLATFORM__ === 'android' || typeof w?.__TAURI_INTERNALS__?.invoke === 'function';
  }

  getConfig(): BrowserWorkerConfig | null {
    const s = storage();
    if (!s) return null;
    try {
      const endpoint = s.getItem(URL_KEY) || '';
      const token = s.getItem(TOKEN_KEY) || '';
      if (!endpoint || token.length < 32) return null;
      return { endpoint: normalizeLoopbackEndpoint(endpoint), token };
    } catch { return null; }
  }

  saveConfig(endpoint: string, token: string): void {
    const s = storage();
    if (!s) throw new Error('Локальное хранилище недоступно.');
    const normalized = normalizeLoopbackEndpoint(endpoint.trim());
    if (token.trim().length < 32) throw new Error('Токен должен содержать не менее 32 символов.');
    s.setItem(URL_KEY, normalized);
    s.setItem(TOKEN_KEY, token.trim());
  }

  clearConfig(): void {
    const s = storage();
    s?.removeItem(URL_KEY);
    s?.removeItem(TOKEN_KEY);
  }

  isConfigured(): boolean {
    const w = appWindow();
    if (w?.__SVETLANA_PLATFORM__ === 'android' || typeof w?.__TAURI_INTERNALS__?.invoke === 'function') return true;
    return this.getConfig() !== null;
  }

  private async nativeAndroidRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
    const invoke = nativeInvoke();
    if (!invoke) throw new Error('Нативный мост Android недоступен.');
    if (path === '/v1/status') {
      return await invoke('browser_worker_status') as T;
    }
    if (method === 'POST' && path === '/v1/sessions') {
      return await invoke('browser_create_session', (body || {}) as Record<string, unknown>) as T;
    }
    const match = path.match(/^\/v1\/sessions\/([^/]+)(?:\/(navigate|snapshot|click|fill|wait|screenshot))?$/);
    if (!match) throw new Error('Неизвестная команда встроенного браузера.');
    const sessionId = decodeURIComponent(match[1]);
    const action = match[2];
    if (method === 'DELETE' && !action) {
      return await invoke('browser_close_session', { sessionId }) as T;
    }
    if (method !== 'POST' || !action) throw new Error('Недопустимый метод браузерной команды.');
    const commandByAction: Record<string, string> = {
      navigate: 'browser_navigate', snapshot: 'browser_snapshot', click: 'browser_click',
      fill: 'browser_fill', wait: 'browser_wait', screenshot: 'browser_screenshot',
    };
    return await invoke(commandByAction[action], { sessionId, ...((body || {}) as Record<string, unknown>) }) as T;
  }

  private async desktopConfig(): Promise<BrowserWorkerConfig> {
    const invoke = nativeInvoke();
    if (!invoke) throw new Error('Нативный запуск Browser Worker недоступен.');
    const value = await invoke('browser_worker_config') as Partial<BrowserWorkerConfig>;
    if (!value || typeof value.endpoint !== 'string' || typeof value.token !== 'string' || value.token.length < 32) {
      throw new Error('Приложение не смогло запустить встроенный браузерный runtime.');
    }
    return { endpoint: normalizeLoopbackEndpoint(value.endpoint), token: value.token };
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const w = appWindow();
    if (w?.__SVETLANA_PLATFORM__ === 'android') {
      return this.nativeAndroidRequest<T>(path, method, body);
    }

    const config = typeof w?.__TAURI_INTERNALS__?.invoke === 'function'
      ? await this.desktopConfig()
      : this.getConfig();
    if (!config) throw new Error('Browser Worker не настроен. В веб-версии настройте локальный браузерный сервис; установленные приложения запускают runtime автоматически.');

    const response = await fetch(config.endpoint + path, {
      method,
      headers: { authorization: 'Bearer ' + config.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Browser Worker HTTP ' + response.status);
    return data as T;
  }

  async testConnection(): Promise<{ ok: boolean; service: string }> {
    return this.request('/v1/status');
  }
  async createSession(agentId: string): Promise<{ sessionId: string; agentId: string; isolated: boolean }> {
    return this.request('/v1/sessions', 'POST', { agentId });
  }
  async navigate(sessionId: string, url: string): Promise<{ success: boolean; observation: BrowserObservation }> {
    return this.request('/v1/sessions/' + encodeURIComponent(sessionId) + '/navigate', 'POST', { url });
  }
  async snapshot(sessionId: string): Promise<{ success: boolean; observation: BrowserObservation }> {
    return this.request('/v1/sessions/' + encodeURIComponent(sessionId) + '/snapshot', 'POST', {});
  }
  async click(sessionId: string, role: string, name: string): Promise<{ success: boolean; observation: BrowserObservation }> {
    return this.request('/v1/sessions/' + encodeURIComponent(sessionId) + '/click', 'POST', { role, name });
  }
  async fill(sessionId: string, role: string, name: string, value: string): Promise<{ success: boolean; observation: BrowserObservation }> {
    return this.request('/v1/sessions/' + encodeURIComponent(sessionId) + '/fill', 'POST', { role, name, value });
  }
  async wait(sessionId: string, ms: number): Promise<{ success: boolean; observation: BrowserObservation }> {
    return this.request('/v1/sessions/' + encodeURIComponent(sessionId) + '/wait', 'POST', { ms });
  }
  async screenshot(sessionId: string): Promise<{ success: boolean; mimeType: string; base64: string; url: string }> {
    return this.request('/v1/sessions/' + encodeURIComponent(sessionId) + '/screenshot', 'POST', {});
  }
  async closeSession(sessionId: string): Promise<{ closed: boolean }> {
    return this.request('/v1/sessions/' + encodeURIComponent(sessionId), 'DELETE');
  }
}
export const browserWorkerClient = new BrowserWorkerClient();
