// Real E2E Test - Uses actual Android device via HandsManager
// This test is NOT PROVEN without real Android device
// It demonstrates the complete execution pipeline

import { handsManager } from '../services/HandsManager';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';

export interface RealE2EResult {
  scenario: string;
  steps: Array<{
    step: number;
    action: string;
    status: 'pending' | 'running' | 'passed' | 'failed';
    timestamp: number;
    data?: any;
    error?: string;
  }>;
  success: boolean;
  startTime: number;
  endTime?: number;
  duration?: number;
}

/**
 * Real E2E Test: "Open Telegram"
 * This test uses REAL Android device via HandsManager
 * NOT PROVEN without real Android device
 */
export async function runRealE2ETest_OpenTelegram(): Promise<RealE2EResult> {
  const result: RealE2EResult = {
    scenario: 'Open Telegram',
    steps: [],
    success: false,
    startTime: Date.now(),
  };

  try {
    // Step 1: Check connection
    result.steps.push({
      step: 1,
      action: 'Check Android connection',
      status: 'running',
      timestamp: Date.now(),
    });

    const connected = await handsManager.isConnected();
    if (!connected) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = 'Android device not connected. Please connect via Android Connection page.';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = { connected: true };

    // Step 2: Get device info
    result.steps.push({
      step: 2,
      action: 'Get device info',
      status: 'running',
      timestamp: Date.now(),
    });

    const hands = handsManager.getHands();
    if (!hands) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = 'Hands not available';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    const deviceInfo = await hands.getDeviceInfo();
    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = deviceInfo;

    // Step 3: Get current app (before)
    result.steps.push({
      step: 3,
      action: 'Get current app (before)',
      status: 'running',
      timestamp: Date.now(),
    });

    const beforeApp = await hands.getCurrentApp();
    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = { currentApp: beforeApp };

    // Step 4: Launch Telegram
    result.steps.push({
      step: 4,
      action: 'Launch Telegram (org.telegram.messenger)',
      status: 'running',
      timestamp: Date.now(),
    });

    const launchResult = await hands.launchApp('org.telegram.messenger');
    if (!launchResult.success) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = launchResult.error || 'Failed to launch Telegram';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = launchResult;

    // Step 5: Wait for app to start
    result.steps.push({
      step: 5,
      action: 'Wait for app to start (1000ms)',
      status: 'running',
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 1000));
    result.steps[result.steps.length - 1].status = 'passed';

    // Step 6: Get current app (after)
    result.steps.push({
      step: 6,
      action: 'Get current app (after)',
      status: 'running',
      timestamp: Date.now(),
    });

    const afterApp = await hands.getCurrentApp();
    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = { currentApp: afterApp };

    // Step 7: Verification
    result.steps.push({
      step: 7,
      action: 'Verification: check if Telegram is active',
      status: 'running',
      timestamp: Date.now(),
    });

    const verified = afterApp === 'org.telegram.messenger';
    if (!verified) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = `Verification failed: expected org.telegram.messenger, got ${afterApp}`;
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = {
      expected: 'org.telegram.messenger',
      actual: afterApp,
      verified: true,
    };

    // Success
    result.success = true;
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;

    return result;
  } catch (error: any) {
    result.steps.push({
      step: result.steps.length + 1,
      action: 'Error',
      status: 'failed',
      timestamp: Date.now(),
      error: error.message,
    });
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;
    return result;
  }
}

/**
 * Real E2E Test: "Send Message"
 * This test uses REAL Android device via HandsManager
 * NOT PROVEN without real Android device
 */
export async function runRealE2ETest_SendMessage(
  app: string,
  contact: string,
  message: string
): Promise<RealE2EResult> {
  const result: RealE2EResult = {
    scenario: `Send message via ${app}`,
    steps: [],
    success: false,
    startTime: Date.now(),
  };

  try {
    // Step 1: Check connection
    result.steps.push({
      step: 1,
      action: 'Check Android connection',
      status: 'running',
      timestamp: Date.now(),
    });

    const connected = await handsManager.isConnected();
    if (!connected) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = 'Android device not connected';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    result.steps[result.steps.length - 1].status = 'passed';

    // Step 2: Use sendMessageTool
    result.steps.push({
      step: 2,
      action: `Send message to ${contact}: "${message}"`,
      status: 'running',
      timestamp: Date.now(),
    });

    const sendMessageTool = toolRegistry.getTool('send_message');
    if (!sendMessageTool) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = 'send_message tool not found';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    const sendResult = await sendMessageTool.execute({ app, contact, message });
    if (!sendResult.success) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = sendResult.error || 'Failed to send message';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = sendResult.data;

    // Step 3: Verification
    result.steps.push({
      step: 3,
      action: 'Verification: check if message was sent',
      status: 'running',
      timestamp: Date.now(),
    });

    const verified = await sendMessageTool.verify!({ app, contact, message }, sendResult);
    if (!verified) {
      result.steps[result.steps.length - 1].status = 'failed';
      result.steps[result.steps.length - 1].error = 'Message not found in chat after sending';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      return result;
    }

    result.steps[result.steps.length - 1].status = 'passed';
    result.steps[result.steps.length - 1].data = { verified: true };

    // Success
    result.success = true;
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;

    return result;
  } catch (error: any) {
    result.steps.push({
      step: result.steps.length + 1,
      action: 'Error',
      status: 'failed',
      timestamp: Date.now(),
      error: error.message,
    });
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;
    return result;
  }
}

/**
 * Run all real E2E tests
 * NOT PROVEN without real Android device
 */
export async function runAllRealE2ETests(): Promise<RealE2EResult[]> {
  const results: RealE2EResult[] = [];

  // Test 1: Open Telegram
  results.push(await runRealE2ETest_OpenTelegram());

  // Test 2: Send message (if first test passed)
  if (results[0].success) {
    results.push(
      await runRealE2ETest_SendMessage(
        'org.telegram.messenger',
        'Test Contact',
        'Hello from Svetlana 2.0!'
      )
    );
  }

  return results;
}
