const URL_KEY = 'svetlana_browser_worker_url_v1';
const TOKEN_KEY = 'svetlana_browser_worker_token_v1';

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
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
  isConfigured(): boolean { return this.getConfig() !== null; }
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const config = this.getConfig();
    if (!config) throw new Error('Browser Worker не настроен. Откройте «Браузер агента» в персональных агентах.');
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
