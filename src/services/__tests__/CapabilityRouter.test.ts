import { afterEach, describe, expect, test } from 'vitest';
import { capabilityRouter } from '../CapabilityRouter';
import { toolRegistry, type Tool } from '../ToolRegistry';

const makeTool = (id: string, backend: 'LOCAL_FREE' | 'USER_CONNECTED' | 'OPTIONAL_CLOUD' | 'REJECTED', available: boolean): Tool => ({
  id,
  name: id,
  description: id,
  inputSchema: { type: 'object', properties: {} },
  riskLevel: 'low',
  category: 'data',
  external: {
    backend,
    capability: 'document',
    networkPolicy: backend === 'LOCAL_FREE' ? 'offline' : 'internet_required',
    offlineCapable: backend === 'LOCAL_FREE',
    verificationStrategy: 'tool_result',
  },
  execute: async () => ({ success: true }),
  isAvailable: async () => available,
});

const makeLegacyTool = (id: string, category: Tool['category'] = 'navigation', available = true): Tool => ({
  id,
  name: id,
  description: id,
  inputSchema: { type: 'object', properties: {} },
  riskLevel: 'low',
  category,
  execute: async () => ({ success: true }),
  isAvailable: async () => available,
});

describe('CapabilityRouter contract', () => {
  afterEach(() => {
    for (const tool of toolRegistry.getAllTools()) {
      if (tool.id.startsWith('test.router.')) toolRegistry.unregisterTool(tool.id);
      if (['tap', 'tap_element', 'open_app', 'launchApp', 'test.cloud.open_app'].includes(tool.id)) toolRegistry.unregisterTool(tool.id);
    }
  });

  test('selects an available LOCAL_FREE tool before cloud fallbacks', async () => {
    toolRegistry.registerTool(makeTool('test.router.cloud', 'OPTIONAL_CLOUD', true));
    toolRegistry.registerTool(makeTool('test.router.local', 'LOCAL_FREE', true));

    const result = await capabilityRouter.resolve({ action: 'document-action', capability: 'document' });

    expect(result.success).toBe(true);
    expect(result.tool?.id).toBe('test.router.local');
    expect(result.backend).toBe('LOCAL_FREE');
    expect(result.candidates).toEqual(['test.router.local', 'test.router.cloud']);
  });

  test('skips unavailable higher-priority tools', async () => {
    toolRegistry.registerTool(makeTool('test.router.local', 'LOCAL_FREE', false));
    toolRegistry.registerTool(makeTool('test.router.connected', 'USER_CONNECTED', true));

    const result = await capabilityRouter.resolve({ action: 'document-action', capability: 'document' });

    expect(result.success).toBe(true);
    expect(result.tool?.id).toBe('test.router.connected');
    expect(result.backend).toBe('USER_CONNECTED');
  });

  test('never routes to REJECTED tools', async () => {
    toolRegistry.registerTool(makeTool('test.router.rejected', 'REJECTED', true));

    const result = await capabilityRouter.resolve({ action: 'document-action', capability: 'document' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rejected/i);
  });

  test('maps planner action names to the matching legacy implementation', async () => {
    toolRegistry.registerTool(makeLegacyTool('tap_element', 'interaction'));

    const result = await capabilityRouter.resolve({ action: 'tap' });

    expect(result.success).toBe(true);
    expect(result.tool?.id).toBe('tap_element');
    expect(result.candidates).toContain('tap_element');
  });

  test('does not let a cloud exact action outrank a LOCAL_FREE capability tool', async () => {
    toolRegistry.registerTool(makeTool('open_app', 'OPTIONAL_CLOUD', true));
    toolRegistry.registerTool(makeTool('test.router.local-navigation', 'LOCAL_FREE', true));

    const result = await capabilityRouter.resolve({ action: 'open_app', capability: 'navigation' });

    expect(result.success).toBe(true);
    expect(result.tool?.id).toBe('test.router.local-navigation');
    expect(result.backend).toBe('LOCAL_FREE');
  });

  test('keeps legacy local tools routable when no metadata exists', async () => {
    toolRegistry.registerTool(makeLegacyTool('open_app'));

    const result = await capabilityRouter.resolve({ action: 'launchApp' });

    expect(result.success).toBe(true);
    expect(result.tool?.id).toBe('open_app');
    expect(result.candidates).toContain('open_app');
  });
});
