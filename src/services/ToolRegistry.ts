// Tool Registry - Tool abstraction layer
// Real tool implementations are in RealTools.ts and use PlatformHands via HandsManager
// This file only defines the contract and registry - NO stub implementations

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
  }>;
  required?: string[];
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
  observation?: any;
  verification?: {
    status: 'PASS' | 'FAIL' | 'PENDING';
    confidence: number;
    details?: string;
  };
  requestId?: string;
  timestamp?: number;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  riskLevel: RiskLevel;
  category: 'navigation' | 'interaction' | 'data' | 'system' | 'communication';
  
  // Execute the tool - MUST use real PlatformHands, NO stubs
  execute(params: Record<string, any>): Promise<ToolResult>;
  
  // Verify the result with real observation
  verify?(params: Record<string, any>, result: ToolResult): Promise<boolean>;
  
  // Check if tool is available - MUST check real connection
  isAvailable(): Promise<boolean>;
}

export interface ToolExecutionContext {
  platform: 'android' | 'ios' | 'windows' | 'macos' | 'web';
  permissions: string[];
  environment: Record<string, any>;
}

// Structured tool call format for LLM function calling
export interface StructuredToolCall {
  tool: string;
  arguments: Record<string, any>;
  requestId: string;
  timestamp: number;
}

class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private context: ToolExecutionContext = {
    platform: 'web',
    permissions: [],
    environment: {},
  };
  private executionLog: Array<{
    requestId: string;
    toolId: string;
    params: any;
    result: ToolResult;
    timestamp: number;
  }> = [];

  registerTool(tool: Tool) {
    this.tools.set(tool.id, tool);
  }

  unregisterTool(id: string) {
    this.tools.delete(id);
  }

  getTool(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolsByCategory(category: Tool['category']): Tool[] {
    return this.getAllTools().filter(t => t.category === category);
  }

  getToolsByRiskLevel(riskLevel: RiskLevel): Tool[] {
    return this.getAllTools().filter(t => t.riskLevel === riskLevel);
  }

  async executeTool(id: string, params: Record<string, any>): Promise<ToolResult> {
    const requestId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tool = this.tools.get(id);
    
    if (!tool) {
      const result: ToolResult = {
        success: false,
        error: `Tool ${id} not found in registry`,
        requestId,
        timestamp: Date.now(),
      };
      this.logExecution(requestId, id, params, result);
      return result;
    }

    // Check availability - this checks REAL connection
    const available = await tool.isAvailable();
    if (!available) {
      const result: ToolResult = {
        success: false,
        error: `Tool ${id} is not available. Ensure Android device is connected via Android Connection page.`,
        requestId,
        timestamp: Date.now(),
      };
      this.logExecution(requestId, id, params, result);
      return result;
    }

    // Validate input
    const validation = this.validateInput(tool, params);
    if (!validation.valid) {
      const result: ToolResult = {
        success: false,
        error: validation.error,
        requestId,
        timestamp: Date.now(),
      };
      this.logExecution(requestId, id, params, result);
      return result;
    }

    // Check risk level - high/critical require confirmation
    if (tool.riskLevel === 'critical' || tool.riskLevel === 'high') {
      const result: ToolResult = {
        success: false,
        requiresConfirmation: true,
        confirmationMessage: this.getConfirmationMessage(tool, params),
        requestId,
        timestamp: Date.now(),
      };
      this.logExecution(requestId, id, params, result);
      return result;
    }

    // Execute - this calls REAL PlatformHands
    try {
      const result = await tool.execute(params);
      result.requestId = requestId;
      result.timestamp = Date.now();
      
      // Verify if verification function exists
      if (tool.verify && result.success) {
        const verified = await tool.verify(params, result);
        result.verification = {
          status: verified ? 'PASS' : 'FAIL',
          confidence: verified ? 1.0 : 0.0,
          details: verified ? 'Verified via observation' : 'Verification failed',
        };
        
        if (!verified) {
          result.success = false;
          result.error = 'Verification failed after execution';
        }
      }

      this.logExecution(requestId, id, params, result);
      return result;
    } catch (error: any) {
      const result: ToolResult = {
        success: false,
        error: error.message || 'Tool execution failed',
        requestId,
        timestamp: Date.now(),
      };
      this.logExecution(requestId, id, params, result);
      return result;
    }
  }

  // Execute with explicit confirmation (for high/critical tools)
  async executeWithConfirmation(id: string, params: Record<string, any>): Promise<ToolResult> {
    const requestId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tool = this.tools.get(id);
    
    if (!tool) {
      return { success: false, error: `Tool ${id} not found`, requestId, timestamp: Date.now() };
    }

    const available = await tool.isAvailable();
    if (!available) {
      return { success: false, error: `Tool ${id} not available`, requestId, timestamp: Date.now() };
    }

    try {
      const result = await tool.execute(params);
      result.requestId = requestId;
      result.timestamp = Date.now();
      
      if (tool.verify && result.success) {
        const verified = await tool.verify(params, result);
        result.verification = {
          status: verified ? 'PASS' : 'FAIL',
          confidence: verified ? 1.0 : 0.0,
        };
        if (!verified) {
          result.success = false;
          result.error = 'Verification failed';
        }
      }

      this.logExecution(requestId, id, params, result);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message, requestId, timestamp: Date.now() };
    }
  }

  private getConfirmationMessage(tool: Tool, params: Record<string, any>): string {
    const riskLabels: Record<RiskLevel, string> = {
      low: 'Low risk',
      medium: 'Medium risk',
      high: '⚡ HIGH RISK',
      critical: '⚠️ CRITICAL',
    };

    return `${riskLabels[tool.riskLevel]}: ${tool.name}\n\n` +
      `This action will be performed on your Android device.\n` +
      `Parameters: ${JSON.stringify(params, null, 2)}\n\n` +
      `Do you confirm?`;
  }

  private validateInput(tool: Tool, params: Record<string, any>): { valid: boolean; error?: string } {
    const schema = tool.inputSchema;
    
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in params) || params[field] === undefined || params[field] === null) {
          return { valid: false, error: `Missing required parameter: ${field}` };
        }
      }
    }

    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in params && params[key] !== undefined && params[key] !== null) {
        const value = params[key];
        const expectedType = prop.type;

        if (expectedType === 'string' && typeof value !== 'string') {
          return { valid: false, error: `Parameter ${key} must be a string` };
        }
        if (expectedType === 'number' && typeof value !== 'number') {
          return { valid: false, error: `Parameter ${key} must be a number` };
        }
        if (expectedType === 'boolean' && typeof value !== 'boolean') {
          return { valid: false, error: `Parameter ${key} must be a boolean` };
        }
        if (prop.enum && !prop.enum.includes(value)) {
          return { valid: false, error: `Parameter ${key} must be one of: ${prop.enum.join(', ')}` };
        }
      }
    }

    return { valid: true };
  }

  private logExecution(requestId: string, toolId: string, params: any, result: ToolResult) {
    this.executionLog.push({
      requestId,
      toolId,
      params,
      result,
      timestamp: Date.now(),
    });
    if (this.executionLog.length > 1000) {
      this.executionLog.shift();
    }
  }

  setContext(context: Partial<ToolExecutionContext>) {
    this.context = { ...this.context, ...context };
  }

  getContext(): ToolExecutionContext {
    return { ...this.context };
  }

  getExecutionLog(limit: number = 50): typeof this.executionLog {
    return this.executionLog.slice(-limit);
  }

  // Generate tool descriptions for LLM function calling
  generateToolDescriptions(): string {
    const tools = this.getAllTools();
    return tools.map(tool => {
      const params = Object.entries(tool.inputSchema.properties)
        .map(([key, prop]) => `    - ${key}: ${prop.description}${prop.required ? ' (required)' : ''}`)
        .join('\n');

      return `${tool.id}: ${tool.description}
  Risk: ${tool.riskLevel}
  Category: ${tool.category}
  Parameters:
${params}`;
    }).join('\n\n');
  }

  // Generate JSON schema for LLM function calling
  generateFunctionCallingSchema(): object[] {
    return this.getAllTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.id,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.inputSchema.properties,
          required: tool.inputSchema.required,
        },
      },
    }));
  }
}

export const toolRegistry = new ToolRegistry();
