import { describe, expect, it } from 'vitest';
import { verification } from '../services/Verification';
import { policyEngine } from '../services/PolicyEngine';

describe('verification and policy regressions', () => {
  it('treats expected state as a partial contract and ignores runtime metadata', async () => {
    const result = await verification.verify({
      action: 'test',
      expectedState: { success: true },
      actualState: { success: true, requestId: 'exec_test', timestamp: Date.now(), verification: { status: 'PASS', confidence: 1 } },
    });
    expect(result.success).toBe(true);
    expect(result.differences).toEqual([]);
  });

  it('counts only successful executions against a daily limit', async () => {
    const tool = {
      id: 'regression_tool', name: 'Regression Tool', description: 'test',
      inputSchema: { type: 'object', properties: {} }, riskLevel: 'low', category: 'system',
      execute: async () => ({ success: true }), isAvailable: async () => true,
    } as any;
    policyEngine.setDailyLimit(tool.id, 1);
    policyEngine.resetDailyCounts();
    const before = await policyEngine.evaluate(tool, { platform: 'web', environment: {} });
    expect(before.decision).toBe('allow');
    expect(policyEngine.getDailyExecutionCount(tool.id)).toBe(0);
    policyEngine.recordSuccessfulExecution(tool.id);
    const after = await policyEngine.evaluate(tool, { platform: 'web', environment: {} });
    expect(after.decision).toBe('deny');
    expect(policyEngine.getDailyExecutionCount(tool.id)).toBe(1);
    policyEngine.resetDailyCounts();
  });

  it('uses capture_screen as the Android screenshot tool id', () => {
    const rules = policyEngine.getRules();
    const platformRule = rules.find(rule => rule.id === 'platform_restrictions');
    expect(platformRule).toBeDefined();
    const screenshot = { id: 'capture_screen', name: 'Capture Screen', description: '', inputSchema: { type: 'object', properties: {} }, riskLevel: 'low', category: 'system' } as any;
    expect(platformRule!.applies(screenshot, { platform: 'web', environment: {} })).toBe(true);
  });
});
