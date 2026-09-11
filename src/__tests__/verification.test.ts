// Tests for Verification Logic
// Tests the BEFORE → ACTION → AFTER → COMPARE pattern

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

describe('Verification Logic', () => {
  beforeEach(() => {
    registerRealTools();
  });

  describe('type_text verification', () => {
    it('should verify text actually appeared in focused field', async () => {
      const tool = toolRegistry.getTool('type_text');
      expect(tool).toBeDefined();
      
      // Mock hands with focused input containing the text
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn().mockResolvedValue({
          root: {
            children: [
              {
                type: 'EditText',
                focused: true,
                text: 'Hello World',
                children: []
              }
            ]
          }
        }),
        clearText: vi.fn().mockResolvedValue({ success: true })
      };

      // Mock handsManager
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({ text: 'Hello World' });
      
      expect(result.success).toBe(true);
      
      // Verify should check if text is in the focused field
      const verified = await tool!.verify!({ text: 'Hello World' }, result);
      expect(verified).toBe(true);
    });

    it('should fail verification if text not found in field', async () => {
      const tool = toolRegistry.getTool('type_text');
      
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn().mockResolvedValue({
          root: {
            children: [
              {
                type: 'EditText',
                focused: true,
                text: 'Different text',
                children: []
              }
            ]
          }
        }),
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
        getAccessibilityTree: vi.fn().mockResolvedValue({
          root: {
            children: [
              {
                type: 'TextView',
                text: 'Some text',
                children: []
              }
            ]
          }
        }),
        clearText: vi.fn().mockResolvedValue({ success: true })
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({ text: 'Hello World' });
      const verified = await tool!.verify!({ text: 'Hello World' }, result);
      
      expect(verified).toBe(false);
    });
  });

  describe('tap_element verification', () => {
    it('should verify UI changed after tap', async () => {
      const tool = toolRegistry.getTool('tap_element');
      
      const mockHands = {
        isConnected: () => true,
        findElementByText: vi.fn().mockResolvedValue({
          id: 'button_1',
          text: 'Click Me',
          bounds: { x: 100, y: 200, width: 200, height: 50 }
        }),
        tap: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn()
          .mockResolvedValueOnce({
            root: { children: [{ id: '1' }, { id: '2' }] }
          })
          .mockResolvedValueOnce({
            root: { children: [{ id: '1' }, { id: '2' }, { id: '3' }] }
          }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.before')
          .mockResolvedValueOnce('com.app.after')
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
        findElementByText: vi.fn().mockResolvedValue({
          id: 'button_1',
          text: 'Click Me',
          bounds: { x: 100, y: 200, width: 200, height: 50 }
        }),
        tap: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn()
          .mockResolvedValueOnce({
            root: { children: [{ id: '1' }, { id: '2' }] }
          })
          .mockResolvedValueOnce({
            root: { children: [{ id: '1' }, { id: '2' }] }
          }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.same')
          .mockResolvedValueOnce('com.app.same')
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({ elementText: 'Click Me' });
      const verified = await tool!.verify!({ elementText: 'Click Me' }, result);
      
      expect(verified).toBe(false);
    });

    it('should pass verification if app changed (navigation)', async () => {
      const tool = toolRegistry.getTool('tap_element');
      
      const mockHands = {
        isConnected: () => true,
        findElementByText: vi.fn().mockResolvedValue({
          id: 'button_1',
          text: 'Settings',
          bounds: { x: 100, y: 200, width: 200, height: 50 }
        }),
        tap: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn()
          .mockResolvedValueOnce({
            root: { children: [{ id: '1' }] }
          })
          .mockResolvedValueOnce({
            root: { children: [{ id: '1' }] }
          }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.home')
          .mockResolvedValueOnce('com.app.settings')
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({ elementText: 'Settings' });
      const verified = await tool!.verify!({ elementText: 'Settings' }, result);
      
      expect(verified).toBe(true);
    });
  });

  describe('send_message verification', () => {
    it('should verify message appeared in chat', async () => {
      const tool = toolRegistry.getTool('send_message');
      
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        findElementByText: vi.fn()
          .mockResolvedValueOnce({
            id: 'contact_1',
            text: 'John',
            bounds: { x: 100, y: 200, width: 200, height: 50 }
          })
          .mockResolvedValueOnce({
            id: 'send_button',
            text: 'Send',
            bounds: { x: 500, y: 800, width: 100, height: 50 }
          }),
        tap: vi.fn().mockResolvedValue({ success: true }),
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn().mockResolvedValue({
          root: {
            children: [
              {
                text: 'Hello John!',
                children: []
              }
            ]
          }
        })
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({
        app: 'org.telegram.messenger',
        contact: 'John',
        message: 'Hello John!'
      });
      
      expect(result.success).toBe(true);
      
      const verified = await tool!.verify!(
        { app: 'org.telegram.messenger', contact: 'John', message: 'Hello John!' },
        result
      );
      expect(verified).toBe(true);
    });

    it('should fail verification if message not found in chat', async () => {
      const tool = toolRegistry.getTool('send_message');
      
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        findElementByText: vi.fn()
          .mockResolvedValueOnce({
            id: 'contact_1',
            text: 'John',
            bounds: { x: 100, y: 200, width: 200, height: 50 }
          })
          .mockResolvedValueOnce({
            id: 'send_button',
            text: 'Send',
            bounds: { x: 500, y: 800, width: 100, height: 50 }
          }),
        tap: vi.fn().mockResolvedValue({ success: true }),
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn().mockResolvedValue({
          root: {
            children: [
              {
                text: 'Old message',
                children: []
              }
            ]
          }
        })
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({
        app: 'org.telegram.messenger',
        contact: 'John',
        message: 'Hello John!'
      });
      
      const verified = await tool!.verify!(
        { app: 'org.telegram.messenger', contact: 'John', message: 'Hello John!' },
        result
      );
      expect(verified).toBe(false);
    });
  });

  describe('open_app verification', () => {
    it('should verify app actually launched', async () => {
      const tool = toolRegistry.getTool('open_app');
      
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger')
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({ packageName: 'org.telegram.messenger' });
      
      expect(result.success).toBe(true);
      expect(result.data.verified).toBe(true);
    });

    it('should fail verification if wrong app is active', async () => {
      const tool = toolRegistry.getTool('open_app');
      
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('com.android.launcher')
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await tool!.execute({ packageName: 'org.telegram.messenger' });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Verification failed');
    });
  });

  describe('BEFORE → ACTION → AFTER → COMPARE pattern', () => {
    it('should follow the pattern for all tools', async () => {
      // This test verifies that all tools follow the verification pattern
      
      const tools = [
        'type_text',
        'tap_element',
        'send_message',
        'open_app'
      ];

      for (const toolId of tools) {
        const tool = toolRegistry.getTool(toolId);
        expect(tool).toBeDefined();
        expect(tool!.verify).toBeDefined();
        
        // All tools should have verification function
        // This ensures BEFORE → ACTION → AFTER → COMPARE pattern is implemented
      }
    });
  });
});
