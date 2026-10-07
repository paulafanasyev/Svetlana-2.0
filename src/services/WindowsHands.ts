// Windows Hands implementation conforming to PlatformHands contract
// Communicates with a local Windows UI Automation MCP server over localhost WebSocket/HTTP

import type { PlatformHands, ActionResult, Observation, ElementBounds, ElementInfo } from './PlatformHands';

export interface WindowsHandsConfig {
  endpoint?: string; // e.g. ws://127.0.0.1:8766
  authToken?: string;
  timeoutMs?: number;
}

export class WindowsHands implements PlatformHands {
  readonly platform = 'windows' as const;
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

  async connect(): Promise<boolean> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }
    return new Promise<boolean>((resolve) => {
      try {
        const url = new URL(this.endpoint);
        if (this.authToken) {
          url.searchParams.set('token', this.authToken);
        }
        this.ws = new WebSocket(url.toString());

        this.ws.onopen = () => {
          this.connected = true;
          resolve(true);
        };

        this.ws.onerror = () => {
          this.connected = false;
          resolve(false);
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
          if (!this.connected) resolve(false);
        }, 3000);
      } catch {
        this.connected = false;
        resolve(false);
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
      const ok = await this.connect();
      if (!ok) throw new Error('Windows MCP server is not reachable on ' + this.endpoint);
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

  async launchApp(appIdentifier: string): Promise<ActionResult> {
    try {
      const res = await this.callMcp('app.launch', { identifier: appIdentifier });
      return { success: !!res?.success, data: res };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async getCurrentApp(): Promise<string> {
    try {
      const res = await this.callMcp('app.getActiveWindow');
      return res?.processName || res?.windowTitle || 'desktop';
    } catch {
      return 'desktop';
    }
  }

  async tap(bounds: ElementBounds): Promise<ActionResult> {
    try {
      const x = Math.round(bounds.x + bounds.width / 2);
      const y = Math.round(bounds.y + bounds.height / 2);
      const res = await this.callMcp('input.click', { x, y });
      return { success: !!res?.success, data: res };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async type(text: string): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.type', { text });
      return { success: !!res?.success, data: res };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async clearText(): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.clearText');
      return { success: !!res?.success, data: res };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async swipe(direction: 'up' | 'down' | 'left' | 'right'): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.scroll', { direction });
      return { success: !!res?.success, data: res };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async pressBack(): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.key', { key: 'Escape' });
      return { success: !!res?.success, data: res };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async pressHome(): Promise<ActionResult> {
    try {
      const res = await this.callMcp('input.keyCombo', { keys: ['Meta', 'd'] });
      return { success: !!res?.success, data: res };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async getAccessibilityTree(): Promise<Observation> {
    try {
      const res = await this.callMcp('ui.getAutomationTree');
      return res || { root: { children: [] } };
    } catch {
      return { root: { children: [] } };
    }
  }

  async findElementByText(text: string): Promise<ElementInfo | null> {
    try {
      const res = await this.callMcp('ui.findElement', { text });
      if (!res || !res.bounds) return null;
      return res;
    } catch {
      return null;
    }
  }

  async findElementById(id: string): Promise<ElementInfo | null> {
    try {
      const res = await this.callMcp('ui.findElement', { automationId: id });
      if (!res || !res.bounds) return null;
      return res;
    } catch {
      return null;
    }
  }

  async takeScreenshot(): Promise<string> {
    try {
      const res = await this.callMcp('screen.capture');
      return res?.base64Image || '';
    } catch {
      return '';
    }
  }
}
