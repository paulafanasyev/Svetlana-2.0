// Tests for Verification Logic
// Tests the BEFORE → ACTION → AFTER → COMPARE pattern
// tap/type прикалываются к приложению на экране: первый getCurrentApp — «закреплённое» приложение.
// Доказательство результата принимается только с экрана того же приложения.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const focused = (text: string) => vi.fn().mockResolvedValue({ root: { children: [{ type: 'EditText', focused: true, text, children: [] }] } });

describe('Verification Logic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerRealTools();
  });

  describe('type_text verification', () => {
    it('should verify text actually appeared in focused field', async () => {
      const tool = toolRegistry.getTool('type_text');
      expect(tool).toBeDefined();
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: focused('Hello World'),
        getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
        clearText: vi.fn().mockResolvedValue({ success: true })
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ text: 'Hello World' });
      expect(result.success).toBe(true);
      const verified = await tool!.verify!({ text: 'Hello World' }, result);
      expect(verified).toBe(true);
    });

    it('should fail verification if text not found in field', async () => {
      const tool = toolRegistry.getTool('type_text');
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: focused('Different text'),
        getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
        clearText: vi.fn().mockResolvedValue({ success: true })
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ text: 'Hello World' });
      const verified = await tool!.verify!({ text: 'Hello World' }, result);
      expect(verified).toBe(false);
    });

    it('should fail verification if no focused input found', async () => {
      const tool = toolRegistry.getTool('type_text');
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [{ type: 'TextView', text: 'Some text', children: [] }] } }),
        getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
        clearText: vi.fn().mockResolvedValue({ success: true })
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ text: 'Hello World' });
      const verified = await tool!.verify!({ text: 'Hello World' }, result);
      expect(verified).toBe(false);
    });

    it('does not read the verification field from an overlay that appeared after typing', async () => {
      const tool = toolRegistry.getTool('type_text');
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: focused('Hello World'),
        getCurrentApp: vi.fn().mockResolvedValueOnce('com.example.notes').mockResolvedValueOnce('com.example.notes').mockResolvedValue('com.evil.overlay'),
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ text: 'Hello World' });
      expect(result.success).toBe(true);
      expect(await tool!.verify!({ text: 'Hello World' }, result)).toBe(false);
      expect(mockHands.getAccessibilityTree).not.toHaveBeenCalled();
    });

    it('refuses to type when another app took the screen', async () => {
      const tool = toolRegistry.getTool('type_text');
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: focused(''),
        getCurrentApp: vi.fn().mockResolvedValueOnce('com.example.notes').mockResolvedValue('com.evil.overlay'),
        clearText: vi.fn().mockResolvedValue({ success: true })
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ text: 'secret' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Another app');
      expect(mockHands.type).not.toHaveBeenCalled();
    });

    it('refuses to type when the app on screen is unknown', async () => {
      const tool = toolRegistry.getTool('type_text');
      const mockHands = { isConnected: () => true, type: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValue(null) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ text: 'x' });
      expect(result.success).toBe(false);
      expect(mockHands.type).not.toHaveBeenCalled();
    });
  });

  describe('tap_element verification', () => {
    const button = (text: string) => vi.fn().mockResolvedValue({ id: 'button_1', text, bounds: { x: 100, y: 200, width: 200, height: 50 } });

    it('should verify UI changed after tap', async () => {
      const tool = toolRegistry.getTool('tap_element');
      const mockHands = {
        isConnected: () => true,
        findElementByText: button('Click Me'),
        tap: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn()
          .mockResolvedValueOnce({ root: { children: [{ id: '1' }, { id: '2' }] } })
          .mockResolvedValueOnce({ root: { children: [{ id: '1' }, { id: '2' }, { id: '3' }] } }),
        getCurrentApp: vi.fn().mockResolvedValue('com.app.before')
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ elementText: 'Click Me' });
      expect(result.success).toBe(true);
      expect(result.data.beforeTree).toBeDefined();
      expect(result.data.beforeApp).toBeDefined();
      const verified = await tool!.verify!({ elementText: 'Click Me' }, result);
      expect(verified).toBe(true);
    });

    it('should fail verification if UI did not change', async () => {
      const tool = toolRegistry.getTool('tap_element');
      const mockHands = {
        isConnected: () => true,
        findElementByText: button('Click Me'),
        tap: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn()
          .mockResolvedValueOnce({ root: { children: [{ id: '1' }, { id: '2' }] } })
          .mockResolvedValueOnce({ root: { children: [{ id: '1' }, { id: '2' }] } }),
        getCurrentApp: vi.fn().mockResolvedValue('com.app.same')
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ elementText: 'Click Me' });
      const verified = await tool!.verify!({ elementText: 'Click Me' }, result);
      expect(verified).toBe(false);
    });

    it('does not count a different app on screen after the tap as proof (could be an overlay)', async () => {
      const tool = toolRegistry.getTool('tap_element');
      const mockHands = {
        isConnected: () => true,
        findElementByText: button('Settings'),
        tap: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn()
          .mockResolvedValueOnce({ root: { children: [{ id: '1' }] } })
          .mockResolvedValueOnce({ root: { children: [{ id: '1' }, { id: '2' }] } }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.home')
          .mockResolvedValueOnce('com.app.home')
          .mockResolvedValueOnce('com.app.settings')
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ elementText: 'Settings' });
      expect(result.success).toBe(true);
      const verified = await tool!.verify!({ elementText: 'Settings' }, result);
      expect(verified).toBe(false);
    });

    it('refuses to tap when another app took the screen after the element was found', async () => {
      const tool = toolRegistry.getTool('tap_element');
      const mockHands = {
        isConnected: () => true,
        findElementByText: button('OK'),
        tap: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [] } }),
        getCurrentApp: vi.fn().mockResolvedValueOnce('com.app.home').mockResolvedValue('com.evil.overlay')
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ elementText: 'OK' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Another app');
      expect(mockHands.tap).not.toHaveBeenCalled();
    });
  });

  describe('send_message verification', () => {
    const hands = (chatText: string) => ({
      isConnected: () => true,
      launchApp: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger'),
      findElementByText: vi.fn()
        .mockResolvedValueOnce({ id: 'contact_1', text: 'John', bounds: { x: 100, y: 200, width: 200, height: 50 } })
        .mockResolvedValueOnce({ id: 'send_button', text: 'Send', bounds: { x: 500, y: 800, width: 100, height: 50 } }),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [{ text: chatText, children: [] }] } })
    });
    const params = { app: 'org.telegram.messenger', contact: 'John', message: 'Hello John!' };

    it('should verify message appeared in chat', async () => {
      const tool = toolRegistry.getTool('send_message');
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(hands('Hello John!') as any);
      const result = await tool!.execute(params);
      expect(result.success).toBe(true);
      expect(await tool!.verify!(params, result)).toBe(true);
    });

    it('should fail verification if message not found in chat', async () => {
      const tool = toolRegistry.getTool('send_message');
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(hands('Old message') as any);
      const result = await tool!.execute(params);
      expect(await tool!.verify!(params, result)).toBe(false);
    });
  });

  describe('open_app verification', () => {
    it('should verify app actually launched', async () => {
      const tool = toolRegistry.getTool('open_app');
      const mockHands = { isConnected: () => true, launchApp: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger') };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ packageName: 'org.telegram.messenger' });
      expect(result.success).toBe(true);
      expect(result.data.verified).toBe(true);
    });

    it('should fail verification if wrong app is active', async () => {
      const tool = toolRegistry.getTool('open_app');
      const mockHands = { isConnected: () => true, launchApp: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValue('com.android.launcher') };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await tool!.execute({ packageName: 'org.telegram.messenger' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Verification failed');
    });
  });

  describe('BEFORE → ACTION → AFTER → COMPARE pattern', () => {
    it('should follow the pattern for all tools', async () => {
      for (const toolId of ['type_text', 'tap_element', 'send_message', 'open_app']) {
        const tool = toolRegistry.getTool(toolId);
        expect(tool).toBeDefined();
        expect(tool!.verify).toBeDefined();
      }
    });
  });
});
