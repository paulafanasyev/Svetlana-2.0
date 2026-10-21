// Orchestrator - Central coordination for all agent modules
// Безопасность и надёжность:
// - не видим экран (наблюдение не удалось) — ничего не делаем вслепую;
// - цель шага не найдена на экране — шаг не выполняется;
// - проверка результата учитывает изменение экрана; при неудаче мы только смотрим ещё раз,
//   а НЕ повторяем действие (дважды отправленное сообщение или платёж хуже ошибки);
// - одновременно идёт одна задача; reset() отменяет текущую (после отмены ни одно действие не запускается);
//   если в момент сброса действие уже выполняется, новая задача ждёт его окончания (два действия сразу не идут);
// - настройки из хранилища проверяются (sanitizeOrchestratorConfig), ошибка подписчика не ломает задачу;
// - дневной лимит инструмента списывается только после успешного действия (policyEngine.recordExecution).

import { planner, type Task, type TaskStep } from './Planner';
import { memory } from './Memory';
import { verification } from './Verification';
import { toolRegistry } from './ToolRegistry';
import { policyEngine, type PolicyContext } from './PolicyEngine';
import { observationManager, type ScreenState } from './ObservationLayer';
import { avatarStateMachine } from './AvatarStateMachine';

export type AgentState = 'idle' | 'understanding' | 'planning' | 'observing' | 'grounding' | 'policy' | 'acting' | 'verifying' | 'reflecting' | 'complete' | 'error';

export interface AgentEvent {
  type: string;
  state: AgentState;
  detail: string;
  timestamp: number;
  data?: any;
}

export interface OrchestratorConfig {
  maxRetries: number;
  enableVerification: boolean;
  enableReflection: boolean;
  enableMemory: boolean;
}

export const ORCH_BUSY = 'Светлана уже выполняет другую задачу. Дождитесь её или нажмите «Сброс».';
export const ORCH_CANCELLED = 'Задача отменена.';
export const ORCH_NO_OBSERVATION = 'Не удалось посмотреть на экран, поэтому действие не выполнено.';
export const ORCH_TARGET_MISSING = 'На экране не найдено';
export const ORCH_NOT_VERIFIED = 'Не удалось убедиться, что действие сработало. Повторять его сама Светлана не будет: проверьте экран.';

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRetries: 3,
  enableVerification: true,
  enableReflection: true,
  enableMemory: true,
};

/** Настройки из хранилища или формы: только известные поля, число повторных проверок 0–5. */
export function sanitizeOrchestratorConfig(raw: unknown, base: OrchestratorConfig = DEFAULT_CONFIG): OrchestratorConfig {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const n = Number(r.maxRetries);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    maxRetries: Number.isFinite(n) ? Math.min(5, Math.max(0, Math.floor(n))) : base.maxRetries,
    enableVerification: bool(r.enableVerification, base.enableVerification),
    enableReflection: bool(r.enableReflection, base.enableReflection),
    enableMemory: bool(r.enableMemory, base.enableMemory),
  };
}

type StepResult = { success: boolean; error?: string };

class Orchestrator {
  private state: AgentState = 'idle';
  private currentTask: Task | null = null;
  private eventLog: AgentEvent[] = [];
  private config: OrchestratorConfig = { ...DEFAULT_CONFIG };
  /** Номер текущего запуска: reset() его меняет, и старый запуск останавливается на ближайшей проверке. */
  private runId = 0;
  private running = false;
  /** Какой запуск держит «занято» (0 — никакой). */
  private holder = 0;
  /** Идёт действие инструмента: сброс не снимает «занято», пока оно не закончится. */
  private acting = false;

  private listeners: ((event: AgentEvent) => void)[] = [];

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('svetlana_orchestrator_config') : null;
      if (stored && stored.length < 10_000) {
        this.config = sanitizeOrchestratorConfig(JSON.parse(stored));
      }
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private saveConfig() {
    try {
      localStorage.setItem('svetlana_orchestrator_config', JSON.stringify(this.config));
    } catch {
      // Хранилище недоступно: настройки действуют до перезапуска.
    }
  }

  // Event system
  on(listener: (event: AgentEvent) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: Omit<AgentEvent, 'timestamp'>) {
    const fullEvent: AgentEvent = { ...event, timestamp: Date.now() };
    this.eventLog.push(fullEvent);
    if (this.eventLog.length > 1000) {
      this.eventLog.shift();
    }
    for (const l of [...this.listeners]) {
      try { l(fullEvent); } catch { /* ошибка подписчика не останавливает задачу */ }
    }
  }

  /** Запуск ещё актуален (не было reset() и нового запуска). */
  private alive(id: number): boolean {
    return this.runId === id;
  }

  private cancelled(): { success: false; error: string } {
    return { success: false, error: ORCH_CANCELLED };
  }

  private release(id: number) {
    if (this.holder === id) { this.holder = 0; this.running = false; }
  }

  isRunning(): boolean {
    return this.running;
  }

  // Main execution pipeline
  async execute(goal: string, context?: any): Promise<{ success: boolean; result?: any; error?: string }> {
    if (this.running) return { success: false, error: ORCH_BUSY };
    const id = ++this.runId;
    this.running = true;
    this.holder = id;
    try {
      // 1. UNDERSTAND
      this.setState('understanding');
      this.emit({ type: 'understand', state: 'understanding', detail: `Parsing goal: "${goal}"`, data: { goal } });

      if (this.config.enableMemory) {
        memory.addMessage('user', goal);
        memory.addToShortTerm({ type: 'action', content: `User request: ${goal}`, importance: 0.8 });
      }

      // 2. PLAN
      this.setState('planning');
      this.emit({ type: 'plan', state: 'planning', detail: 'Decomposing task into steps' });

      const task = await planner.createPlan({ goal, context });
      if (!this.alive(id)) return this.cancelled();
      this.currentTask = task;

      this.emit({ type: 'plan_complete', state: 'planning', detail: `Created plan with ${task.steps.length} steps`, data: { task } });

      // 3-8. Execute each step
      for (const step of task.steps) {
        const result = await this.executeStep(task, step, id, context);
        if (!this.alive(id)) return this.cancelled();
        if (!result.success) {
          this.setState('error');
          this.emit({ type: 'error', state: 'error', detail: `Step failed: ${step.action}`, data: { error: result.error } });
          return { success: false, error: result.error };
        }
      }

      // 9. COMPLETE
      this.setState('complete');
      this.emit({ type: 'complete', state: 'complete', detail: 'Task completed successfully' });

      if (this.config.enableMemory) {
        memory.addMessage('assistant', `Task completed: ${goal}`);
        memory.addToLongTerm({ type: 'action', content: `Completed: ${goal}`, importance: 0.6 });
      }

      return { success: true, result: task };
    } catch (error: any) {
      if (!this.alive(id)) return this.cancelled();
      const message = typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Неизвестная ошибка';
      this.setState('error');
      this.emit({ type: 'error', state: 'error', detail: message, data: { error: message } });
      return { success: false, error: message };
    } finally {
      this.release(id);
    }
  }

  private fail(task: Task, step: TaskStep, error: string): StepResult {
    avatarStateMachine.setError();
    planner.updateStepStatus(task.id, step.id, 'failed', undefined, error);
    return { success: false, error };
  }

  private async executeStep(task: Task, step: TaskStep, id: number, context?: any): Promise<StepResult> {
    // OBSERVE - Real observation. Не видим экран — не действуем.
    this.setState('observing');
    avatarStateMachine.setExecuting();
    this.emit({ type: 'observe', state: 'observing', detail: `Observing before action: ${step.action}`, data: { step } });

    const observationResult = await observationManager.observe();
    if (!this.alive(id)) return this.cancelled();
    const preState = observationResult.state;

    this.emit({ type: 'observe_result', state: 'observing', detail: `Observation: ${observationResult.success ? 'SUCCESS' : 'FAILED'}`, data: { observation: observationResult } });

    if (!observationResult.success || !preState) {
      return this.fail(task, step, ORCH_NO_OBSERVATION);
    }

    // GROUND - Find target element. Цель не найдена — не нажимаем «куда-нибудь».
    this.setState('grounding');
    this.emit({ type: 'ground', state: 'grounding', detail: `Grounding to target: ${step.target || 'N/A'}` });

    if (step.target) {
      const groundedElement = await observationManager.findElementByText(step.target);
      if (!this.alive(id)) return this.cancelled();
      this.emit({ type: 'ground_result', state: 'grounding', detail: groundedElement ? `Found: ${groundedElement.text}` : 'Not found', data: { element: groundedElement } });
      if (!groundedElement) {
        return this.fail(task, step, `${ORCH_TARGET_MISSING}: «${step.target.slice(0, 80)}».`);
      }
    }

    // POLICY - Real policy check
    this.setState('policy');
    avatarStateMachine.setVerifying();

    const tool = toolRegistry.getTool(step.action);
    if (!tool) {
      this.emit({ type: 'policy_error', state: 'policy', detail: `Tool not found: ${step.action}` });
      return this.fail(task, step, `Tool ${step.action} not found`);
    }

    const policyContext: PolicyContext = {
      platform: observationManager.getContext().platform,
      currentApp: preState.currentApp,
      environment: context || {},
    };

    const policyResult = await policyEngine.evaluate(tool, policyContext);
    if (!this.alive(id)) return this.cancelled();
    this.emit({ type: 'policy', state: 'policy', detail: `Policy: ${policyResult.decision} - ${policyResult.reason}`, data: { policy: policyResult } });

    if (policyResult.decision === 'deny') {
      this.emit({ type: 'policy_blocked', state: 'policy', detail: `Action blocked: ${policyResult.reason}` });
      return this.fail(task, step, policyResult.reason);
    }

    if (policyResult.decision === 'require_confirmation') {
      avatarStateMachine.setConfirmationRequired();
      this.emit({ type: 'policy_confirmation', state: 'policy', detail: policyResult.confirmationMessage || 'Confirmation required' });
      return { success: false, error: 'Requires user confirmation' };
    }

    // ACT - Real tool execution (ровно один раз и только если запуск не отменён).
    if (!this.alive(id)) return this.cancelled();
    this.setState('acting');
    avatarStateMachine.setExecuting();
    this.emit({ type: 'act', state: 'acting', detail: `Executing tool: ${tool.name}`, data: { tool: tool.id, params: step.parameters } });

    let actionResult: Awaited<ReturnType<typeof toolRegistry.executeTool>>;
    this.acting = true;
    try {
      actionResult = await toolRegistry.executeTool(tool.id, step.parameters || {});
    } finally {
      this.acting = false;
    }

    this.emit({ type: 'act_result', state: 'acting', detail: `Result: ${actionResult.success ? 'SUCCESS' : 'FAILED'}`, data: { result: actionResult } });

    if (!actionResult.success) {
      return this.fail(task, step, actionResult.error || 'Действие не выполнено');
    }
    // Действие состоялось: списываем дневной лимит (даже если потом задачу отменили или проверка не прошла).
    policyEngine.recordExecution(tool.id);
    if (!this.alive(id)) return this.cancelled();

    // VERIFY - Real verification: ответ инструмента + (для шагов на экране) изменение экрана.
    if (this.config.enableVerification) {
      this.setState('verifying');
      avatarStateMachine.setVerifying();
      this.emit({ type: 'verify', state: 'verifying', detail: 'Verifying action result' });

      const verificationResult = await verification.verify({
        action: step.action,
        expectedState: { success: true },
        actualState: actionResult,
      });
      if (!this.alive(id)) return this.cancelled();

      let screenOk = !step.target;
      for (let attempt = 0; !screenOk && attempt <= this.config.maxRetries; attempt++) {
        if (attempt > 0) {
          this.emit({ type: 'retry', state: 'verifying', detail: `Re-check ${attempt}/${this.config.maxRetries}` });
          await this.delay(500 * Math.pow(2, attempt - 1));
          if (!this.alive(id)) return this.cancelled();
        }
        const postObservation = await observationManager.observe();
        if (!this.alive(id)) return this.cancelled();
        const postState: ScreenState | undefined = postObservation.success ? postObservation.state : undefined;
        if (postState) {
          const comparison = observationManager.compareStates(preState, postState);
          this.emit({ type: 'verify_compare', state: 'verifying', detail: `State changed: ${comparison.changed}`, data: { comparison } });
          screenOk = comparison.changed;
        }
      }

      const verified = verificationResult.success && screenOk;
      this.emit({ type: 'verify_result', state: 'verifying', detail: `Verification: ${verified ? 'PASS' : 'FAIL'}`, data: { verification: verificationResult, screenChanged: screenOk } });

      if (!verified) {
        // Действие не повторяем: иначе сообщение или платёж могут уйти дважды.
        return this.fail(task, step, ORCH_NOT_VERIFIED);
      }
    }

    // REFLECT
    if (this.config.enableReflection) {
      this.setState('reflecting');
      this.emit({ type: 'reflect', state: 'reflecting', detail: 'Reflecting on action outcome' });

      // В память — только имя инструмента и список параметров, без их значений (в них бывают личные данные).
      if (this.config.enableMemory) {
        memory.addToLongTerm({
          type: 'action',
          content: `Executed: ${tool.name} (${Object.keys(step.parameters || {}).join(', ') || 'без параметров'})`,
          importance: 0.6,
        });
      }
    }

    avatarStateMachine.setSuccess();
    planner.updateStepStatus(task.id, step.id, 'completed', actionResult);
    return { success: true };
  }

  private setState(state: AgentState) {
    this.state = state;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API
  getState(): AgentState {
    return this.state;
  }

  getCurrentTask(): Task | null {
    return this.currentTask;
  }

  getEventLog(limit: number = 50): AgentEvent[] {
    return this.eventLog.slice(-limit);
  }

  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<OrchestratorConfig>) {
    this.config = sanitizeOrchestratorConfig({ ...this.config, ...updates }, this.config);
    this.saveConfig();
  }

  /**
   * Отменить текущую задачу и вернуться в ожидание: незапущенные действия уже не выполнятся.
   * Если действие уже выполняется, «занято» снимается, когда оно закончится: вторая задача не стартует поверх него.
   */
  reset() {
    this.runId++;
    if (!this.acting) { this.holder = 0; this.running = false; }
    this.state = 'idle';
    this.currentTask = null;
  }

  getStats() {
    return {
      state: this.state,
      totalEvents: this.eventLog.length,
      currentTask: this.currentTask?.id,
      memoryStats: memory.getStats(),
      verificationSuccessRate: verification.getSuccessRate(),
    };
  }
}

export const orchestrator = new Orchestrator();
