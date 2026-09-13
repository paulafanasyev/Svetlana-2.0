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

const makeLegacyTool = (id: string, available: boolean): Tool => ({
  id,
  name: id,
  description: id,
  inputSchema: { type: 'object', properties: {} },
  riskLevel: 'low',
  category: 'data',
  execute: async () => ({ success: true }),
  isAvailable: async () => available,
});

describe('CapabilityRouter contract', () => {
  afterEach(() => {
    for (const tool of toolRegistry.getAllTools()) {
      if (tool.id.startsWith('test.router.')) toolRegistry.unregisterTool(tool.id);
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

  test('does not let unclassified legacy tools outrank explicit LOCAL_FREE tools', async () => {
    toolRegistry.registerTool(makeLegacyTool('test.router.legacy', true));
    toolRegistry.registerTool(makeTool('test.router.local', 'LOCAL_FREE', true));
    toolRegistry.registerTool(makeTool('test.router.cloud', 'OPTIONAL_CLOUD', true));

    const result = await capabilityRouter.resolve({ action: 'document-action', capability: 'document' });

    expect(result.success).toBe(true);
    expect(result.tool?.id).toBe('test.router.local');
    expect(result.backend).toBe('LOCAL_FREE');
    expect(result.candidates).toEqual(['test.router.local', 'test.router.cloud', 'test.router.legacy']);
  });

  test('resolves legacy action names through capability mapping', async () => {
    toolRegistry.registerTool({
      ...makeTool('test.router.tap', 'LOCAL_FREE', true),
      id: 'tap',
      external: { ...makeTool('test.router.tap', 'LOCAL_FREE', true).external!, capability: 'interaction' },
    });

    const result = await capabilityRouter.resolve({ action: 'tap' });

    expect(result.success).toBe(true);
    expect(result.tool?.id).toBe('tap');
  });
});
