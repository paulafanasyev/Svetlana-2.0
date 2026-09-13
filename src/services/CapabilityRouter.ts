// Capability Router - routes planner/tool requests through the existing ToolRegistry.
// This is NOT a second registry and contains no tool implementations.

import {
  toolRegistry,
  type Tool,
  type ToolBackend,
  type ToolCapability,
} from './ToolRegistry';

export interface CapabilityRouteRequest {
  action: string;
  capability?: ToolCapability;
  parameters?: Record<string, any>;
}

export interface CapabilityRouteResult {
  success: boolean;
  tool?: Tool;
  error?: string;
  candidates: string[];
  backend?: ToolBackend;
}

const ACTION_CAPABILITIES: Record<string, ToolCapability> = {
  launchApp: 'navigation',
  tap: 'interaction',
  type: 'interaction',
  swipe: 'interaction',
  pressBack: 'navigation',
  screenshot: 'vision',
  readScreen: 'vision',
  speak: 'speech',
  transcribe: 'speech',
  generateImage: 'image',
  understandImage: 'vision',
  understandVideo: 'video',
  readDocument: 'document',
  generateDocument: 'document',
  generateContract: 'contract',
};

const BACKEND_PRIORITY: ToolBackend[] = [
  'LOCAL_FREE',
  'USER_CONNECTED',
  'OPTIONAL_CLOUD',
];

class CapabilityRouter {
  async resolve(request: CapabilityRouteRequest): Promise<CapabilityRouteResult> {
    const candidates: Tool[] = [];
    const exact = toolRegistry.getTool(request.action);
    if (exact) candidates.push(exact);

    const capability = request.capability || ACTION_CAPABILITIES[request.action];
    if (capability) {
      for (const tool of toolRegistry.getToolsByCapability(capability)) {
        if (!candidates.some(candidate => candidate.id === tool.id)) candidates.push(tool);
      }
    }

    if (candidates.length === 0) {
      return {
        success: false,
        error: `No registered tool for action/capability: ${request.action}${capability ? ` / ${capability}` : ''}`,
        candidates: [],
      };
    }

    // Explicitly classified free/local tools must outrank connected/cloud tools.
    // Unclassified legacy tools are retained for compatibility but never receive
    // an implicit priority advantage over a classified backend.
    const ordered = candidates
      .filter(tool => tool.external?.backend !== 'REJECTED')
      .sort((a, b) => this.backendRank(a) - this.backendRank(b));

    if (ordered.length === 0) {
      return {
        success: false,
        error: `All registered candidates are rejected: ${request.action}`,
        candidates: candidates.map(tool => tool.id),
      };
    }

    const available: Tool[] = [];
    for (const tool of ordered) {
      if (await tool.isAvailable()) available.push(tool);
    }

    if (available.length === 0) {
      return {
        success: false,
        error: `No available tool for action/capability: ${request.action}${capability ? ` / ${capability}` : ''}`,
        candidates: ordered.map(tool => tool.id),
      };
    }

    const selected = available[0];
    return {
      success: true,
      tool: selected,
      candidates: ordered.map(tool => tool.id),
      backend: selected.external?.backend,
    };
  }

  private backendRank(tool: Tool): number {
    const backend = tool.external?.backend;
    if (!backend) return BACKEND_PRIORITY.length + 1;
    const index = BACKEND_PRIORITY.indexOf(backend);
    return index >= 0 ? index : BACKEND_PRIORITY.length + 1;
  }
}

export const capabilityRouter = new CapabilityRouter();
