// HTTP Transport - connection to the Svetlana-home bridge on the Android phone.
// Защищённый протокол v2 (см. security/BridgeCrypto.ts): код подключения по сети не передаётся,
// каждый запрос и ответ зашифрован и подписан, повтор перехваченного запроса невозможен,
// ответ от чужого устройства в сети отклоняется. Адрес — только домашняя сеть.
import type { PlatformHands, ActionResult, ScreenCapture, AccessibilityTree, UIElement, DeviceInfo, PlatformHandsConfig, ContactsPage } from './PlatformHands';
import { BRIDGE_PROTOCOL, BAD_REPLY, deriveBridgeKey, openResponse, sealRequest, validateBridgeEndpoint } from './security/BridgeCrypto';
import { safeJsonParse, stripControl } from './security/SafeData';

const MAX_REPLY_BYTES = 20 * 1024 * 1024;
const ROUTE_RE = /^[a-z]+\/[A-Za-z]+$/;
/** Честный отказ: у телефона пока нет защищённого маршрута для снимков экрана. */
export const SCREEN_CAPTURE_UNSUPPORTED = 'Снимок экрана через мост пока не поддерживается телефоном: сделайте скриншот в Светлане на телефоне.';

interface RawReply { status: number; text: string }

function parseJson(text: string, max: number): unknown {
  try { return safeJsonParse(text, max); } catch { return null; }
}

export class HTTPHands implements PlatformHands {
  private config: PlatformHandsConfig;
  private connected = false;
  private key: CryptoKey | null = null;

  constructor(config: PlatformHandsConfig) {
    this.config = { ...config, endpoint: validateBridgeEndpoint(config.endpoint) };
  }

  private async raw(url: string, init: RequestInit): Promise<RawReply> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout || 10000);
    try {
      const response = await fetch(url, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      const text = await response.text();
      if (text.length > MAX_REPLY_BYTES) throw new Error('Слишком большой ответ телефона');
      return { status: response.status, text };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error(`Request timeout: ${url.split('/api/')[1] ?? 'health'}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async handshake(): Promise<void> {
    const r = await this.raw(`${this.config.endpoint}/health`, { method: 'GET' });
    if (r.status !== 200) throw new Error('Health check failed');
    const h = parseJson(r.text, 4096) as { service?: unknown; v?: unknown; salt?: unknown } | null;
    if (!h || h.service !== 'svetlana-home') throw new Error('По этому адресу не Svetlana-home');
    if (h.v !== BRIDGE_PROTOCOL || typeof h.salt !== 'string') {
      throw new Error('Обновите Svetlana-home на телефоне: нужна версия с защищённым подключением (протокол v2)');
    }
    this.key = await deriveBridgeKey(this.config.token ?? '', h.salt);
  }

  async connect(): Promise<void> {
    try {
      await this.handshake();
      this.connected = true;
      await this.sendRequest('device/info');
    } catch (error) {
      this.connected = false;
      this.key = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.key = null;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  private async sendRequest(method: string, params: any = {}, retried = false): Promise<any> {
    if (!this.connected || !this.key) {
      throw new Error('Not connected to Android device');
    }
    if (!ROUTE_RE.test(method)) throw new Error(`Bad method: ${method}`);

    const key = this.key;
    const { body, nonce } = await sealRequest(key, method, JSON.stringify({ params, timestamp: Date.now() }));
    const r = await this.raw(`${this.config.endpoint}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const outer = parseJson(r.text, MAX_REPLY_BYTES) as Record<string, unknown> | null;
    if (outer && outer.v === BRIDGE_PROTOCOL && typeof outer.ct === 'string') {
      const inner = parseJson(await openResponse(key, method, nonce, r.text), MAX_REPLY_BYTES) as Record<string, any> | null;
      if (!inner || typeof inner !== 'object') throw new Error(BAD_REPLY);
      if (inner.success === false) throw new Error(stripControl(String(inner.message ?? inner.error ?? `HTTP ${r.status}`)).slice(0, 300));
      return inner.data ?? inner;
    }

    if (r.status === 200) throw new Error(BAD_REPLY);
    const code = typeof outer?.error === 'string' ? outer.error : '';
    const message = stripControl(String(outer?.message ?? `HTTP ${r.status}`)).slice(0, 300);
    if (code === 'UNAUTHORIZED' && !retried) {
      await this.handshake();
      return this.sendRequest(method, params, true);
    }
    if (r.status === 401) throw new Error(message || 'Неверный код подключения');
    if (r.status === 426) throw new Error('Версии Светланы на ПК и телефоне не совпадают: обновите обе');
    throw new Error(message);
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return await this.sendRequest('device/info');
  }

  async listContacts(options: { query?: string; limit?: number; offset?: number } = {}): Promise<ContactsPage> {
    return await this.sendRequest('contacts/list', options);
  }

  async launchApp(packageName: string): Promise<ActionResult> {
    return await this.sendRequest('app/launch', { packageName });
  }

  async closeApp(packageName: string): Promise<ActionResult> {
    return await this.sendRequest('app/close', { packageName });
  }

  async getCurrentApp(): Promise<string | null> {
    const result = await this.sendRequest('app/current');
    return result.packageName || null;
  }

  async tap(x: number, y: number): Promise<ActionResult> {
    return await this.sendRequest('ui/tap', { x, y });
  }

  async tapElement(elementId: string): Promise<ActionResult> {
    const element = await this.findElementById(elementId);
    if (!element) {
      return {
        success: false,
        error: `Element not found: ${elementId}`,
        timestamp: Date.now()
      };
    }

    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;
    return await this.tap(centerX, centerY);
  }

  async longPress(x: number, y: number, duration: number = 1000): Promise<ActionResult> {
    return await this.sendRequest('ui/longPress', { x, y, duration });
  }

  async swipe(startX: number, startY: number, endX: number, endY: number, duration: number = 300): Promise<ActionResult> {
    return await this.sendRequest('ui/swipe', { startX, startY, endX, endY, duration });
  }

  async type(text: string): Promise<ActionResult> {
    return await this.sendRequest('input/type', { text });
  }

  async clearText(): Promise<ActionResult> {
    return await this.sendRequest('input/clear');
  }

  async pressKey(key: string): Promise<ActionResult> {
    return await this.sendRequest('input/key', { key });
  }

  /**
   * Снимок экрана. У Svetlana-home пока нет защищённого маршрута screen/capture (снимки делаются
   * только на самом телефоне по его политике приватности), поэтому запрос не отправляется.
   */
  async captureScreen(): Promise<ScreenCapture> {
    throw new Error(SCREEN_CAPTURE_UNSUPPORTED);
  }

  async getAccessibilityTree(): Promise<AccessibilityTree> {
    return await this.sendRequest('accessibility/tree');
  }

  async findElementByText(text: string): Promise<UIElement | null> {
    return await this.sendRequest('accessibility/findByText', { text });
  }

  async findElementById(id: string): Promise<UIElement | null> {
    return await this.sendRequest('accessibility/findById', { id });
  }

  async goHome(): Promise<ActionResult> {
    return await this.sendRequest('system/home');
  }

  async goBack(): Promise<ActionResult> {
    return await this.sendRequest('system/back');
  }

  async openRecents(): Promise<ActionResult> {
    return await this.sendRequest('system/recents');
  }
}
