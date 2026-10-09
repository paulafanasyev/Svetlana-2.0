// Windows Hands implementation conforming to PlatformHands contract
// Communicates with a local Windows UI Automation MCP server over localhost WebSocket/HTTP

import type {
  PlatformHands,
  DeviceInfo,
  ActionResult,
  ScreenCapture,
  AccessibilityTree,
  UIElement,
} from './PlatformHands';

export interface WindowsHandsConfig {
  endpoint?: string; // e.g. ws://127.0.0.1:8766
  authToken?: string;
  timeoutMs?: number;
}

export class WindowsHands implements PlatformHands {
  private endpoint: string;
  private authToken?: string;
  private timeoutMs: number;
  private ws: WebSocket | null = null;
  private connected: boolean = false;
  private nextId: number = 1;
  private pendingRequests: Map<number, { resolve: (res: any) => void; reject: (err: any) => void }> = new Map();

  constructor(config: WindowsHandsConfig = {}) {
    this.endpoint = config.endpoint || 'ws://127.0.0.1:8766';
    this.authToken = config.authToken;
    this.timeoutMs = config.timeoutMs || 10000;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    return new Promise<void>((resolve, reject) => {
      try {
        const url = new URL(this.endpoint);
        if (this.authToken) {
          url.searchParams.set('token', this.authToken);
        }
        this.ws = new WebSocket(url.toString());

        this.ws.onopen = () => {
          this.connected = true;
          resolve();
        };

        this.ws.onerror = (err) => {
          this.connected = false;
          reject(new Error('WebSocket connection error'));
        };

        this.ws.onclose = () => {
          this.connected = false;
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id && this.pendingRequests.has(data.id)) {
              const { resolve: reqResolve, reject: reqReject } = this.pendingRequests.get(data.id)!;
              this.pendingRequests.delete(data.id);
              if (data.error) {
                reqReject(new Error(data.error.message || 'Windows MCP error'));
              } else {
                reqResolve(data.result);
              }
            }
          } catch {
            // ignore non-json frames
          }
        };

        setTimeout(() => {
          if (!this.connected) {
            reject(new Error(`Connection timeout after 3000ms to ${this.endpoint}`));
          }
        }, 3000);
      } catch (err) {
        this.connected = false;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  private async callMcp(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const id = this.nextId++;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Windows MCP request timeout after ${this.timeoutMs}ms (${method})`));
      }, this.timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws!.send(JSON.stringify(payload));
    });
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    try {
      const res = await this.callMcp('system.getDeviceInfo');
      return {
        platform: 'windows',
        model: res?.model || 'Windows PC',
        osVersion: res?.osVersion || 'Windows 11',
        screenWidth: res?.screenWidth || 1920,
        screenHeight: res?.screenHeight || 1080,
        density: res?.density || 1.0,
      };
    } catch {
      return {
        platform: 'windows',
        model: 'Windows PC',
        osVersion: 'Windows 11',
        screenWidth: 1920,
        screenHeight: 1080,
        density: 1.0,
      };
    }
  }

  async launchApp(packageName: string): Promise<ActionResult> {
    try {
      const res = await this.callMcp('app.launch', { identifier: packageName });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async closeApp(packageName: string): Promise<ActionResult> {
    try {
      const res = await this.callMcp('app.close', { identifier: packageName });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async getCurrentApp(): Promise<string | null> {
    try {
      const res = await this.callMcp('app.getActiveWindow');
      return res?.processName || res?.windowTitle || 'desktop';
    } catch {
      return 'desktop';
    }
  }

  async tap(x: number, y: number): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.click', { x, y });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async tapElement(elementId: string): Promise<ActionResult> {
    try {
      const res = await this.callMcp('ui.clickElement', { id: elementId });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async longPress(x: number, y: number, duration: number = 800): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.longClick', { x, y, duration });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async swipe(startX: number, startY: number, endX: number, endY: number, duration: number = 300): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.drag', { startX, startY, endX, endY, duration });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async type(text: string): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.type', { text });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async clearText(): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.clearText');
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async pressKey(key: string): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.key', { key });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async goBack(): Promise<ActionResult> {
    return this.pressKey('Escape');
  }

  async goHome(): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.keyCombo', { keys: ['Meta', 'd'] });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async openRecents(): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.keyCombo', { keys: ['Alt', 'Tab'] });
      return { success: !!res?.success, data: res, timestamp: Date.now() };
    } catch (e: any) {
      return { success: false, error: e?.message, timestamp: Date.now() };
    }
  }

  async captureScreen(): Promise<ScreenCapture> {
    try {
      const res = await this.callMcp('screen.capture');
      return {
        image: res?.base64Image || '',
        width: res?.width || 1920,
        height: res?.height || 1080,
        timestamp: Date.now(),
      };
    } catch {
      return {
        image: '',
        width: 1920,
        height: 1080,
        timestamp: Date.now(),
      };
    }
  }

  async getAccessibilityTree(): Promise<AccessibilityTree> {
    try {
      const res = await this.callMcp('ui.getAutomationTree');
      return {
        root: res?.root || {
          id: 'root',
          type: 'Window',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          clickable: false,
          focusable: false,
          visible: true,
          enabled: true,
          children: [],
        },
        timestamp: Date.now(),
      };
    } catch {
      return {
        root: {
          id: 'root',
          type: 'Window',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          clickable: false,
          focusable: false,
          visible: true,
          enabled: true,
          children: [],
        },
        timestamp: Date.now(),
      };
    }
  }

  async findElementByText(text: string): Promise<UIElement | null> {
    try {
      const res = await this.callMcp('ui.findElement', { text });
      return res || null;
    } catch {
      return null;
    }
  }

  async findElementById(id: string): Promise<UIElement | null> {
    try {
      const res = await this.callMcp('ui.findElement', { automationId: id });
      return res || null;
    } catch {
      return null;
    }
  }
}
