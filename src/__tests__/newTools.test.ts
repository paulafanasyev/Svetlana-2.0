// Tests for new tools: swipe, pressKey, goHome, goBack, searchWeb

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools, swipeTool, pressKeyTool, goHomeTool, goBackTool, searchWebTool } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

describe('New Tools', () => {
  beforeEach(() => {
    registerRealTools();
  });

  describe('swipe tool', () => {
    it('should execute swipe successfully', async () => {
      const mockHands = {
        isConnected: () => true,
        swipe: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await swipeTool.execute({
        startX: 100,
        startY: 500,
        endX: 100,
        endY: 200,
        duration: 300,
      });

      expect(result.success).toBe(true);
      expect(result.data.startX).toBe(100);
      expect(result.data.startY).toBe(500);
      expect(result.data.endX).toBe(100);
      expect(result.data.endY).toBe(200);
      expect(mockHands.swipe).toHaveBeenCalledWith(100, 500, 100, 200, 300);
    });

    it('should handle swipe failure', async () => {
      const mockHands = {
        isConnected: () => true,
        swipe: vi.fn().mockResolvedValue({ success: false, error: 'Swipe failed' }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await swipeTool.execute({
        startX: 100,
        startY: 500,
        endX: 100,
        endY: 200,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Swipe failed');
    });
  });

  describe('pressKey tool', () => {
    it('should execute key press successfully', async () => {
      const mockHands = {
        isConnected: () => true,
        pressKey: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await pressKeyTool.execute({ key: 'back' });

      expect(result.success).toBe(true);
      expect(result.data.key).toBe('back');
      expect(mockHands.pressKey).toHaveBeenCalledWith('back');
    });

    it('should handle key press failure', async () => {
      const mockHands = {
        isConnected: () => true,
        pressKey: vi.fn().mockResolvedValue({ success: false, error: 'Key press failed' }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await pressKeyTool.execute({ key: 'home' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Key press failed');
    });
  });

  describe('goHome tool', () => {
    it('should navigate to home successfully', async () => {
      const mockHands = {
        isConnected: () => true,
        goHome: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('com.android.launcher'),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await goHomeTool.execute({});

      expect(result.success).toBe(true);
      expect(result.data.currentApp).toBe('com.android.launcher');
      expect(mockHands.goHome).toHaveBeenCalled();
    });

    it('should handle goHome failure', async () => {
      const mockHands = {
        isConnected: () => true,
        goHome: vi.fn().mockResolvedValue({ success: false, error: 'Failed to go home' }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await goHomeTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to go home');
    });
  });

  describe('goBack tool', () => {
    it('should navigate back successfully', async () => {
      const mockHands = {
        isConnected: () => true,
        goBack: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.settings')
          .mockResolvedValueOnce('com.app.home'),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await goBackTool.execute({});

      expect(result.success).toBe(true);
      expect(result.data.beforeApp).toBe('com.app.settings');
      expect(result.data.afterApp).toBe('com.app.home');
      expect(result.data.navigated).toBe(true);
      expect(mockHands.goBack).toHaveBeenCalled();
    });

    it('should verify navigation occurred', async () => {
      const mockHands = {
        isConnected: () => true,
        goBack: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.settings')
          .mockResolvedValueOnce('com.app.home'),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await goBackTool.execute({});
      const verified = await goBackTool.verify!({}, result);

      expect(verified).toBe(true);
    });

    it('should fail verification if no navigation occurred', async () => {
      const mockHands = {
        isConnected: () => true,
        goBack: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn()
          .mockResolvedValueOnce('com.app.settings')
          .mockResolvedValueOnce('com.app.settings'), // Same app
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await goBackTool.execute({});
      const verified = await goBackTool.verify!({}, result);

      expect(verified).toBe(false);
    });
  });

  describe('searchWeb tool', () => {
    it('should execute web search successfully', async () => {
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        type: vi.fn().mockResolvedValue({ success: true }),
        pressKey: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await searchWebTool.execute({ query: 'test query' });

      expect(result.success).toBe(true);
      expect(result.data.query).toBe('test query');
      expect(result.data.url).toContain('google.com/search');
      expect(result.data.browser).toBe('com.android.chrome');
      expect(mockHands.launchApp).toHaveBeenCalledWith('com.android.chrome');
      expect(mockHands.type).toHaveBeenCalled();
      expect(mockHands.pressKey).toHaveBeenCalledWith('enter');
    });

    it('should handle browser launch failure', async () => {
      const mockHands = {
        isConnected: () => true,
        launchApp: vi.fn().mockResolvedValue({ success: false, error: 'Failed to open browser' }),
      };

      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);

      const result = await searchWebTool.execute({ query: 'test' });

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
  });
});
