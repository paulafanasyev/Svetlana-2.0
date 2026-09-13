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

// Legacy built-ins use stable implementation ids rather than the planner's
// semantic action names. Keep this compatibility mapping here so capability
// routing cannot accidentally select an unrelated tool from the same category.
const LEGACY_ACTION_TO_TOOL: Record<string, string> = {
  launchApp: 'open_app',
  tap: 'tap_element',
  type: 'type_text',
  swipe: 'swipe',
  pressBack: 'go_back',
  screenshot: 'capture_screen',
};

const BACKEND_PRIORITY: ToolBackend[] = [
  'LOCAL_FREE',
  'USER_CONNECTED',
  'OPTIONAL_CLOUD',
];

class CapabilityRouter {
  async resolve(request: CapabilityRouteRequest): Promise<CapabilityRouteResult> {
    const candidates: Tool[] = [];

    const addCandidate = (tool?: Tool) => {
      if (tool && !candidates.some(candidate => candidate.id === tool.id)) {
        candidates.push(tool);
      }
    };

    // 1. Exact registered action remains the strongest identity match.
    addCandidate(toolRegistry.getTool(request.action));

    // 2. Resolve planner semantic actions to the real legacy implementation ids.
    // This is required for existing tools such as launchApp -> open_app.
    const legacyToolId = LEGACY_ACTION_TO_TOOL[request.action];
    if (legacyToolId) addCandidate(toolRegistry.getTool(legacyToolId));

    // 3. Add capability candidates from the single existing ToolRegistry.
    const capability = request.capability || ACTION_CAPABILITIES[request.action];
    if (capability) {
      for (const tool of toolRegistry.getToolsByCapability(capability)) {
        addCandidate(tool);
      }
    }

    if (candidates.length === 0) {
      return {
        success: false,
        error: `No registered tool for action/capability: ${request.action}${capability ? ` / ${capability}` : ''}`,
        candidates: [],
      };
    }

    // Free/local first. REJECTED is never routable.
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
    // Existing RealTools are local device tools but predate ExternalToolMetadata.
    // Treat them as LOCAL_FREE rather than allowing an unclassified tool to
    // outrank a real local/connected/cloud backend by accident.
    if (!backend) return 1;
    const index = BACKEND_PRIORITY.indexOf(backend);
    return index >= 0 ? index + 1 : BACKEND_PRIORITY.length + 1;
  }
}

export const capabilityRouter = new CapabilityRouter();
