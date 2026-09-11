// WebSocket Transport - Real connection to Android device via MCP
import type { PlatformHands, ActionResult, ScreenCapture, AccessibilityTree, UIElement, DeviceInfo, PlatformHandsConfig } from './PlatformHands';

export class WebSocketHands implements PlatformHands {
  private ws: WebSocket | null = null;
  private config: PlatformHandsConfig;
  private requestCounter = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: number;
  }>();

  constructor(config: PlatformHandsConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.endpoint);
        
        this.ws.onopen = () => {
          console.log('[WebSocketHands] Connected to', this.config.endpoint);
          resolve();
        };

        this.ws.onerror = (error) => {
          console.error('[WebSocketHands] Connection error:', error);
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          console.log('[WebSocketHands] Connection closed');
          this.ws = null;
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  async isConnected(): Promise<boolean> {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private async sendRequest(method: string, params: any = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Android device');
    }

    const requestId = `req_${++this.requestCounter}`;
    const timeout = this.config.timeout || 10000;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${method}`));
      }, timeout);

      this.pendingRequests.set(requestId, { resolve, reject, timeout: timeoutId });

      const message = {
        jsonrpc: '2.0',
        id: requestId,
        method,
        params,
        timestamp: Date.now()
      };

      this.ws!.send(JSON.stringify(message));
    });
  }

  private handleMessage(data: string) {
    try {
      const response = JSON.parse(data);
      const { id, result, error } = response;

      const pending = this.pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(id);

        if (error) {
          pending.reject(new Error(error.message || 'Unknown error'));
        } else {
          pending.resolve(result);
        }
      }
    } catch (error) {
      console.error('[WebSocketHands] Failed to parse message:', error);
    }
  }

  // Device info
  async getDeviceInfo(): Promise<DeviceInfo> {
    return await this.sendRequest('device.getInfo');
  }

  // App control
  async launchApp(packageName: string): Promise<ActionResult> {
    return await this.sendRequest('app.launch', { packageName });
  }

  async closeApp(packageName: string): Promise<ActionResult> {
    return await this.sendRequest('app.close', { packageName });
  }

  async getCurrentApp(): Promise<string | null> {
    const result = await this.sendRequest('app.getCurrent');
    return result.packageName || null;
  }

  // UI interaction
  async tap(x: number, y: number): Promise<ActionResult> {
    return await this.sendRequest('ui.tap', { x, y });
  }

  async tapElement(elementId: string): Promise<ActionResult> {
    // First find the element to get its bounds
    const element = await this.findElementById(elementId);
    if (!element) {
      return {
        success: false,
        error: `Element not found: ${elementId}`,
        timestamp: Date.now()
      };
    }

    // Tap at the center of the element
    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;
    return await this.tap(centerX, centerY);
  }

  async longPress(x: number, y: number, duration: number = 1000): Promise<ActionResult> {
    return await this.sendRequest('ui.longPress', { x, y, duration });
  }

  async swipe(startX: number, startY: number, endX: number, endY: number, duration: number = 300): Promise<ActionResult> {
    return await this.sendRequest('ui.swipe', { startX, startY, endX, endY, duration });
  }

  // Text input
  async type(text: string): Promise<ActionResult> {
    return await this.sendRequest('input.type', { text });
  }

  async clearText(): Promise<ActionResult> {
    return await this.sendRequest('input.clear');
  }

  // Keys
  async pressKey(key: string): Promise<ActionResult> {
    return await this.sendRequest('input.key', { key });
  }

  // Screen capture
  async captureScreen(): Promise<ScreenCapture> {
    return await this.sendRequest('screen.capture');
  }

  // Accessibility
  async getAccessibilityTree(): Promise<AccessibilityTree> {
    return await this.sendRequest('accessibility.getTree');
  }

  async findElementByText(text: string): Promise<UIElement | null> {
    return await this.sendRequest('accessibility.findElementByText', { text });
  }

  async findElementById(id: string): Promise<UIElement | null> {
    return await this.sendRequest('accessibility.findElementById', { id });
  }

  // System
  async goHome(): Promise<ActionResult> {
    return await this.sendRequest('system.home');
  }

  async goBack(): Promise<ActionResult> {
    return await this.sendRequest('system.back');
  }

  async openRecents(): Promise<ActionResult> {
    return await this.sendRequest('system.recents');
  }
}
