// HTTP Transport - Alternative connection to Android device
import type { PlatformHands, ActionResult, ScreenCapture, AccessibilityTree, UIElement, DeviceInfo, PlatformHandsConfig } from './PlatformHands';

export class HTTPHands implements PlatformHands {
  private config: PlatformHandsConfig;
  private connected = false;

  constructor(config: PlatformHandsConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        this.connected = true;
        console.log('[HTTPHands] Connected to', this.config.endpoint);
      } else {
        throw new Error('Health check failed');
      }
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  private async sendRequest(method: string, params: any = {}): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected to Android device');
    }

    const timeout = this.config.timeout || 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.config.endpoint}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params,
          timestamp: Date.now()
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.data || result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout: ${method}`);
      }
      throw error;
    }
  }

  // Device info
  async getDeviceInfo(): Promise<DeviceInfo> {
    return await this.sendRequest('device/info');
  }

  // App control
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

  // UI interaction
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

  // Text input
  async type(text: string): Promise<ActionResult> {
    return await this.sendRequest('input/type', { text });
  }

  async clearText(): Promise<ActionResult> {
    return await this.sendRequest('input/clear');
  }

  // Keys
  async pressKey(key: string): Promise<ActionResult> {
    return await this.sendRequest('input/key', { key });
  }

  // Screen capture
  async captureScreen(): Promise<ScreenCapture> {
    return await this.sendRequest('screen/capture');
  }

  // Accessibility
  async getAccessibilityTree(): Promise<AccessibilityTree> {
    return await this.sendRequest('accessibility/tree');
  }

  async findElementByText(text: string): Promise<UIElement | null> {
    return await this.sendRequest('accessibility/findByText', { text });
  }

  async findElementById(id: string): Promise<UIElement | null> {
    return await this.sendRequest('accessibility/findById', { id });
  }

  // System
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
