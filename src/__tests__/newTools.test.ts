// Tests for new tools: swipe, pressKey, goHome, goBack, searchWeb

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const APP = 'com.example.app';
// Поле адреса браузера в фокусе (search_web вводит запрос только в него).
const urlBar = () => vi.fn().mockResolvedValue({ root: { children: [{ type: 'EditText', focused: true, id: 'url_bar', bounds: { x: 0, y: 0, width: 500, height: 60 }, text: '', children: [] }] } });

describe('New Tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerRealTools();
  });

  describe('swipe tool', () => {
    it('should execute swipe successfully', async () => {
      const mockHands = { swipe: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValue(APP) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('swipe', { startX: 100, startY: 500, endX: 100, endY: 200, duration: 300 });
      expect(result.success).toBe(true);
      expect(mockHands.swipe).toHaveBeenCalledWith(100, 500, 100, 200, 300);
    });

    it('should handle swipe failure', async () => {
      const mockHands = { swipe: vi.fn().mockResolvedValue({ success: false, error: 'Swipe failed' }), getCurrentApp: vi.fn().mockResolvedValue(APP) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('swipe', { startX: 100, startY: 500, endX: 100, endY: 200 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Swipe failed');
    });

    it('does not swipe when the app on screen is unknown', async () => {
      const mockHands = { swipe: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValue(null) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('swipe', { startX: 1, startY: 2, endX: 3, endY: 4 });
      expect(result.success).toBe(false);
      expect(mockHands.swipe).not.toHaveBeenCalled();
    });

    it('does not swipe when another app took the screen', async () => {
      const mockHands = { swipe: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValueOnce(APP).mockResolvedValue('com.evil.overlay') };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('swipe', { startX: 1, startY: 2, endX: 3, endY: 4 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Another app');
      expect(mockHands.swipe).not.toHaveBeenCalled();
    });
  });

  describe('press_key tool', () => {
    it('should execute key press successfully', async () => {
      const mockHands = { pressKey: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValue(APP) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('press_key', { key: 'back' });
      expect(result.success).toBe(true);
      expect(mockHands.pressKey).toHaveBeenCalledWith('back');
    });

    it('should handle key press failure', async () => {
      const mockHands = { pressKey: vi.fn().mockResolvedValue({ success: false, error: 'Key press failed' }), getCurrentApp: vi.fn().mockResolvedValue(APP) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('press_key', { key: 'home' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Key press failed');
    });

    it('does not press a key when another app took the screen', async () => {
      const mockHands = { pressKey: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValueOnce(APP).mockResolvedValue('com.evil.overlay') };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('press_key', { key: 'enter' });
      expect(result.success).toBe(false);
      expect(mockHands.pressKey).not.toHaveBeenCalled();
    });
  });

  describe('go_home tool', () => {
    it('should navigate to home successfully', async () => {
      const mockHands = { goHome: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValue('com.android.launcher') };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('go_home', {});
      expect(result.success).toBe(true);
      expect(result.data.currentApp).toBe('com.android.launcher');
      expect(mockHands.goHome).toHaveBeenCalled();
    });

    it('should handle go_home failure', async () => {
      const mockHands = { goHome: vi.fn().mockResolvedValue({ success: false, error: 'Failed to go home' }), getCurrentApp: vi.fn().mockResolvedValue(null) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('go_home', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to go home');
    });
  });

  describe('go_back tool', () => {
    it('should navigate back successfully', async () => {
      const mockHands = { goBack: vi.fn().mockResolvedValue({ success: true }), getCurrentApp: vi.fn().mockResolvedValueOnce('com.app.settings').mockResolvedValueOnce('com.app.home') };
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
      const mockHands = { goBack: vi.fn().mockResolvedValue({ success: false, error: 'Failed to go back' }), getCurrentApp: vi.fn().mockResolvedValue(null) };
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
        getCurrentApp: vi.fn().mockResolvedValue('com.android.chrome'),
        getAccessibilityTree: urlBar(),
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

    it('does not type the query when the browser is not on screen', async () => {
      const mockHands = {
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValue('com.evil.overlay'),
        getAccessibilityTree: urlBar(),
        type: vi.fn().mockResolvedValue({ success: true }),
        pressKey: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('search_web', { query: 'test' });
      expect(result.success).toBe(false);
      expect(mockHands.type).not.toHaveBeenCalled();
    });

    it('does not press Enter when the browser lost the screen after typing', async () => {
      const mockHands = {
        launchApp: vi.fn().mockResolvedValue({ success: true }),
        getCurrentApp: vi.fn().mockResolvedValueOnce('com.android.chrome').mockResolvedValue('com.evil.overlay'),
        getAccessibilityTree: urlBar(),
        type: vi.fn().mockResolvedValue({ success: true }),
        pressKey: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('search_web', { query: 'test' });
      expect(result.success).toBe(false);
      expect(mockHands.type).toHaveBeenCalled();
      expect(mockHands.pressKey).not.toHaveBeenCalled();
    });

    it('should handle browser launch failure', async () => {
      const mockHands = { launchApp: vi.fn().mockResolvedValue({ success: false, error: 'Failed to open browser' }) };
      vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
      vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
      const result = await toolRegistry.executeTool('search_web', { query: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to open browser');
    });
  });

  describe('Tool registration', () => {
    it('should register all new tools', () => {
      const toolIds = toolRegistry.getAllTools().map(t => t.id);
      for (const id of ['swipe', 'press_key', 'go_home', 'go_back', 'search_web']) expect(toolIds).toContain(id);
    });

    it('should have correct risk levels', () => {
      for (const id of ['swipe', 'press_key', 'go_home', 'go_back', 'search_web']) expect(toolRegistry.getTool(id)?.riskLevel).toBe('low');
    });

    it('should have correct categories', () => {
      expect(toolRegistry.getTool('swipe')?.category).toBe('interaction');
      expect(toolRegistry.getTool('press_key')?.category).toBe('interaction');
      expect(toolRegistry.getTool('go_home')?.category).toBe('navigation');
      expect(toolRegistry.getTool('go_back')?.category).toBe('navigation');
      expect(toolRegistry.getTool('search_web')?.category).toBe('data');
    });
  });
});
