// Tool Registry - Real tool abstraction layer

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
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  riskLevel: RiskLevel;
  category: 'navigation' | 'interaction' | 'data' | 'system' | 'communication';
  
  // Execute the tool
  execute(params: Record<string, any>): Promise<ToolResult>;
  
  // Verify the result
  verify?(params: Record<string, any>, result: ToolResult): Promise<boolean>;
  
  // Check if tool is available
  isAvailable(): Promise<boolean>;
}

export interface ToolExecutionContext {
  platform: 'android' | 'ios' | 'windows' | 'macos' | 'web';
  permissions: string[];
  environment: Record<string, any>;
}

class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private context: ToolExecutionContext = {
    platform: 'web',
    permissions: [],
    environment: {},
  };

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
    const tool = this.tools.get(id);
    if (!tool) {
      return {
        success: false,
        error: `Tool ${id} not found`,
      };
    }

    // Check availability
    const available = await tool.isAvailable();
    if (!available) {
      return {
        success: false,
        error: `Tool ${id} is not available`,
      };
    }

    // Validate input
    const validation = this.validateInput(tool, params);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Check risk level
    if (tool.riskLevel === 'critical') {
      return {
        success: false,
        requiresConfirmation: true,
        confirmationMessage: `Critical action: ${tool.name}. Requires user confirmation.`,
      };
    }

    if (tool.riskLevel === 'high') {
      return {
        success: false,
        requiresConfirmation: true,
        confirmationMessage: `High-risk action: ${tool.name}. Requires user confirmation.`,
      };
    }

    // Execute
    try {
      const result = await tool.execute(params);
      
      // Verify if verification function exists
      if (tool.verify && result.success) {
        const verified = await tool.verify(params, result);
        if (!verified) {
          return {
            success: false,
            error: 'Verification failed',
            data: result.data,
          };
        }
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Tool execution failed',
      };
    }
  }

  private validateInput(tool: Tool, params: Record<string, any>): { valid: boolean; error?: string } {
    const schema = tool.inputSchema;
    
    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in params)) {
          return {
            valid: false,
            error: `Missing required parameter: ${field}`,
          };
        }
      }
    }

    // Check types
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in params) {
        const value = params[key];
        const expectedType = prop.type;

        if (expectedType === 'string' && typeof value !== 'string') {
          return {
            valid: false,
            error: `Parameter ${key} must be a string`,
          };
        }

        if (expectedType === 'number' && typeof value !== 'number') {
          return {
            valid: false,
            error: `Parameter ${key} must be a number`,
          };
        }

        if (expectedType === 'boolean' && typeof value !== 'boolean') {
          return {
            valid: false,
            error: `Parameter ${key} must be a boolean`,
          };
        }

        // Check enum
        if (prop.enum && !prop.enum.includes(value)) {
          return {
            valid: false,
            error: `Parameter ${key} must be one of: ${prop.enum.join(', ')}`,
          };
        }
      }
    }

    return { valid: true };
  }

  setContext(context: Partial<ToolExecutionContext>) {
    this.context = { ...this.context, ...context };
  }

  getContext(): ToolExecutionContext {
    return { ...this.context };
  }

  // Generate tool descriptions for LLM
  generateToolDescriptions(): string {
    const tools = this.getAllTools();
    return tools.map(tool => {
      const params = Object.entries(tool.inputSchema.properties)
        .map(([key, prop]) => `    - ${key}: ${prop.description}${prop.required ? ' (required)' : ''}`)
        .join('\n');

      return `${tool.id}: ${tool.description}
  Risk: ${tool.riskLevel}
  Parameters:
${params}`;
    }).join('\n\n');
  }
}

export const toolRegistry = new ToolRegistry();

// ============ BUILT-IN TOOLS ============

// Navigation tools
export const openAppTool: Tool = {
  id: 'open_app',
  name: 'Open Application',
  description: 'Open a specific application by name or package',
  category: 'navigation',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      appName: {
        type: 'string',
        description: 'Name of the application to open',
      },
      packageName: {
        type: 'string',
        description: 'Package name (e.g., com.example.app)',
      },
    },
    required: ['appName'],
  },
  async execute(params) {
    // This would integrate with PlatformHands
    return {
      success: true,
      data: { opened: params.appName },
    };
  },
  async isAvailable() {
    return true; // Would check if platform hands are available
  },
};

export const navigateToUrlTool: Tool = {
  id: 'navigate_url',
  name: 'Navigate to URL',
  description: 'Open a URL in the browser',
  category: 'navigation',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to',
      },
    },
    required: ['url'],
  },
  async execute(params) {
    if (typeof window !== 'undefined') {
      window.open(params.url, '_blank');
      return { success: true, data: { url: params.url } };
    }
    return { success: false, error: 'Cannot open URL in this environment' };
  },
  async isAvailable() {
    return typeof window !== 'undefined';
  },
};

// Interaction tools
export const tapElementTool: Tool = {
  id: 'tap_element',
  name: 'Tap UI Element',
  description: 'Tap on a UI element by text or ID',
  category: 'interaction',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      elementText: {
        type: 'string',
        description: 'Text content of the element to tap',
      },
      elementId: {
        type: 'string',
        description: 'ID of the element to tap',
      },
    },
  },
  async execute(params) {
    // This would integrate with PlatformHands
    return {
      success: true,
      data: { tapped: params.elementText || params.elementId },
    };
  },
  async isAvailable() {
    return false; // Requires Android Hands
  },
};

export const typeTextTool: Tool = {
  id: 'type_text',
  name: 'Type Text',
  description: 'Type text into the focused input field',
  category: 'interaction',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to type',
      },
      clearFirst: {
        type: 'boolean',
        description: 'Clear field before typing',
      },
    },
    required: ['text'],
  },
  async execute(params) {
    // This would integrate with PlatformHands
    return {
      success: true,
      data: { typed: params.text },
    };
  },
  async isAvailable() {
    return false; // Requires Android Hands
  },
};

// Data tools
export const searchWebTool: Tool = {
  id: 'search_web',
  name: 'Search Web',
  description: 'Search the web for information',
  category: 'data',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
    },
    required: ['query'],
  },
  async execute(params) {
    // This would integrate with a search API
    return {
      success: true,
      data: { query: params.query, results: [] },
    };
  },
  async isAvailable() {
    return true;
  },
};

// System tools
export const takeScreenshotTool: Tool = {
  id: 'take_screenshot',
  name: 'Take Screenshot',
  description: 'Capture the current screen',
  category: 'system',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      saveToGallery: {
        type: 'boolean',
        description: 'Save screenshot to gallery',
      },
    },
  },
  async execute(params) {
    // This would integrate with PlatformHands
    return {
      success: true,
      data: { screenshot: 'base64_data' },
    };
  },
  async isAvailable() {
    return false; // Requires Android Hands
  },
};

// Communication tools
export const sendMessageTool: Tool = {
  id: 'send_message',
  name: 'Send Message',
  description: 'Send a message via messaging app',
  category: 'communication',
  riskLevel: 'high',
  inputSchema: {
    type: 'object',
    properties: {
      recipient: {
        type: 'string',
        description: 'Recipient name or number',
      },
      message: {
        type: 'string',
        description: 'Message content',
      },
      app: {
        type: 'string',
        description: 'Messaging app to use',
        enum: ['telegram', 'whatsapp', 'sms', 'email'],
      },
    },
    required: ['recipient', 'message', 'app'],
  },
  async execute(params) {
    // This would integrate with PlatformHands
    return {
      success: true,
      data: { sent: true, recipient: params.recipient },
    };
  },
  async isAvailable() {
    return false; // Requires Android Hands
  },
};

// Register built-in tools
toolRegistry.registerTool(openAppTool);
toolRegistry.registerTool(navigateToUrlTool);
toolRegistry.registerTool(tapElementTool);
toolRegistry.registerTool(typeTextTool);
toolRegistry.registerTool(searchWebTool);
toolRegistry.registerTool(takeScreenshotTool);
toolRegistry.registerTool(sendMessageTool);
