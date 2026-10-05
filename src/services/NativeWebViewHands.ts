import type {
  PlatformHands,
  PlatformHandsConfig,
  DeviceInfo,
  ActionResult,
  ScreenCapture,
  AccessibilityTree,
  UIElement,
} from './PlatformHands';

interface NativeBridge {
  getAccessibilityTree?: () => string;
  captureScreen?: () => string;
  tapAt?: (x: number, y: number) => string;
  tapByText?: (text: string) => string;
  tapByResourceId?: (id: string) => string;
  longPressAt?: (x: number, y: number, duration?: number) => string;
  longPressByText?: (text: string) => string;
  swipe?: (x1: number, y1: number, x2: number, y2: number, duration?: number) => string;
  typeFocusedText?: (text: string) => string;
  typeText?: (field: string, text: string) => string;
  clearText?: () => string;
  pressKey?: (key: string) => string;
  pressBack?: () => string;
  pressHome?: () => string;
  pressRecentApps?: () => string;
  openApp?: (packageName: string) => string;
  isAccessibilityAvailable?: () => boolean;
}

export class NativeWebViewHands implements PlatformHands {
  private readonly bridge: NativeBridge;

  constructor(_config: PlatformHandsConfig) {
    if (typeof window === 'undefined') {
      throw new Error('NativeWebViewHands is only available in a WebView');
    }

    const bridge = (window as any).HandsBridge as NativeBridge | undefined;
    if (!bridge) {
      throw new Error('HandsBridge is not available in this WebView');
    }

    this.bridge = bridge;
  }

  async connect(): Promise<void> {
    if (this.bridge.isAccessibilityAvailable &&
        !this.bridge.isAccessibilityAvailable()) {
      throw new Error('Svetlana AccessibilityService is not connected');
    }
  }

  async disconnect(): Promise<void> {}

  async isConnected(): Promise<boolean> {
    return this.bridge.isAccessibilityAvailable
      ? this.bridge.isAccessibilityAvailable()
      : !!this.bridge.getAccessibilityTree;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      platform: 'android',
      model: 'webview',
      osVersion: navigator.userAgent,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      density: window.devicePixelRatio || 1,
    };
  }

  async launchApp(packageName: string): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.openApp) throw new Error('openApp unavailable');
      return this.bridge.openApp(packageName);
    });
  }

  async closeApp(_packageName: string): Promise<ActionResult> {
    return {
      success: false,
      executed: false,
      verified: false,
      error: 'Direct app close is not exposed by Android AccessibilityService',
      timestamp: Date.now(),
    };
  }

  async getCurrentApp(): Promise<string | null> {
    const tree = await this.getAccessibilityTree();
    return tree.packageName || null;
  }

  async tap(x: number, y: number): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.tapAt) throw new Error('tapAt unavailable');
      return this.bridge.tapAt(x, y);
    });
  }

  async tapElement(elementId: string): Promise<ActionResult> {
    const element = await this.findElementById(elementId);
    if (!element) {
      return { success: false, executed: false, verified: false, error: 'Element not found: ' + elementId, timestamp: Date.now() };
    }
    return this.tap(
      element.bounds.x + element.bounds.width / 2,
      element.bounds.y + element.bounds.height / 2,
    );
  }

  async longPress(x: number, y: number, duration = 1000): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.longPressAt) throw new Error('longPressAt unavailable');
      return this.bridge.longPressAt(x, y, duration);
    });
  }

  async swipe(startX: number, startY: number, endX: number, endY: number, duration = 500): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.swipe) throw new Error('swipe unavailable');
      return this.bridge.swipe(startX, startY, endX, endY, duration);
    });
  }

  async type(text: string): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.typeFocusedText) throw new Error('typeFocusedText unavailable');
      return this.bridge.typeFocusedText(text);
    });
  }

  async clearText(): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.clearText) throw new Error('clearText unavailable');
      return this.bridge.clearText();
    });
  }

  async pressKey(key: string): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.pressKey) throw new Error('pressKey unavailable');
      return this.bridge.pressKey(key);
    });
  }

  async captureScreen(): Promise<ScreenCapture> {
    if (!this.bridge.captureScreen) {
      throw new Error('Native screenshot unavailable');
    }
    const parsed = JSON.parse(this.bridge.captureScreen());
    if (!parsed.success || !parsed.image) {
      throw new Error(parsed.error || 'Native screenshot failed');
    }
    return {
      image: parsed.image,
      width: Number(parsed.width || window.innerWidth),
      height: Number(parsed.height || window.innerHeight),
      timestamp: Number(parsed.timestamp || Date.now()),
    };
  }

  async getAccessibilityTree(): Promise<AccessibilityTree> {
    if (!this.bridge.getAccessibilityTree) {
      throw new Error('Native accessibility tree unavailable');
    }
    const parsed = JSON.parse(this.bridge.getAccessibilityTree());
    const packageName = String(parsed.package || '');
    const convert = (node: any): UIElement => ({
      id: String(node.id || ''),
      type: String(node.className || 'unknown'),
      text: node.text ? String(node.text) : undefined,
      contentDescription: node.contentDescription ? String(node.contentDescription) : undefined,
      resourceId: node.resourceId ? String(node.resourceId) : undefined,
      bounds: {
        x: Number(node.bounds?.left || 0),
        y: Number(node.bounds?.top || 0),
        width: Math.max(0, Number(node.bounds?.right || 0) - Number(node.bounds?.left || 0)),
        height: Math.max(0, Number(node.bounds?.bottom || 0) - Number(node.bounds?.top || 0)),
      },
      clickable: node.clickable === true,
      focusable: node.focused === true,
      editable: node.editable === true,
      selected: node.selected === true,
      focused: node.focused === true,
      scrollable: node.scrollable === true,
      visible: node.visible !== false,
      enabled: node.enabled !== false,
      children: Array.isArray(node.children) ? node.children.map(convert) : undefined,
    });

    const children = Array.isArray(parsed?.root?.children)
      ? parsed.root.children.map(convert)
      : [];

    return {
      root: {
        id: 'root',
        type: 'android.accessibility.Root',
        packageName,
        text: undefined,
        bounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        clickable: false,
        focusable: false,
        visible: true,
        enabled: true,
        children,
      } as UIElement & { packageName?: string },
      timestamp: Number(parsed.timestamp || Date.now()),
      generation: Number(parsed.generation || 0),
      packageName,
    };
  }

  async findElementByText(text: string): Promise<UIElement | null> {
    const tree = await this.getAccessibilityTree();
    return this.walk(tree.root, element =>
      String(element.text || '').toLowerCase().includes(text.toLowerCase()) ||
      String(element.contentDescription || '').toLowerCase().includes(text.toLowerCase())
    );
  }

  async findElementById(id: string): Promise<UIElement | null> {
    const tree = await this.getAccessibilityTree();
    return this.walk(tree.root, element => element.id === id || element.resourceId === id);
  }

  async goHome(): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.pressHome) throw new Error('pressHome unavailable');
      return this.bridge.pressHome();
    });
  }

  async goBack(): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.pressBack) throw new Error('pressBack unavailable');
      return this.bridge.pressBack();
    });
  }

  async openRecents(): Promise<ActionResult> {
    return this.action(() => {
      if (!this.bridge.pressRecentApps) throw new Error('pressRecentApps unavailable');
      return this.bridge.pressRecentApps();
    });
  }

  private action(fn: () => string): ActionResult {
    try {
      const parsed = JSON.parse(fn());
      return {
        success: parsed.success === true,
        executed: parsed.executed === true || parsed.success === true,
        verified: parsed.verified === true,
        actionId: parsed.actionId,
        error: parsed.error,
        data: parsed,
        timestamp: Number(parsed.timestamp || Date.now()),
      };
    } catch (error) {
      return {
        success: false,
        executed: false,
        verified: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  private walk(root: UIElement, predicate: (element: UIElement) => boolean): UIElement | null {
    if (predicate(root)) return root;
    for (const child of root.children || []) {
      const found = this.walk(child, predicate);
      if (found) return found;
    }
    return null;
  }
}
