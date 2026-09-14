// Local Android Hands contract.
// The only supported execution backend is the Android AccessibilityService on the same phone.
// Network transports and remote-device endpoints are intentionally not part of this contract.

export interface PlatformHands {
  getDeviceInfo(): Promise<DeviceInfo>;
  launchApp(packageName: string): Promise<ActionResult>;
  closeApp(packageName: string): Promise<ActionResult>;
  getCurrentApp(): Promise<string | null>;
  tap(x: number, y: number): Promise<ActionResult>;
  tapElement(elementId: string): Promise<ActionResult>;
  longPress(x: number, y: number, duration?: number): Promise<ActionResult>;
  swipe(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<ActionResult>;
  type(text: string): Promise<ActionResult>;
  clearText(): Promise<ActionResult>;
  pressKey(key: string): Promise<ActionResult>;
  captureScreen(): Promise<ScreenCapture>;
  getAccessibilityTree(): Promise<AccessibilityTree>;
  findElementByText(text: string): Promise<UIElement | null>;
  findElementById(id: string): Promise<UIElement | null>;
  goHome(): Promise<ActionResult>;
  goBack(): Promise<ActionResult>;
  openRecents(): Promise<ActionResult>;
  isConnected(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface DeviceInfo {
  platform: 'android';
  model: string;
  osVersion: string;
  screenWidth: number;
  screenHeight: number;
  density: number;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  data?: any;
  timestamp: number;
}

export interface ScreenCapture {
  image: string;
  width: number;
  height: number;
  timestamp: number;
}

export interface AccessibilityTree {
  root: UIElement;
  timestamp: number;
}

export interface UIElement {
  id: string;
  type: string;
  text?: string;
  contentDescription?: string;
  bounds: { x: number; y: number; width: number; height: number };
  clickable: boolean;
  focusable: boolean;
  visible: boolean;
  enabled: boolean;
  children?: UIElement[];
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface PlatformHandsConfig {
  timeout?: number;
  reconnect?: boolean;
}
