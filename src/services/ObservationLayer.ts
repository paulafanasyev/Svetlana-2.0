// Observation Layer - Real state observation abstraction

export interface ScreenState {
  timestamp: number;
  platform: string;
  currentApp?: string;
  elements: UIElement[];
  text?: string;
  screenshot?: string;
  metadata?: Record<string, any>;
}

export interface UIElement {
  id: string;
  type: string;
  text?: string;
  contentDescription?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  clickable?: boolean;
  focusable?: boolean;
  visible?: boolean;
  enabled?: boolean;
  children?: UIElement[];
}

export interface ObservationResult {
  success: boolean;
  state?: ScreenState;
  error?: string;
  confidence: number; // 0-1
}

export interface Observer {
  id: string;
  name: string;
  platform: string;
  
  // Capture current screen state
  observe(): Promise<ObservationResult>;
  
  // Find element by text
  findElementByText(text: string): Promise<UIElement | null>;
  
  // Find element by ID
  findElementById(id: string): Promise<UIElement | null>;
  
  // Check if element exists
  elementExists(textOrId: string): Promise<boolean>;
  
  // Get current app
  getCurrentApp(): Promise<string | null>;
  
  // Check if observer is available
  isAvailable(): Promise<boolean>;
}

class ObservationManager {
  private observers: Map<string, Observer> = new Map();
  private activeObserver: string | null = null;
  private observationHistory: ScreenState[] = [];
  private readonly MAX_HISTORY = 50;
  private context: { platform: string } = { platform: 'web' };

  registerObserver(observer: Observer) {
    this.observers.set(observer.id, observer);
  }

  unregisterObserver(id: string) {
    this.observers.delete(id);
    if (this.activeObserver === id) {
      this.activeObserver = null;
    }
  }

  setActiveObserver(id: string) {
    if (this.observers.has(id)) {
      this.activeObserver = id;
    }
  }

  getActiveObserver(): Observer | undefined {
    return this.activeObserver ? this.observers.get(this.activeObserver) : undefined;
  }

  getAllObservers(): Observer[] {
    return Array.from(this.observers.values());
  }

  async observe(): Promise<ObservationResult> {
    const observer = this.getActiveObserver();
    if (!observer) {
      return {
        success: false,
        error: 'No active observer',
        confidence: 0,
      };
    }

    const available = await observer.isAvailable();
    if (!available) {
      return {
        success: false,
        error: `Observer ${observer.name} is not available`,
        confidence: 0,
      };
    }

    const result = await observer.observe();
    
    if (result.success && result.state) {
      this.observationHistory.push(result.state);
      if (this.observationHistory.length > this.MAX_HISTORY) {
        this.observationHistory.shift();
      }
    }

    return result;
  }

  async findElementByText(text: string): Promise<UIElement | null> {
    const observer = this.getActiveObserver();
    if (!observer) return null;
    return observer.findElementByText(text);
  }

  async findElementById(id: string): Promise<UIElement | null> {
    const observer = this.getActiveObserver();
    if (!observer) return null;
    return observer.findElementById(id);
  }

  async elementExists(textOrId: string): Promise<boolean> {
    const observer = this.getActiveObserver();
    if (!observer) return false;
    return observer.elementExists(textOrId);
  }

  async getCurrentApp(): Promise<string | null> {
    const observer = this.getActiveObserver();
    if (!observer) return null;
    return observer.getCurrentApp();
  }

  getObservationHistory(limit: number = 10): ScreenState[] {
    return this.observationHistory.slice(-limit);
  }

  clearHistory() {
    this.observationHistory = [];
  }

  getContext(): { platform: string } {
    return { ...this.context };
  }

  setContext(context: { platform: string }) {
    this.context = { ...this.context, ...context };
  }

  // Compare two states
  compareStates(before: ScreenState, after: ScreenState): {
    changed: boolean;
    differences: string[];
    newElements: UIElement[];
    removedElements: UIElement[];
  } {
    const differences: string[] = [];
    const newElements: UIElement[] = [];
    const removedElements: UIElement[] = [];

    // Compare app
    if (before.currentApp !== after.currentApp) {
      differences.push(`App changed: ${before.currentApp} → ${after.currentApp}`);
    }

    // Compare elements
    const beforeIds = new Set(before.elements.map(e => e.id));
    const afterIds = new Set(after.elements.map(e => e.id));

    // Find new elements
    for (const element of after.elements) {
      if (!beforeIds.has(element.id)) {
        newElements.push(element);
        differences.push(`New element: ${element.text || element.id}`);
      }
    }

    // Find removed elements
    for (const element of before.elements) {
      if (!afterIds.has(element.id)) {
        removedElements.push(element);
        differences.push(`Removed element: ${element.text || element.id}`);
      }
    }

    return {
      changed: differences.length > 0,
      differences,
      newElements,
      removedElements,
    };
  }
}

export const observationManager = new ObservationManager();

// ============ BUILT-IN OBSERVERS ============

// Web Observer (for browser-based observation)
export const webObserver: Observer = {
  id: 'web',
  name: 'Web Observer',
  platform: 'web',

  async observe(): Promise<ObservationResult> {
    if (typeof document === 'undefined') {
      return {
        success: false,
        error: 'Document not available',
        confidence: 0,
      };
    }

    const elements: UIElement[] = [];
    
    // Collect interactive elements
    const interactiveElements = document.querySelectorAll('button, a, input, textarea, select');
    interactiveElements.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      elements.push({
        id: `web_${index}`,
        type: el.tagName.toLowerCase(),
        text: el.textContent?.trim() || (el as HTMLInputElement).value || '',
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        clickable: el.tagName === 'BUTTON' || el.tagName === 'A',
        focusable: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT',
        visible: rect.width > 0 && rect.height > 0,
        enabled: !(el as HTMLButtonElement).disabled,
      });
    });

    return {
      success: true,
      state: {
        timestamp: Date.now(),
        platform: 'web',
        currentApp: window.location.hostname,
        elements,
        text: document.body.innerText.substring(0, 1000),
      },
      confidence: 0.8,
    };
  },

  async findElementByText(text: string): Promise<UIElement | null> {
    const result = await this.observe();
    if (!result.success || !result.state) return null;

    return result.state.elements.find(el => 
      el.text?.toLowerCase().includes(text.toLowerCase())
    ) || null;
  },

  async findElementById(id: string): Promise<UIElement | null> {
    const result = await this.observe();
    if (!result.success || !result.state) return null;

    return result.state.elements.find(el => el.id === id) || null;
  },

  async elementExists(textOrId: string): Promise<boolean> {
    const element = await this.findElementByText(textOrId) || await this.findElementById(textOrId);
    return element !== null;
  },

  async getCurrentApp(): Promise<string | null> {
    return typeof window !== 'undefined' ? window.location.hostname : null;
  },

  async isAvailable(): Promise<boolean> {
    return typeof document !== 'undefined';
  },
};

// Mock Android Observer (placeholder for real implementation)
export const androidObserver: Observer = {
  id: 'android',
  name: 'Android Observer',
  platform: 'android',

  async observe(): Promise<ObservationResult> {
    // This would integrate with Android AccessibilityService
    return {
      success: false,
      error: 'Android observer requires native implementation',
      confidence: 0,
    };
  },

  async findElementByText(text: string): Promise<UIElement | null> {
    return null;
  },

  async findElementById(id: string): Promise<UIElement | null> {
    return null;
  },

  async elementExists(textOrId: string): Promise<boolean> {
    return false;
  },

  async getCurrentApp(): Promise<string | null> {
    return null;
  },

  async isAvailable(): Promise<boolean> {
    return false; // Requires Android Hands
  },
};

// Register built-in observers
observationManager.registerObserver(webObserver);
observationManager.registerObserver(androidObserver);

// Set web observer as active by default
observationManager.setActiveObserver('web');
