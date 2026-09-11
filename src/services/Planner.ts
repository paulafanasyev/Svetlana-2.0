// Planner Module - Task decomposition and execution planning

export interface Task {
  id: string;
  description: string;
  steps: TaskStep[];
  status: 'pending' | 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

export interface TaskStep {
  id: string;
  action: string;
  target?: string;
  parameters?: Record<string, any>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface PlanRequest {
  goal: string;
  context?: {
    currentApp?: string;
    screenState?: any;
    previousActions?: string[];
  };
}

class Planner {
  private tasks: Map<string, Task> = new Map();

  async createPlan(request: PlanRequest): Promise<Task> {
    const taskId = `task_${Date.now()}`;
    
    // Simulate planning (in real implementation, this would call LLM)
    const steps = await this.decomposeTask(request);
    
    const task: Task = {
      id: taskId,
      description: request.goal,
      steps,
      status: 'planning',
      createdAt: Date.now(),
    };

    this.tasks.set(taskId, task);
    return task;
  }

  private async decomposeTask(request: PlanRequest): Promise<TaskStep[]> {
    // Simple rule-based decomposition
    // In production, this would use LLM to generate steps
    const goal = request.goal.toLowerCase();
    
    if (goal.includes('открой') || goal.includes('запусти')) {
      return [
        {
          id: 'step_1',
          action: 'launchApp',
          target: this.extractAppName(goal),
          status: 'pending',
        },
      ];
    }

    if (goal.includes('нажми') || goal.includes('кликни')) {
      return [
        {
          id: 'step_1',
          action: 'tap',
          target: this.extractButtonName(goal),
          status: 'pending',
        },
      ];
    }

    if (goal.includes('напиши') || goal.includes('отправь')) {
      return [
        {
          id: 'step_1',
          action: 'type',
          parameters: { text: this.extractText(goal) },
          status: 'pending',
        },
        {
          id: 'step_2',
          action: 'tap',
          target: 'send button',
          status: 'pending',
        },
      ];
    }

    // Default: single step
    return [
      {
        id: 'step_1',
        action: 'execute',
        parameters: { goal: request.goal },
        status: 'pending',
      },
    ];
  }

  private extractAppName(goal: string): string {
    const apps = ['настройки', 'сообщения', 'камера', 'браузер', 'галерея'];
    for (const app of apps) {
      if (goal.includes(app)) return app;
    }
    return 'app';
  }

  private extractButtonName(goal: string): string {
    const match = goal.match(/нажми\s+(.+)/i) || goal.match(/кликни\s+(.+)/i);
    return match ? match[1].trim() : 'button';
  }

  private extractText(goal: string): string {
    const match = goal.match(/напиши\s+"(.+)"/i) || goal.match(/напиши\s+(.+)/i);
    return match ? match[1].trim() : '';
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  updateStepStatus(taskId: string, stepId: string, status: TaskStep['status'], result?: any, error?: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const step = task.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = status;
    if (result) step.result = result;
    if (error) step.error = error;

    // Check if all steps completed
    const allCompleted = task.steps.every(s => s.status === 'completed');
    const anyFailed = task.steps.some(s => s.status === 'failed');

    if (allCompleted) {
      task.status = 'completed';
      task.completedAt = Date.now();
    } else if (anyFailed) {
      task.status = 'failed';
    } else {
      task.status = 'executing';
    }
  }

  removeTask(id: string) {
    this.tasks.delete(id);
  }
}

export const planner = new Planner();
