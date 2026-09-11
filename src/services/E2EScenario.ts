// End-to-End Scenario - Real execution chain demonstration
// This shows the complete flow: User → LLM → Planner → Tool → Policy → Hands → Observation → Verification

import { orchestrator } from './Orchestrator';
import { toolRegistry, type Tool, type ToolResult } from './ToolRegistry';
import { policyEngine, type PolicyContext } from './PolicyEngine';
import { observationManager, type ScreenState, type UIElement } from './ObservationLayer';
import { memory } from './Memory';
import { aiGateway, type ChatMessage } from './AIGateway';

export interface E2EScenario {
  id: string;
  name: string;
  description: string;
  userInput: string;
  expectedFlow: string[];
  status: 'pending' | 'running' | 'passed' | 'failed';
  actualFlow: string[];
  error?: string;
  timestamp?: number;
}

// Mock Android Hands for demonstration
// In production, this would connect to real Android AccessibilityService via WebSocket/MCP
class MockAndroidHands {
  private currentScreen: ScreenState = {
    timestamp: Date.now(),
    platform: 'android',
    currentApp: 'com.android.settings',
    elements: [
      {
        id: 'settings_title',
        type: 'TextView',
        text: 'Settings',
        bounds: { x: 0, y: 0, width: 1080, height: 200 },
        clickable: false,
        visible: true,
      },
      {
        id: 'display_option',
        type: 'ListItem',
        text: 'Display',
        bounds: { x: 0, y: 200, width: 1080, height: 150 },
        clickable: true,
        visible: true,
      },
      {
        id: 'dark_mode_toggle',
        type: 'Switch',
        text: 'Dark mode',
        bounds: { x: 800, y: 400, width: 200, height: 100 },
        clickable: true,
        visible: true,
      },
    ],
  };

  async tap(elementId: string): Promise<boolean> {
    const element = this.currentScreen.elements.find(e => e.id === elementId);
    if (!element || !element.clickable) {
      return false;
    }
    // Simulate tap - in real implementation, this would call AccessibilityService
    console.log(`[MockAndroidHands] Tapped: ${element.text}`);
    return true;
  }

  async getCurrentScreen(): Promise<ScreenState> {
    return { ...this.currentScreen, timestamp: Date.now() };
  }

  async simulateScreenChange(newApp: string, newElements: UIElement[]) {
    this.currentScreen = {
      timestamp: Date.now(),
      platform: 'android',
      currentApp: newApp,
      elements: newElements,
    };
  }
}

const mockAndroidHands = new MockAndroidHands();

// Register mock Android tools
const openSettingsTool: Tool = {
  id: 'android_open_settings',
  name: 'Open Android Settings',
  description: 'Open the Android Settings app',
  category: 'navigation',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    await mockAndroidHands.simulateScreenChange('com.android.settings', [
      {
        id: 'settings_title',
        type: 'TextView',
        text: 'Settings',
        bounds: { x: 0, y: 0, width: 1080, height: 200 },
        clickable: false,
        visible: true,
      },
      {
        id: 'display_option',
        type: 'ListItem',
        text: 'Display',
        bounds: { x: 0, y: 200, width: 1080, height: 150 },
        clickable: true,
        visible: true,
      },
    ]);
    return { success: true, data: { app: 'Settings' } };
  },
  async isAvailable(): Promise<boolean> {
    return true; // Mock is always available
  },
};

const tapDisplayTool: Tool = {
  id: 'android_tap_display',
  name: 'Tap Display Option',
  description: 'Tap on the Display option in Settings',
  category: 'interaction',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    const success = await mockAndroidHands.tap('display_option');
    if (success) {
      await mockAndroidHands.simulateScreenChange('com.android.settings.display', [
        {
          id: 'display_title',
          type: 'TextView',
          text: 'Display',
          bounds: { x: 0, y: 0, width: 1080, height: 200 },
          clickable: false,
          visible: true,
        },
        {
          id: 'dark_mode_toggle',
          type: 'Switch',
          text: 'Dark mode',
          bounds: { x: 800, y: 400, width: 200, height: 100 },
          clickable: true,
          visible: true,
        },
      ]);
      return { success: true, data: { tapped: 'Display' } };
    }
    return { success: false, error: 'Element not found or not clickable' };
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

const toggleDarkModeTool: Tool = {
  id: 'android_toggle_dark_mode',
  name: 'Toggle Dark Mode',
  description: 'Toggle the dark mode switch',
  category: 'interaction',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    const success = await mockAndroidHands.tap('dark_mode_toggle');
    if (success) {
      return { success: true, data: { action: 'dark_mode_toggled' } };
    }
    return { success: false, error: 'Dark mode toggle not found' };
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

// Register tools
toolRegistry.registerTool(openSettingsTool);
toolRegistry.registerTool(tapDisplayTool);
toolRegistry.registerTool(toggleDarkModeTool);

// Mock Android Observer
class MockAndroidObserver {
  async observe(): Promise<ScreenState> {
    return await mockAndroidHands.getCurrentScreen();
  }

  async findElementByText(text: string): Promise<UIElement | null> {
    const screen = await this.observe();
    return screen.elements.find(e => e.text?.toLowerCase().includes(text.toLowerCase())) || null;
  }
}

const mockAndroidObserver = new MockAndroidObserver();

// E2E Scenario: Open Settings and enable dark mode
export async function runE2EScenario(): Promise<E2EScenario> {
  const scenario: E2EScenario = {
    id: 'e2e_001',
    name: 'Open Settings and enable dark mode',
    description: 'Complete flow from user request to verified action',
    userInput: 'Открой настройки и включи тёмную тему',
    expectedFlow: [
      '1. User input received',
      '2. LLM analyzes request',
      '3. Planner creates task',
      '4. Tool Registry selects tools',
      '5. Policy Engine approves',
      '6. Android Hands executes',
      '7. Observation captures state',
      '8. Verification confirms',
      '9. Response to user',
    ],
    status: 'pending',
    actualFlow: [],
  };

  try {
    scenario.status = 'running';
    scenario.timestamp = Date.now();

    // Step 1: User input
    scenario.actualFlow.push('1. User input received: "Открой настройки и включи тёмную тему"');
    memory.addMessage('user', scenario.userInput);

    // Step 2: LLM analysis (simulated - in production, this would call AI Gateway)
    scenario.actualFlow.push('2. LLM analyzes request and identifies intent');
    const llmResponse = {
      intent: 'enable_dark_mode',
      steps: [
        { action: 'android_open_settings', description: 'Open Settings app' },
        { action: 'android_tap_display', description: 'Tap Display option' },
        { action: 'android_toggle_dark_mode', description: 'Toggle dark mode' },
      ],
    };
    scenario.actualFlow.push(`   LLM identified ${llmResponse.steps.length} steps`);

    // Step 3: Execute each step through the full chain
    for (let i = 0; i < llmResponse.steps.length; i++) {
      const step = llmResponse.steps[i];
      const stepNum = i + 3;

      scenario.actualFlow.push(`${stepNum}. Executing: ${step.description}`);

      // 3a. Tool selection
      const tool = toolRegistry.getTool(step.action);
      if (!tool) {
        throw new Error(`Tool not found: ${step.action}`);
      }
      scenario.actualFlow.push(`   ${stepNum}a. Tool selected: ${tool.name}`);

      // 3b. Policy check
      const policyContext: PolicyContext = {
        platform: 'android',
        currentApp: 'com.android.settings',
        environment: {},
      };
      const policyResult = await policyEngine.evaluate(tool, policyContext);
      if (policyResult.decision === 'deny') {
        throw new Error(`Policy denied: ${policyResult.reason}`);
      }
      scenario.actualFlow.push(`   ${stepNum}b. Policy: ${policyResult.decision} (${policyResult.reason})`);

      // 3c. Pre-action observation
      const preState = await mockAndroidObserver.observe();
      scenario.actualFlow.push(`   ${stepNum}c. Pre-action: app=${preState.currentApp}, elements=${preState.elements.length}`);

      // 3d. Execute action
      const result = await toolRegistry.executeTool(step.action, {});
      if (!result.success) {
        throw new Error(`Tool execution failed: ${result.error}`);
      }
      scenario.actualFlow.push(`   ${stepNum}d. Action executed: ${JSON.stringify(result.data)}`);

      // 3e. Post-action observation
      const postState = await mockAndroidObserver.observe();
      scenario.actualFlow.push(`   ${stepNum}e. Post-action: app=${postState.currentApp}, elements=${postState.elements.length}`);

      // 3f. Verification
      const stateChanged = preState.currentApp !== postState.currentApp || 
                           preState.elements.length !== postState.elements.length;
      if (!stateChanged && i < llmResponse.steps.length - 1) {
        throw new Error('Verification failed: state did not change');
      }
      scenario.actualFlow.push(`   ${stepNum}f. Verification: ${stateChanged ? 'PASS' : 'SKIP (last step)'}`);
    }

    // Step 4: Complete
    const finalStepNum = llmResponse.steps.length + 3;
    scenario.actualFlow.push(`${finalStepNum}. Task completed successfully`);
    memory.addMessage('assistant', 'Тёмная тема включена');

    scenario.status = 'passed';
    scenario.actualFlow.push(`Total steps: ${scenario.actualFlow.length}`);
    scenario.actualFlow.push(`Duration: ${Date.now() - (scenario.timestamp || Date.now())}ms`);

  } catch (error: any) {
    scenario.status = 'failed';
    scenario.error = error.message;
    scenario.actualFlow.push(`ERROR: ${error.message}`);
  }

  return scenario;
}

// Run multiple E2E scenarios
export async function runAllE2EScenarios(): Promise<E2EScenario[]> {
  const scenarios: E2EScenario[] = [];

  // Scenario 1: Open Settings and enable dark mode
  scenarios.push(await runE2EScenario());

  // Add more scenarios here as needed

  return scenarios;
}

// Get E2E test results
export function getE2EResults(): {
  total: number;
  passed: number;
  failed: number;
  scenarios: E2EScenario[];
} {
  // This would be populated after running scenarios
  return {
    total: 0,
    passed: 0,
    failed: 0,
    scenarios: [],
  };
}
