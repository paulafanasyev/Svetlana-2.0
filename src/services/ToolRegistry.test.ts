import { beforeEach, describe, expect, it } from 'vitest';
import type { Tool, ToolResult } from './ToolRegistry';
import { toolRegistry } from './ToolRegistry';

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: 'test_tool',
    name: 'Test Tool',
    description: 'Test',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'low',
    category: 'data',
    async execute(): Promise<ToolResult> {
      return {
        success: true,
        data: {
          token: 'runtime-secret',
          nested: { password: 'nested-secret' },
        },
      };
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
    ...overrides,
  };
}

describe('ToolRegistry security gates', () => {
  beforeEach(() => {
    toolRegistry.setContext({
      platform: 'web',
      permissions: [],
      environment: {},
    });
    for (const tool of toolRegistry.getAllTools()) {
      if (tool.id.startsWith('test_')) toolRegistry.unregisterTool(tool.id);
    }
  });

  it('denies a configured tool when a required permission is missing', async () => {
    let executed = false;
    toolRegistry.registerTool(
      makeTool({
        id: 'test_permission',
        requiredPermissions: ['device.write'],
        async execute() {
          executed = true;
          return { success: true };
        },
      }),
    );

    const result = await toolRegistry.executeTool('test_permission', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('device.write');
    expect(executed).toBe(false);
  });

  it('executes when the required permission is present', async () => {
    toolRegistry.setContext({ permissions: ['device.write'] });
    let executed = false;
    toolRegistry.registerTool(
      makeTool({
        id: 'test_permission_granted',
        requiredPermissions: ['device.write'],
        async execute() {
          executed = true;
          return { success: true, data: { ok: true } };
        },
      }),
    );

    const result = await toolRegistry.executeTool('test_permission_granted', {});

    expect(result.success).toBe(true);
    expect(executed).toBe(true);
  });

  it('redacts sensitive fields from execution logs', async () => {
    toolRegistry.registerTool(makeTool({ id: 'test_redaction' }));

    await toolRegistry.executeTool('test_redaction', {
      token: 'input-secret',
      nested: { password: 'input-password', visible: 'keep-me' },
    });

    const entry = toolRegistry.getExecutionLog(1)[0];
    expect(entry.params.token).toBe('[REDACTED]');
    expect(entry.params.nested.password).toBe('[REDACTED]');
    expect(entry.params.nested.visible).toBe('keep-me');
    expect(entry.result.data.token).toBe('[REDACTED]');
    expect(entry.result.data.nested.password).toBe('[REDACTED]');
  });

  it('redacts sensitive fields in confirmation messages', async () => {
    toolRegistry.registerTool(
      makeTool({
        id: 'test_confirmation_redaction',
        riskLevel: 'high',
      }),
    );

    const result = await toolRegistry.executeTool('test_confirmation_redaction', {
      apiKey: 'do-not-leak',
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.confirmationMessage).toContain('[REDACTED]');
    expect(result.confirmationMessage).not.toContain('do-not-leak');
  });
});
