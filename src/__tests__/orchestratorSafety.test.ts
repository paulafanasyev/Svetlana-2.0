// Оркестратор не действует вслепую, не запускает две задачи сразу и отменяется кнопкой «Сброс».
import { describe, it, expect, vi, afterEach } from 'vitest';
import { orchestrator, sanitizeOrchestratorConfig, ORCH_BUSY, ORCH_CANCELLED, ORCH_NO_OBSERVATION, ORCH_TARGET_MISSING } from '../services/Orchestrator';
import { planner, type Task } from '../services/Planner';
import { observationManager } from '../services/ObservationLayer';
import { toolRegistry } from '../services/ToolRegistry';

const task = (steps: Task['steps']): Task => ({ id: `t_${Math.random()}`, description: 'x', steps, status: 'planning', createdAt: Date.now() });

afterEach(() => {
  vi.restoreAllMocks();
  orchestrator.reset();
});

describe('orchestrator config', () => {
  it('keeps only known fields and clamps retries', () => {
    expect(sanitizeOrchestratorConfig({ maxRetries: 999, enableMemory: 'yes', extra: 1 })).toEqual({
      maxRetries: 5, enableVerification: true, enableReflection: true, enableMemory: true,
    });
    expect(sanitizeOrchestratorConfig({ maxRetries: Number.NaN }).maxRetries).toBe(3);
    expect(sanitizeOrchestratorConfig(null).maxRetries).toBe(3);
  });
});

describe('orchestrator safety', () => {
  it('does nothing when it cannot see the screen', async () => {
    orchestrator.updateConfig({ enableMemory: false });
    vi.spyOn(planner, 'createPlan').mockResolvedValue(task([{ id: 's1', action: 'execute', status: 'pending' }]));
    vi.spyOn(observationManager, 'observe').mockResolvedValue({ success: false, error: 'no', confidence: 0 });
    const run = vi.spyOn(toolRegistry, 'executeTool');
    const r = await orchestrator.execute('test');
    expect(r.success).toBe(false);
    expect(r.error).toBe(ORCH_NO_OBSERVATION);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not act when the target is not on the screen', async () => {
    orchestrator.updateConfig({ enableMemory: false });
    vi.spyOn(planner, 'createPlan').mockResolvedValue(task([{ id: 's1', action: 'tap', target: 'Оплатить', status: 'pending' }]));
    vi.spyOn(observationManager, 'observe').mockResolvedValue({ success: true, confidence: 1, state: { timestamp: 1, platform: 'web', elements: [] } });
    vi.spyOn(observationManager, 'findElementByText').mockResolvedValue(null);
    const run = vi.spyOn(toolRegistry, 'executeTool');
    const r = await orchestrator.execute('нажми Оплатить');
    expect(r.success).toBe(false);
    expect(r.error).toContain(ORCH_TARGET_MISSING);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs one task at a time and reset cancels the running one', async () => {
    orchestrator.updateConfig({ enableMemory: false });
    let release: (t: Task) => void = () => undefined;
    vi.spyOn(planner, 'createPlan').mockImplementation(() => new Promise<Task>(res => { release = res; }));
    const run = vi.spyOn(toolRegistry, 'executeTool');
    const first = orchestrator.execute('первая');
    expect(orchestrator.isRunning()).toBe(true);
    const second = await orchestrator.execute('вторая');
    expect(second).toEqual({ success: false, error: ORCH_BUSY });
    orchestrator.reset();
    expect(orchestrator.isRunning()).toBe(false);
    release(task([{ id: 's1', action: 'execute', status: 'pending' }]));
    const r = await first;
    expect(r).toEqual({ success: false, error: ORCH_CANCELLED });
    expect(run).not.toHaveBeenCalled();
  });
});
