// Tests for new tools: swipe, pressKey, goHome, goBack, searchWeb

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

describe('New Tools', () => {
  beforeEach(() => {
    registerRealTools();
  });

  describe('swipe tool', () => {
    it('should execute swipe successfully', async () => {
      const mockHands = {
        swipe: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('swipe', {
        startX: 100,
        startY: 500,
        endX: 100,
        endY: 200,
        duration: 300,
      });

      expect(result.success).toBe(true);
      expect(mockHands.swipe).toHaveBeenCalledWith(100, 500, 100, 200, 300);
    });

    it('should handle swipe failure', async () => {
      const mockHands = {
        swipe: vi.fn().mockResolvedValue({ success: false, error: 'Swipe failed' }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('swipe', {
        startX: 100,
        startY: 500,
        endX: 100,
        endY: 200,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Swipe failed');
    });
  });

  describe('press_key tool', () => {
    it('should execute key press successfully', async () => {
      const mockHands = {
        pressKey: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('press_key', { key: 'back' });

      expect(result.success).toBe(true);
      expect(mockHands.pressKey).toHaveBeenCalledWith('back');
    });

    it('should handle key press failure', async () => {
      const mockHands = {
        pressKey: vi.fn().mockResolvedValue({ success: false, error: 'Key press failed' }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('press_key', { key: 'home' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Key press failed');
    });
  });

  describe('go_home tool', () => {
    it('should navigate to home successfully', async () => {
      const mockHands = {
        goHome: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('com.android.launcher'),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('go_home', {});

      expect(result.success).toBe(true);
      expect(result.data.currentApp).toBe('com.android.launcher');
      expect(mockHands.goHome).toHaveBeenCalled();
    });

    it('should handle go_home failure', async () => {
      const mockHands = {
        goHome: vi.fn().mockResolvedValue({ success: false, error: 'Failed to go home' }),
        getCurrentApp: vi.fn().mockResolvedValue(null),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('go_home', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to go home');
    });
  });

  describe('go_back tool', () => {
    it('should navigate back successfully', async () => {
      const mockHands = {
        goBack: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.settings')
          .mockResolvedValueOnce('com.app.home'),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('go_back', {});

      expect(result.success).toBe(true);
      expect(result.data.beforeApp).toBe('com.app.settings');
      expect(result.data.afterApp).toBe('com.app.home');
      expect(result.data.navigated).toBe(true);
      expect(mockHands.goBack).toHaveBeenCalled();
    });

    it('should handle go_back failure', async () => {
      const mockHands = {
        goBack: vi.fn().mockResolvedValue({ success: false, error: 'Failed to go back' }),
        getCurrentApp: vi.fn().mockResolvedValue(null),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('go_back', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to go back');
    });
  });

  describe('search_web tool', () => {
    it('should execute web search successfully', async () => {
      const mockHands = {
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        type: vi.fn().mockResolvedValue({ success: true }),
        pressKey: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('search_web', { query: 'test query' });

      expect(result.success).toBe(true);
      expect(result.data.query).toBe('test query');
      expect(mockHands.launchApp).toHaveBeenCalled();
      expect(mockHands.type).toHaveBeenCalled();
      expect(mockHands.pressKey).toHaveBeenCalledWith('enter');
    });

    it('should handle browser launch failure', async () => {
      const mockHands = {
        launchApp: vi.fn().mockResolvedValue({ success: false, error: 'Failed to open browser' }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await toolRegistry.executeTool('search_web', { query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to open browser');
    });
  });

  describe('Tool registration', () => {
    it('should register all new tools', () => {
      const tools = toolRegistry.getAllTools();
      const toolIds = tools.map(t => t.id);

      expect(toolIds).toContain('swipe');
      expect(toolIds).toContain('press_key');
      expect(toolIds).toContain('go_home');
      expect(toolIds).toContain('go_back');
      expect(toolIds).toContain('search_web');
    });

    it('should have correct risk levels', () => {
      const swipe = toolRegistry.getTool('swipe');
      const pressKey = toolRegistry.getTool('press_key');
      const goHome = toolRegistry.getTool('go_home');
      const goBack = toolRegistry.getTool('go_back');
      const searchWeb = toolRegistry.getTool('search_web');

      expect(swipe?.riskLevel).toBe('low');
      expect(pressKey?.riskLevel).toBe('low');
      expect(goHome?.riskLevel).toBe('low');
      expect(goBack?.riskLevel).toBe('low');
      expect(searchWeb?.riskLevel).toBe('low');
    });

    it('should have correct categories', () => {
      const swipe = toolRegistry.getTool('swipe');
      const pressKey = toolRegistry.getTool('press_key');
      const goHome = toolRegistry.getTool('go_home');
      const goBack = toolRegistry.getTool('go_back');
      const searchWeb = toolRegistry.getTool('search_web');

      expect(swipe?.category).toBe('interaction');
      expect(pressKey?.category).toBe('interaction');
      expect(goHome?.category).toBe('navigation');
      expect(goBack?.category).toBe('navigation');
      expect(searchWeb?.category).toBe('data');
    });

    it('should expose real tools through capability discovery with LOCAL_FREE metadata', () => {
      const navigationIds = toolRegistry.getToolsByCapability('navigation').map(tool => tool.id);
      const interactionIds = toolRegistry.getToolsByCapability('interaction').map(tool => tool.id);
      const visionIds = toolRegistry.getToolsByCapability('vision').map(tool => tool.id);

      expect(navigationIds).toEqual(expect.arrayContaining(['open_app', 'go_home', 'go_back']));
      expect(interactionIds).toEqual(expect.arrayContaining(['tap_element', 'type_text', 'swipe']));
      expect(visionIds).toContain('capture_screen');

      for (const id of ['open_app', 'tap_element', 'type_text', 'capture_screen', 'send_message', 'swipe', 'press_key', 'go_home', 'go_back', 'search_web']) {
        const tool = toolRegistry.getTool(id);
        expect(tool?.external?.backend).toBe('LOCAL_FREE');
        expect(tool?.external?.securityStatus).toBe('PENDING');
        expect(tool?.external?.androidTermuxCompatible).toBeUndefined();
      }
    });
  });
});
