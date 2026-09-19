import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HandsManager } from '../services/HandsManager';
import { NativeWebViewHands } from '../services/NativeWebViewHands';

function response(payload: any): string {
  return JSON.stringify({
    success: true,
    executed: true,
    verified: false,
    actionId: 'test-action',
    timestamp: 123,
    ...payload,
  });
}

describe('NativeWebViewHands', () => {
  const originalWindow = (globalThis as any).window;
  const originalNavigator = (globalThis as any).navigator;

  beforeEach(() => {
    const bridge = {
      isAccessibilityAvailable: vi.fn(() => true),
      getAccessibilityTree: vi.fn(() => JSON.stringify({
        package: 'com.example.test',
        generation: 7,
        timestamp: 123,
        root: {
          children: [{
            id: 'button-1',
            text: 'Кнопка',
            className: 'android.widget.Button',
            clickable: true,
            editable: false,
            enabled: true,
            focused: false,
            selected: false,
            scrollable: false,
            visible: true,
            bounds: { left: 10, top: 20, right: 110, bottom: 60 },
            children: [],
          }],
        },
      })),
      tapAt: vi.fn(() => response({})),
      tapByText: vi.fn(() => response({})),
      tapByResourceId: vi.fn(() => response({})),
      longPressAt: vi.fn(() => response({})),
      swipe: vi.fn(() => response({})),
      typeFocusedText: vi.fn(() => response({})),
      clearText: vi.fn(() => response({})),
      pressKey: vi.fn(() => response({})),
      pressBack: vi.fn(() => response({})),
      pressHome: vi.fn(() => response({})),
      pressRecentApps: vi.fn(() => response({})),
      openApp: vi.fn(() => response({ packageName: 'com.example.target' })),
      captureScreen: vi.fn(() => response({ image: 'abcd', width: 200, height: 300, verified: true })),
    };

    (globalThis as any).window = {
      HandsBridge: bridge,
      screen: { width: 200, height: 300 },
      innerWidth: 200,
      innerHeight: 300,
      devicePixelRatio: 2,
    };
    (globalThis as any).navigator = { userAgent: 'Android test' };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).navigator = originalNavigator;
  });

  it('connects to the native bridge and observes generation metadata', async () => {
    const hands = new NativeWebViewHands({ transport: 'native', endpoint: 'embedded' });
    await expect(hands.connect()).resolves.toBeUndefined();

    const tree = await hands.getAccessibilityTree();
    expect(tree.packageName).toBe('com.example.test');
    expect(tree.generation).toBe(7);
    expect(tree.root.children?.[0].text).toBe('Кнопка');
  });

  it('finds an element and taps its center', async () => {
    const hands = new NativeWebViewHands({ transport: 'native', endpoint: 'embedded' });
    const element = await hands.findElementByText('Кнопка');

    expect(element?.id).toBe('button-1');

    const result = await hands.tapElement('button-1');
    expect(result.success).toBe(true);
  });

  it('supports text clear, key, screenshot, and app launch', async () => {
    const hands = new NativeWebViewHands({ transport: 'native', endpoint: 'embedded' });

    expect((await hands.clearText()).executed).toBe(true);
    expect((await hands.pressKey('enter')).executed).toBe(true);

    const screenshot = await hands.captureScreen();
    expect(screenshot.image).toBe('abcd');
    expect(screenshot.width).toBe(200);
    expect(screenshot.height).toBe(300);

    const launched = await hands.launchApp('Chrome');
    expect(launched.data.packageName).toBe('com.example.target');
  });

  it('selects native transport through HandsManager', async () => {
    const manager = new HandsManager();
    await expect(
      manager.connect({ transport: 'native', endpoint: 'embedded' }),
    ).resolves.toBeUndefined();

    expect(manager.getStatus()).toBe('connected');
    expect(manager.getHands()).toBeInstanceOf(NativeWebViewHands);

    await manager.disconnect();
    expect(manager.getStatus()).toBe('disconnected');
  });
});
