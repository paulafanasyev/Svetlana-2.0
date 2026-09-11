// Integration Tests - Full execution chain
// Tests the complete flow: Tool → Policy → Hands → Verification

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';
import { policyEngine } from '../services/PolicyEngine';

describe('Integration Tests', () => {
  beforeEach(() => {
    registerRealTools();
  });

  describe('Full Execution Chain', () => {
    it('should execute open_app with full verification', async () => {
      // Setup mock hands
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger')
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      // Execute tool
      const result = await toolRegistry.executeTool('open_app', {
        packageName: 'org.telegram.messenger'
      });

      // Verify full chain
      expect(result.success).toBe(true);
      expect(result.data.verified).toBe(true);
      expect(result.requestId).toBeDefined();
      expect(result.timestamp).toBeDefined();
      
      // Verify hands were called
      expect(mockHands.launchApp).toHaveBeenCalledWith('org.telegram.messenger');
      expect(mockHands.getCurrentApp).toHaveBeenCalled();
    });

    it('should execute tap_element with BEFORE/AFTER verification', async () => {
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
            root: { children: [{ id: '1' }, { id: '2' }] }
          }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.home')
          .mockResolvedValueOnce('com.app.settings')
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('tap_element', {
        elementText: 'Settings'
      });

      // Verify BEFORE/AFTER pattern
      expect(result.success).toBe(true);
      expect(result.data.beforeTree).toBeDefined();
      expect(result.data.beforeApp).toBe('com.app.home');
      
      // Verify hands were called in correct order
      expect(mockHands.getAccessibilityTree).toHaveBeenCalledTimes(2);
      expect(mockHands.findElementByText).toHaveBeenCalledWith('Settings');
      expect(mockHands.tap).toHaveBeenCalled();
    });

    it('should execute type_text with field content verification', async () => {
      const mockHands = {
        isConnected: () => true,
        type: vi.fn().mockResolvedValue({ success: true }),
        clearText: vi.fn().mockResolvedValue({ success: true }),
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
        })
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('type_text', {
        text: 'Hello World',
        clearFirst: true
      });

      // Verify text was typed
      expect(result.success).toBe(true);
      expect(result.data.typed).toBe('Hello World');
      
      // Verify clear was called first
      expect(mockHands.clearText).toHaveBeenCalled();
      expect(mockHands.type).toHaveBeenCalledWith('Hello World');
      
      // Verify accessibility tree was checked
      expect(mockHands.getAccessibilityTree).toHaveBeenCalled();
    });

    it('should execute send_message with chat verification', async () => {
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

      const result = await toolRegistry.executeTool('send_message', {
        app: 'org.telegram.messenger',
        contact: 'John',
        message: 'Hello John!'
      });

      // Verify full message flow
      expect(result.success).toBe(true);
      expect(result.data.app).toBe('org.telegram.messenger');
      expect(result.data.contact).toBe('John');
      expect(result.data.message).toBe('Hello John!');
      
      // Verify hands were called in correct order
      expect(mockHands.launchApp).toHaveBeenCalledWith('org.telegram.messenger');
      expect(mockHands.findElementByText).toHaveBeenCalledWith('John');
      expect(mockHands.type).toHaveBeenCalledWith('Hello John!');
      expect(mockHands.findElementByText).toHaveBeenCalledWith('Send');
      expect(mockHands.getAccessibilityTree).toHaveBeenCalled();
    });

    it('should enforce policy for high-risk actions', async () => {
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        findElementByText: vi.fn().mockResolvedValue({
          id: 'contact_1',
          text: 'John',
          bounds: { x: 100, y: 200, width: 200, height: 50 }
        }),
        tap: vi.fn().mockResolvedValue({ success: true }),
        type: vi.fn().mockResolvedValue({ success: true }),
        getAccessibilityTree: vi.fn().mockResolvedValue({
          root: { children: [] }
        })
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      // send_message is high-risk and requires confirmation
      const result = await toolRegistry.executeTool('send_message', {
        app: 'org.telegram.messenger',
        contact: 'John',
        message: 'Hello!'
      });

      // Should require confirmation
      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmationMessage).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection failure', async () => {
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(false);

      const result = await toolRegistry.executeTool('open_app', {
        packageName: 'org.telegram.messenger'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('should handle element not found', async () => {
      const mockHands = {
        isConnected: () => true,
        findElementByText: vi.fn().mockResolvedValue(null)
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('tap_element', {
        elementText: 'NonExistent'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });

    it('should handle action failure', async () => {
      const mockHands = {
        isConnected: () => true,
        findElementByText: vi.fn().mockResolvedValue({
          id: 'button_1',
          text: 'Click',
          bounds: { x: 100, y: 200, width: 200, height: 50 }
        }),
        tap: vi.fn().mockResolvedValue({ success: false, error: 'Tap failed' })
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('tap_element', {
        elementText: 'Click'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tap failed');
    });

    it('should handle verification failure', async () => {
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('com.android.launcher') // Wrong app
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('open_app', {
        packageName: 'org.telegram.messenger'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Verification failed');
    });
  });

  describe('Execution Logging', () => {
    it('should log all executions', async () => {
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger')
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      // Execute multiple tools
      await toolRegistry.executeTool('open_app', { packageName: 'org.telegram.messenger' });
      await toolRegistry.executeTool('open_app', { packageName: 'com.whatsapp' });

      // Check execution log
      const log = toolRegistry.getExecutionLog();
      expect(log.length).toBeGreaterThanOrEqual(2);
      
      const lastTwo = log.slice(-2);
      expect(lastTwo[0].toolId).toBe('open_app');
      expect(lastTwo[1].toolId).toBe('open_app');
    });
  });

  describe('Tool Availability', () => {
    it('should check tool availability before execution', async () => {
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(false);

      const tools = ['open_app', 'tap_element', 'type_text', 'capture_screen', 'send_message'];

      for (const toolId of tools) {
        const result = await toolRegistry.executeTool(toolId, {});
        expect(result.success).toBe(false);
        expect(result.error).toContain('not available');
      }
    });

    it('should report correct availability', async () => {
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);

      const tools = toolRegistry.getAllTools();
      
      for (const tool of tools) {
        const available = await tool.isAvailable();
        expect(available).toBe(true);
      }
    });
  });
});
