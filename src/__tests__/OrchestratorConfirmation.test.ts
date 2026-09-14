import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orchestrator } from '../services/Orchestrator';
import { capabilityRouter } from '../services/CapabilityRouter';
import { policyEngine } from '../services/PolicyEngine';
import { toolRegistry } from '../services/ToolRegistry';
import { observationManager } from '../services/ObservationLayer';
import { verification } from '../services/Verification';
import { planner } from '../services/Planner';
import { avatarStateMachine } from '../services/AvatarStateMachine';

describe('Orchestrator confirmation lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks(); orchestrator.reset();
    const state: any = orchestrator as any;
    state.currentTask = { id: 'task-1', steps: [{ id: 'step-1', action: 'send_message', parameters: { app: 'telegram', contact: 'John', message: 'Hello' } }] };
    state.pendingConfirmation = { step: state.currentTask.steps[0], context: { source: 'test' }, preState: { currentApp: 'telegram' }, toolId: 'send_message', message: 'User confirmation required', goal: 'send and then capture' };
    vi.spyOn(capabilityRouter, 'resolve').mockImplementation(async ({ action }: any) => ({
      success: true,
      tool: { id: action === 'capture_screen' ? 'capture_screen' : 'send_message', name: action === 'capture_screen' ? 'Capture screen' : 'Send message' } as any,
      backend: 'native', candidates: []
    } as any));
    vi.spyOn(policyEngine, 'evaluate').mockResolvedValue({ decision: 'allow', reason: 'Allowed after confirmation' } as any);
    vi.spyOn(policyEngine, 'recordSuccessfulExecution').mockImplementation(() => undefined);
    vi.spyOn(toolRegistry, 'executeWithConfirmation').mockResolvedValue({ success: true, data: { sent: true }, verification: { status: 'PASS' } } as any);
    vi.spyOn(toolRegistry, 'executeTool').mockImplementation(async (toolId: string) => ({ success: true, data: toolId === 'capture_screen' ? { captured: true } : { sent: true }, verification: { status: 'PASS' } } as any));
    vi.spyOn(observationManager, 'observe').mockResolvedValue({ success: true, state: { currentApp: 'telegram', changed: true } } as any);
    vi.spyOn(observationManager, 'compareStates').mockReturnValue({ changed: true } as any);
    vi.spyOn(verification, 'verify').mockResolvedValue({ success: true } as any);
    vi.spyOn(planner, 'updateStepStatus').mockImplementation(() => undefined);
    vi.spyOn(avatarStateMachine, 'setSuccess').mockImplementation(() => undefined);
    vi.spyOn(avatarStateMachine, 'setError').mockImplementation(() => undefined);
    vi.spyOn(avatarStateMachine, 'setConfirmationRequired').mockImplementation(() => undefined);
  });

  it('resumes the exact pending step only after explicit confirmation and verifies it', async () => {
    const result = await orchestrator.confirmPendingStep();
    expect(result.success).toBe(true); expect(toolRegistry.executeWithConfirmation).toHaveBeenCalledWith('send_message', { app: 'telegram', contact: 'John', message: 'Hello' }); expect(verification.verify).toHaveBeenCalled(); expect((orchestrator as any).pendingConfirmation).toBeNull(); expect(planner.updateStepStatus).toHaveBeenCalledWith('task-1', 'step-1', 'completed', expect.anything());
  });

  it('continues remaining steps after a confirmed step', async () => {
    const state: any = orchestrator as any;
    const step1 = state.currentTask.steps[0];
    state.currentTask.steps.push({ id: 'step-2', action: 'capture_screen', parameters: {} }); state.pendingConfirmation.step = step1;
    const result = await orchestrator.confirmPendingStep();
    expect(result.success).toBe(true); expect(toolRegistry.executeWithConfirmation).toHaveBeenCalledTimes(1); expect(toolRegistry.executeTool).toHaveBeenCalledWith('capture_screen', {}); expect(planner.updateStepStatus).toHaveBeenCalledWith('task-1', 'step-2', 'completed', expect.anything()); expect((orchestrator as any).state).toBe('complete');
  });

  it('pauses again when post-confirmation policy still requires confirmation', async () => {
    vi.spyOn(policyEngine, 'evaluate').mockResolvedValueOnce({ decision: 'require_confirmation', reason: 'Second confirmation required' } as any);
    const result = await orchestrator.confirmPendingStep();
    expect(result.success).toBe(false); expect(result.requiresConfirmation).toBe(true); expect(result.confirmationMessage).toBe('Second confirmation required'); expect((orchestrator as any).pendingConfirmation).not.toBeNull(); expect(toolRegistry.executeWithConfirmation).not.toHaveBeenCalled();
  });

  it('never executes when the post-confirmation policy changes to deny', async () => {
    vi.spyOn(policyEngine, 'evaluate').mockResolvedValueOnce({ decision: 'deny', reason: 'Risk policy denied' } as any);
    const result = await orchestrator.confirmPendingStep(); expect(result.success).toBe(false); expect(result.error).toBe('Risk policy denied'); expect(toolRegistry.executeWithConfirmation).not.toHaveBeenCalled();
  });

  it('returns a deterministic error when confirmation is requested without a pending action', async () => {
    orchestrator.reset(); const result = await orchestrator.confirmPendingStep(); expect(result).toEqual({ success: false, error: 'No pending confirmation' });
  });
});
