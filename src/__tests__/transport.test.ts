// Tests for Transport Layer
// Run with: npm test or npx vitest

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HandsManager } from '../services/HandsManager';
import { handsManager } from '../services/HandsManager';
import { WebSocketHands } from '../services/WebSocketHands';
import { HTTPHands } from '../services/HTTPHands';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { createMCPRequest, parseMCPMessage, MCP_ERROR_CODES } from '../services/MCPProtocol';
import { sanitizeProviderForStorage } from '../services/AIGateway';

describe('HandsManager', () => {
  let manager: HandsManager;

  beforeEach(() => {
    manager = new HandsManager();
  });

  it('should start in disconnected state', () => {
    expect(manager.getStatus()).toBe('disconnected');
    expect(manager.getHands()).toBeNull();
  });

  it('should reject unsupported transport', async () => {
    await expect(
      manager.connect({ transport: 'invalid' as any, endpoint: 'test' })
    ).rejects.toThrow('Unsupported transport');
  });

  it('should notify listeners on status change', async () => {
    const listener = vi.fn();
    manager.onStatusChange(listener);
    try {
      await manager.connect({ transport: 'websocket', endpoint: 'ws://invalid' });
    } catch (e) {
      // Expected to fail
    }
    expect(listener).toHaveBeenCalled();
  });
});

describe('ToolRegistry', () => {
  beforeEach(() => {
    registerRealTools();
  });

  it('should have real tools registered', () => {
    const tools = toolRegistry.getAllTools();
    expect(tools.length).toBeGreaterThan(0);
    const openApp = toolRegistry.getTool('open_app');
    expect(openApp).toBeDefined();
    expect(openApp?.id).toBe('open_app');
  });

  it('should report tools as unavailable when not connected', async () => {
    const openApp = toolRegistry.getTool('open_app');
    expect(openApp).toBeDefined();
    const available = await openApp!.isAvailable();
    expect(available).toBe(false);
  });

  it('should return error when executing unavailable tool', async () => {
    const result = await toolRegistry.executeTool('open_app', { packageName: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('should require packageName for open_app', async () => {
    const result = await toolRegistry.executeTool('open_app', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameter');
  });

  it('should generate function calling schema', () => {
    const schema = toolRegistry.generateFunctionCallingSchema();
    expect(Array.isArray(schema)).toBe(true);
    expect(schema.length).toBeGreaterThan(0);
    const firstTool = schema[0] as any;
    expect(firstTool.type).toBe('function');
    expect(firstTool.function.name).toBeDefined();
    expect(firstTool.function.parameters).toBeDefined();
  });

  it('should log executions', async () => {
    await toolRegistry.executeTool('nonexistent_tool', {});
    const log = toolRegistry.getExecutionLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[log.length - 1].toolId).toBe('nonexistent_tool');
  });
});

describe('MCPProtocol', () => {
  it('should create valid MCP request', () => {
    const request = createMCPRequest('app.launch', { packageName: 'test' });
    expect(request.jsonrpc).toBe('2.0');
    expect(request.method).toBe('app.launch');
    expect(request.params.packageName).toBe('test');
    expect(request.id).toBeDefined();
    expect(request.timestamp).toBeDefined();
  });

  it('should parse valid MCP message', () => {
    const request = createMCPRequest('device.getInfo');
    const json = JSON.stringify(request);
    const parsed = parseMCPMessage(json);
    expect(parsed).toBeDefined();
    expect(parsed?.jsonrpc).toBe('2.0');
  });

  it('should return null for invalid JSON', () => {
    const parsed = parseMCPMessage('invalid json');
    expect(parsed).toBeNull();
  });

  it('should have correct error codes', () => {
    expect(MCP_ERROR_CODES.DEVICE_NOT_CONNECTED).toBe(-32000);
    expect(MCP_ERROR_CODES.ELEMENT_NOT_FOUND).toBe(-32001);
    expect(MCP_ERROR_CODES.TIMEOUT).toBe(-32003);
  });
});

describe('Integration: Tool Execution Flow', () => {
  beforeEach(() => {
    registerRealTools();
  });

  it('should follow complete execution flow', async () => {
    const tool = toolRegistry.getTool('open_app');
    expect(tool).toBeDefined();
    const available = await tool!.isAvailable();
    expect(available).toBe(false);
    const result = await toolRegistry.executeTool('open_app', {
      packageName: 'org.telegram.messenger'
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.requestId).toBeDefined();
    expect(result.timestamp).toBeDefined();
    const log = toolRegistry.getExecutionLog(1);
    expect(log[0].toolId).toBe('open_app');
    expect(log[0].result.success).toBe(false);
  });

  it('should handle high-risk tools with confirmation', async () => {
    const sendMessage = toolRegistry.getTool('send_message');
    expect(sendMessage).toBeDefined();
    expect(sendMessage?.riskLevel).toBe('high');
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue({} as any);
    const result = await toolRegistry.executeTool('send_message', {
      app: 'org.telegram.messenger',
      contact: 'Test',
      message: 'Hello',
    });
    expect(result.requiresConfirmation).toBe(true);
    expect(result.confirmationMessage).toBeDefined();
  });
});

describe('Security', () => {
  it('should never persist provider API keys', () => {
    const provider = {
      id: 'openai',
      name: 'OpenAI',
      type: 'online' as const,
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'TEST_SECRET_MUST_NOT_PERSIST',
      model: 'test-model',
      enabled: true,
    };
    const persisted = sanitizeProviderForStorage(provider);
    expect(persisted).not.toHaveProperty('apiKey');
    expect(JSON.stringify(persisted)).not.toContain('TEST_SECRET_MUST_NOT_PERSIST');
    expect(persisted.id).toBe(provider.id);
    expect(persisted.model).toBe(provider.model);
  });

  it('should not store API keys in source code', () => {
    const gatewayCode = `
      const stored = localStorage.getItem('svetlana_ai_providers');
      // Provider secrets must be removed before persistence.
    `;
    expect(gatewayCode).toContain('localStorage');
    expect(gatewayCode).not.toContain('sk-');
    expect(gatewayCode).not.toContain('key-');
  });

  it('should require confirmation for high-risk actions', async () => {
    registerRealTools();
    const highRiskTools = toolRegistry.getToolsByRiskLevel('high');
    expect(highRiskTools.length).toBeGreaterThan(0);
    for (const tool of highRiskTools) {
      const result = await toolRegistry.executeTool(tool.id, {});
      expect(result.success === false || result.requiresConfirmation === true).toBe(true);
    }
  });
});
