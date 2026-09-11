// Platform Hands - Real interface for device control
// This is the contract that Android/iOS/Windows/macOS implementations must fulfill

export interface PlatformHands {
  // Device info
  getDeviceInfo(): Promise<DeviceInfo>;
  
  // App control
  launchApp(packageName: string): Promise<ActionResult>;
  closeApp(packageName: string): Promise<ActionResult>;
  getCurrentApp(): Promise<string | null>;
  
  // UI interaction
  tap(x: number, y: number): Promise<ActionResult>;
  tapElement(elementId: string): Promise<ActionResult>;
  longPress(x: number, y: number, duration?: number): Promise<ActionResult>;
  swipe(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<ActionResult>;
  
  // Text input
  type(text: string): Promise<ActionResult>;
  clearText(): Promise<ActionResult>;
  
  // Keys
  pressKey(key: string): Promise<ActionResult>;
  
  // Screen capture
  captureScreen(): Promise<ScreenCapture>;
  
  // Accessibility
  getAccessibilityTree(): Promise<AccessibilityTree>;
  findElementByText(text: string): Promise<UIElement | null>;
  findElementById(id: string): Promise<UIElement | null>;
  
  // System
  goHome(): Promise<ActionResult>;
  goBack(): Promise<ActionResult>;
  openRecents(): Promise<ActionResult>;
  
  // Connection
  isConnected(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface DeviceInfo {
  platform: 'android' | 'ios' | 'windows' | 'macos';
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
  image: string; // base64
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
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  clickable: boolean;
  focusable: boolean;
  visible: boolean;
  enabled: boolean;
  children?: UIElement[];
}

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface PlatformHandsConfig {
  transport: 'websocket' | 'http' | 'mock';
  endpoint: string;
  timeout?: number;
  reconnect?: boolean;
}
