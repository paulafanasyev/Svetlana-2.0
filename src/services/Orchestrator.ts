// Orchestrator - Central coordination for all agent modules

import { planner, type Task, type TaskStep } from './Planner';
import { memory } from './Memory';
import { verification, type VerificationResult } from './Verification';
import { aiGateway, type ChatMessage } from './AIGateway';

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

class Orchestrator {
  private state: AgentState = 'idle';
  private currentTask: Task | null = null;
  private eventLog: AgentEvent[] = [];
  private config: OrchestratorConfig = {
    maxRetries: 3,
    enableVerification: true,
    enableReflection: true,
    enableMemory: true,
  };

  private listeners: ((event: AgentEvent) => void)[] = [];

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    try {
      const stored = localStorage.getItem('svetlana_orchestrator_config');
      if (stored) {
        this.config = { ...this.config, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Failed to load orchestrator config:', e);
    }
  }

  private saveConfig() {
    localStorage.setItem('svetlana_orchestrator_config', JSON.stringify(this.config));
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
    this.listeners.forEach(l => l(fullEvent));
  }

  // Main execution pipeline
  async execute(goal: string, context?: any): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      // 1. UNDERSTAND
      this.setState('understanding');
      this.emit({ type: 'understand', state: 'understanding', detail: `Parsing goal: "${goal}"`, data: { goal } });
      
      if (this.config.enableMemory) {
        memory.addMessage('user', goal);
        memory.addToShortTerm({ type: 'action', content: `User request: ${goal}`, importance: 0.8 });
      }

      await this.delay(500);

      // 2. PLAN
      this.setState('planning');
      this.emit({ type: 'plan', state: 'planning', detail: 'Decomposing task into steps' });
      
      const task = await planner.createPlan({ goal, context });
      this.currentTask = task;
      
      this.emit({ type: 'plan_complete', state: 'planning', detail: `Created plan with ${task.steps.length} steps`, data: { task } });
      
      await this.delay(500);

      // 3-8. Execute each step
      for (const step of task.steps) {
        const result = await this.executeStep(step, context);
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
      this.setState('error');
      this.emit({ type: 'error', state: 'error', detail: error.message, data: { error: error.message } });
      return { success: false, error: error.message };
    }
  }

  private async executeStep(step: TaskStep, context?: any): Promise<{ success: boolean; error?: string }> {
    // OBSERVE
    this.setState('observing');
    this.emit({ type: 'observe', state: 'observing', detail: `Observing before action: ${step.action}`, data: { step } });
    const preState = await this.observe(context);
    await this.delay(300);

    // GROUND
    this.setState('grounding');
    this.emit({ type: 'ground', state: 'grounding', detail: `Grounding to target: ${step.target || 'N/A'}` });
    await this.delay(300);

    // POLICY
    this.setState('policy');
    const riskLevel = this.assessRisk(step);
    this.emit({ type: 'policy', state: 'policy', detail: `Risk assessment: ${riskLevel}`, data: { risk: riskLevel } });
    
    if (riskLevel === 'critical') {
      this.emit({ type: 'policy_blocked', state: 'policy', detail: 'Action blocked by policy' });
      return { success: false, error: 'Action blocked by security policy' };
    }
    await this.delay(200);

    // ACT
    this.setState('acting');
    this.emit({ type: 'act', state: 'acting', detail: `Executing: ${step.action}`, data: { step } });
    const actionResult = await this.act(step);
    await this.delay(500);

    // VERIFY
    if (this.config.enableVerification) {
      this.setState('verifying');
      this.emit({ type: 'verify', state: 'verifying', detail: 'Verifying action result' });
      
      const postState = await this.observe(context);
      const verificationResult = await verification.verify({
        action: step.action,
        expectedState: { success: true },
        actualState: actionResult,
      });

      this.emit({ type: 'verify_result', state: 'verifying', detail: `Verification: ${verificationResult.success ? 'PASS' : 'FAIL'}`, data: { verification: verificationResult } });

      if (!verificationResult.success) {
        // RETRY
        for (let retry = 0; retry < this.config.maxRetries; retry++) {
          this.emit({ type: 'retry', state: 'verifying', detail: `Retry ${retry + 1}/${this.config.maxRetries}` });
          await this.delay(1000);
          
          const retryResult = await this.act(step);
          const retryPostState = await this.observe(context);
          const retryVerification = await verification.verify({
            action: step.action,
            expectedState: { success: true },
            actualState: retryResult,
          });

          if (retryVerification.success) {
            planner.updateStepStatus(this.currentTask!.id, step.id, 'completed', retryResult);
            return { success: true };
          }
        }

        planner.updateStepStatus(this.currentTask!.id, step.id, 'failed', undefined, 'Verification failed after retries');
        return { success: false, error: 'Verification failed after retries' };
      }
    }

    // REFLECT
    if (this.config.enableReflection) {
      this.setState('reflecting');
      this.emit({ type: 'reflect', state: 'reflecting', detail: 'Reflecting on action outcome' });
      await this.delay(300);
    }

    planner.updateStepStatus(this.currentTask!.id, step.id, 'completed', actionResult);
    return { success: true };
  }

  private async observe(context?: any): Promise<any> {
    // In real implementation, this would capture screen state
    return { timestamp: Date.now(), context };
  }

  private async act(step: TaskStep): Promise<any> {
    // In real implementation, this would execute via PlatformHands
    return { action: step.action, target: step.target, success: true };
  }

  private assessRisk(step: TaskStep): 'low' | 'medium' | 'high' | 'critical' {
    const action = step.action.toLowerCase();
    
    if (['tap', 'open', 'scroll'].some(a => action.includes(a))) return 'low';
    if (['type', 'navigate'].some(a => action.includes(a))) return 'medium';
    if (['send', 'install', 'delete'].some(a => action.includes(a))) return 'high';
    if (['pay', 'shell', 'execute'].some(a => action.includes(a))) return 'critical';
    
    return 'low';
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
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  reset() {
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
