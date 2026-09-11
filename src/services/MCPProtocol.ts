// MCP (Model Context Protocol) - Minimal implementation for Android communication
// This is a JSON-RPC 2.0 based protocol for tool execution

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, any>;
  timestamp: number;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string;
  result?: any;
  error?: MCPError;
  timestamp: number;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

export interface MCPObservation {
  screenState?: any;
  accessibilityTree?: any;
  currentApp?: string;
  timestamp: number;
}

export interface MCPVerification {
  status: 'PASS' | 'FAIL' | 'PENDING';
  confidence: number;
  details?: string;
  beforeState?: any;
  afterState?: any;
}

// MCP Methods
export type MCPMethod = 
  | 'device.getInfo'
  | 'app.launch'
  | 'app.close'
  | 'app.getCurrent'
  | 'ui.tap'
  | 'ui.longPress'
  | 'ui.swipe'
  | 'input.type'
  | 'input.clear'
  | 'input.key'
  | 'screen.capture'
  | 'accessibility.getTree'
  | 'accessibility.findElementByText'
  | 'accessibility.findElementById'
  | 'system.home'
  | 'system.back'
  | 'system.recents'
  | 'health.check';

// MCP Error Codes
export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  
  // Custom error codes
  DEVICE_NOT_CONNECTED: -32000,
  ELEMENT_NOT_FOUND: -32001,
  ACTION_FAILED: -32002,
  TIMEOUT: -32003,
  PERMISSION_DENIED: -32004,
  VERIFICATION_FAILED: -32005,
} as const;

// Create MCP request
export function createMCPRequest(method: MCPMethod, params: Record<string, any> = {}): MCPRequest {
  return {
    jsonrpc: '2.0',
    id: `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    method,
    params,
    timestamp: Date.now(),
  };
}

// Create MCP response
export function createMCPResponse(id: string, result?: any, error?: MCPError): MCPResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
    error,
    timestamp: Date.now(),
  };
}

// Create MCP error
export function createMCPError(code: number, message: string, data?: any): MCPError {
  return {
    code,
    message,
    data,
  };
}

// Parse MCP message
export function parseMCPMessage(data: string): MCPRequest | MCPResponse | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.jsonrpc === '2.0') {
      if ('method' in parsed) {
        return parsed as MCPRequest;
      } else if ('id' in parsed) {
        return parsed as MCPResponse;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// MCP Server interface (for Svetlana-App)
export interface MCPServer {
  handleRequest(request: MCPRequest): Promise<MCPResponse>;
  getSupportedMethods(): MCPMethod[];
}

// MCP Client interface (for Svetlana-2.0)
export interface MCPClient {
  sendRequest(method: MCPMethod, params: Record<string, any>): Promise<MCPResponse>;
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// Documentation
export const MCP_DOCUMENTATION = {
  protocol: 'JSON-RPC 2.0',
  transport: ['WebSocket', 'HTTP'],
  authentication: 'None (local network only)',
  
  methods: {
    'device.getInfo': {
      description: 'Get device information',
      params: {},
      result: {
        platform: 'android',
        model: 'string',
        osVersion: 'string',
        screenWidth: 'number',
        screenHeight: 'number',
      },
    },
    'app.launch': {
      description: 'Launch an Android application',
      params: {
        packageName: 'string (required)',
      },
      result: {
        success: 'boolean',
        observation: 'MCPObservation',
      },
    },
    'ui.tap': {
      description: 'Tap at coordinates',
      params: {
        x: 'number (required)',
        y: 'number (required)',
      },
      result: {
        success: 'boolean',
        observation: 'MCPObservation',
      },
    },
    'input.type': {
      description: 'Type text into focused input',
      params: {
        text: 'string (required)',
      },
      result: {
        success: 'boolean',
      },
    },
    'screen.capture': {
      description: 'Capture screen screenshot',
      params: {},
      result: {
        image: 'string (base64)',
        width: 'number',
        height: 'number',
      },
    },
    'accessibility.getTree': {
      description: 'Get accessibility tree',
      params: {},
      result: {
        root: 'UIElement',
        timestamp: 'number',
      },
    },
  },
  
  security: {
    notes: [
      'MCP server should only listen on local network',
      'No authentication implemented - assume trusted network',
      'For production: add authentication and encryption',
    ],
  },
};
