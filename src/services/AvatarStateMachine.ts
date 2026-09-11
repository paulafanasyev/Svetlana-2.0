// Avatar State Machine - Real avatar state management

export type AvatarState = 
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'executing'
  | 'verifying'
  | 'confirmation_required'
  | 'error'
  | 'success'
  | 'sad'
  | 'happy';

export interface AvatarStateConfig {
  state: AvatarState;
  label: string;
  description: string;
  emotion: 'neutral' | 'happy' | 'sad' | 'laughing' | 'crying' | 'surprised' | 'talking';
  animation?: string;
  sound?: string;
}

export interface AvatarTransition {
  from: AvatarState;
  to: AvatarState;
  condition?: () => boolean;
  action?: () => void;
}

const STATE_CONFIGS: Record<AvatarState, AvatarStateConfig> = {
  idle: {
    state: 'idle',
    label: 'Idle',
    description: 'Waiting for input',
    emotion: 'neutral',
  },
  listening: {
    state: 'listening',
    label: 'Listening',
    description: 'Listening to voice input',
    emotion: 'neutral',
    animation: 'pulse',
  },
  thinking: {
    state: 'thinking',
    label: 'Thinking',
    description: 'Processing request',
    emotion: 'neutral',
    animation: 'pulse',
  },
  speaking: {
    state: 'speaking',
    label: 'Speaking',
    description: 'Speaking response',
    emotion: 'talking',
    animation: 'talking',
  },
  executing: {
    state: 'executing',
    label: 'Executing',
    description: 'Performing action',
    emotion: 'neutral',
    animation: 'pulse',
  },
  verifying: {
    state: 'verifying',
    label: 'Verifying',
    description: 'Checking result',
    emotion: 'neutral',
    animation: 'pulse',
  },
  confirmation_required: {
    state: 'confirmation_required',
    label: 'Confirmation Required',
    description: 'Waiting for user confirmation',
    emotion: 'surprised',
    animation: 'pulse',
  },
  error: {
    state: 'error',
    label: 'Error',
    description: 'An error occurred',
    emotion: 'sad',
  },
  success: {
    state: 'success',
    label: 'Success',
    description: 'Action completed successfully',
    emotion: 'happy',
  },
  sad: {
    state: 'sad',
    label: 'Sad',
    description: 'Expressing sadness',
    emotion: 'sad',
  },
  happy: {
    state: 'happy',
    label: 'Happy',
    description: 'Expressing happiness',
    emotion: 'happy',
  },
};

class AvatarStateMachine {
  private currentState: AvatarState = 'idle';
  private previousState: AvatarState = 'idle';
  private transitions: AvatarTransition[] = [];
  private listeners: ((state: AvatarState, previous: AvatarState) => void)[] = [];
  private stateHistory: { state: AvatarState; timestamp: number }[] = [];
  private readonly MAX_HISTORY = 100;

  constructor() {
    this.initializeTransitions();
  }

  private initializeTransitions() {
    // Define valid transitions
    const validTransitions: [AvatarState, AvatarState[]][] = [
      ['idle', ['listening', 'thinking', 'speaking', 'executing', 'happy', 'sad']],
      ['listening', ['thinking', 'idle']],
      ['thinking', ['speaking', 'executing', 'idle', 'error']],
      ['speaking', ['idle', 'listening', 'executing']],
      ['executing', ['verifying', 'idle', 'error']],
      ['verifying', ['success', 'error', 'executing', 'idle']],
      ['confirmation_required', ['executing', 'idle']],
      ['error', ['idle', 'thinking']],
      ['success', ['idle', 'speaking']],
      ['sad', ['idle', 'happy']],
      ['happy', ['idle', 'sad']],
    ];

    for (const [from, tos] of validTransitions) {
      for (const to of tos) {
        this.transitions.push({ from, to });
      }
    }
  }

  private canTransition(from: AvatarState, to: AvatarState): boolean {
    return this.transitions.some(t => t.from === from && t.to === to);
  }

  transition(to: AvatarState): boolean {
    if (!this.canTransition(this.currentState, to)) {
      console.warn(`Invalid transition: ${this.currentState} → ${to}`);
      return false;
    }

    const previous = this.currentState;
    this.previousState = previous;
    this.currentState = to;

    // Add to history
    this.stateHistory.push({ state: to, timestamp: Date.now() });
    if (this.stateHistory.length > this.MAX_HISTORY) {
      this.stateHistory.shift();
    }

    // Notify listeners
    this.listeners.forEach(listener => listener(to, previous));

    return true;
  }

  getState(): AvatarState {
    return this.currentState;
  }

  getPreviousState(): AvatarState {
    return this.previousState;
  }

  getStateConfig(state?: AvatarState): AvatarStateConfig {
    return STATE_CONFIGS[state || this.currentState];
  }

  getEmotion(state?: AvatarState): AvatarStateConfig['emotion'] {
    return this.getStateConfig(state).emotion;
  }

  // Listener management
  onStateChange(listener: (state: AvatarState, previous: AvatarState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // History
  getHistory(limit: number = 20): { state: AvatarState; timestamp: number }[] {
    return this.stateHistory.slice(-limit);
  }

  getTimeInCurrentState(): number {
    const lastTransition = this.stateHistory[this.stateHistory.length - 1];
    return lastTransition ? Date.now() - lastTransition.timestamp : 0;
  }

  // Convenience methods
  setIdle() {
    this.transition('idle');
  }

  setListening() {
    this.transition('listening');
  }

  setThinking() {
    this.transition('thinking');
  }

  setSpeaking() {
    this.transition('speaking');
  }

  setExecuting() {
    this.transition('executing');
  }

  setVerifying() {
    this.transition('verifying');
  }

  setConfirmationRequired() {
    this.transition('confirmation_required');
  }

  setError() {
    this.transition('error');
  }

  setSuccess() {
    this.transition('success');
  }

  setHappy() {
    this.transition('happy');
  }

  setSad() {
    this.transition('sad');
  }

  // Statistics
  getStats() {
    const stateCounts = new Map<AvatarState, number>();
    for (const entry of this.stateHistory) {
      stateCounts.set(entry.state, (stateCounts.get(entry.state) || 0) + 1);
    }

    return {
      currentState: this.currentState,
      previousState: this.previousState,
      historySize: this.stateHistory.length,
      stateCounts: Object.fromEntries(stateCounts),
      timeInCurrentState: this.getTimeInCurrentState(),
    };
  }

  reset() {
    this.currentState = 'idle';
    this.previousState = 'idle';
    this.stateHistory = [];
  }
}

export const avatarStateMachine = new AvatarStateMachine();
