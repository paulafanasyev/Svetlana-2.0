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

export interface StateComparison {
  changed: boolean;
  differences: string[];
  newElements: UIElement[];
  removedElements: UIElement[];
  changedElements: UIElement[];
}

const ELEMENT_FIELDS = ['type', 'text', 'contentDescription', 'clickable', 'focusable', 'visible', 'enabled'] as const;

/** Разворачивает дерево элементов в плоский список (с защитой от циклов и огромных деревьев). */
export function flattenElements(elements: UIElement[] | undefined, limit = 5000): UIElement[] {
  const out: UIElement[] = [];
  const seen = new Set<UIElement>();
  const stack: UIElement[] = Array.isArray(elements) ? [...elements].reverse() : [];
  while (stack.length && out.length < limit) {
    const el = stack.pop() as UIElement;
    if (!el || typeof el !== 'object' || seen.has(el)) continue;
    seen.add(el);
    out.push(el);
    if (Array.isArray(el.children)) {
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
    }
  }
  return out;
}

function elementKey(el: UIElement, index: number): string {
  return typeof el.id === 'string' && el.id ? `id:${el.id}` : `idx:${index}`;
}

function label(el: UIElement): string {
  return el.text || el.contentDescription || el.id || el.type || '?';
}

function sameBounds(a: UIElement['bounds'], b: UIElement['bounds']): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function indexElements(list: UIElement[]): Map<string, UIElement[]> {
  const map = new Map<string, UIElement[]>();
  list.forEach((el, i) => {
    const key = elementKey(el, i);
    const bucket = map.get(key);
    if (bucket) bucket.push(el);
    else map.set(key, [el]);
  });
  return map;
}

/**
 * Сравнивает два снимка экрана: платформу, приложение, текст экрана,
 * вложенные элементы и свойства элемента с тем же id (текст, доступность,
 * видимость, положение). Повторяющиеся id сравниваются по порядку.
 * Отсутствующий снимок считается изменением.
 */
export function compareScreenStates(before: ScreenState, after: ScreenState): StateComparison {
  const differences: string[] = [];
  const newElements: UIElement[] = [];
  const removedElements: UIElement[] = [];
  const changedElements: UIElement[] = [];

  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return { changed: true, differences: ['State missing'], newElements, removedElements, changedElements };
  }

  if (before.platform !== after.platform) {
    differences.push(`Platform changed: ${before.platform} → ${after.platform}`);
  }
  if (before.currentApp !== after.currentApp) {
    differences.push(`App changed: ${before.currentApp} → ${after.currentApp}`);
  }
  if ((before.text ?? '') !== (after.text ?? '')) {
    differences.push('Screen text changed');
  }

  const beforeMap = indexElements(flattenElements(before.elements));
  const afterMap = indexElements(flattenElements(after.elements));

  for (const [key, afterList] of afterMap) {
    const beforeList = beforeMap.get(key) ?? [];
    afterList.forEach((el, i) => {
      const prev = beforeList[i];
      if (!prev) {
        newElements.push(el);
        differences.push(`New element: ${label(el)}`);
        return;
      }
      const fields: string[] = ELEMENT_FIELDS.filter((f) => prev[f] !== el[f]);
      if (!sameBounds(prev.bounds, el.bounds)) fields.push('bounds');
      if (fields.length) {
        changedElements.push(el);
        differences.push(`Changed element: ${label(el)} (${fields.join(', ')})`);
      }
    });
  }
  for (const [key, beforeList] of beforeMap) {
    const afterList = afterMap.get(key) ?? [];
    for (let i = afterList.length; i < beforeList.length; i++) {
      removedElements.push(beforeList[i]);
      differences.push(`Removed element: ${label(beforeList[i])}`);
    }
  }

  return {
    changed: differences.length > 0,
    differences,
    newElements,
    removedElements,
    changedElements,
  };
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

    let result: ObservationResult;
    try {
      const available = await observer.isAvailable();
      if (!available) {
        return {
          success: false,
          error: `Observer ${observer.name} is not available`,
          confidence: 0,
        };
      }
      result = await observer.observe();
    } catch {
      // Наблюдатель упал: экран не увиден, успехом это не считаем.
      return { success: false, error: 'Observation failed', confidence: 0 };
    }

    if (!result || typeof result !== 'object') {
      return { success: false, error: 'Observation failed', confidence: 0 };
    }
    if (result.success && (!result.state || !Array.isArray(result.state.elements))) {
      return { success: false, error: 'Observation returned no state', confidence: 0 };
    }

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
  compareStates(before: ScreenState, after: ScreenState): StateComparison {
    return compareScreenStates(before, after);
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
        id: el.id ? `web_id_${el.id}` : `web_${index}`,
        type: el.tagName.toLowerCase(),
        text: el.textContent?.trim() || (el as HTMLInputElement).value || '',
        contentDescription: el.getAttribute('aria-label') || undefined,
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

// Android Observer - Real implementation via HandsManager
import { handsManager } from './HandsManager';

export const androidObserver: Observer = {
  id: 'android',
  name: 'Android Observer',
  platform: 'android',

  async observe(): Promise<ObservationResult> {
    const hands = handsManager.getHands();
    if (!hands) {
      return {
        success: false,
        error: 'Android device not connected',
        confidence: 0,
      };
    }

    try {
      const tree = await hands.getAccessibilityTree();
      const currentApp = await hands.getCurrentApp();
      
      return {
        success: true,
        state: {
          timestamp: tree.timestamp,
          platform: 'android',
          currentApp: currentApp || undefined,
          elements: tree.root.children || [],
        },
        confidence: 1.0,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        confidence: 0,
      };
    }
  },

  async findElementByText(text: string): Promise<UIElement | null> {
    const hands = handsManager.getHands();
    if (!hands) return null;
    
    try {
      return await hands.findElementByText(text);
    } catch (error) {
      return null;
    }
  },

  async findElementById(id: string): Promise<UIElement | null> {
    const hands = handsManager.getHands();
    if (!hands) return null;
    
    try {
      return await hands.findElementById(id);
    } catch (error) {
      return null;
    }
  },

  async elementExists(textOrId: string): Promise<boolean> {
    const element = await this.findElementByText(textOrId) || await this.findElementById(textOrId);
    return element !== null;
  },

  async getCurrentApp(): Promise<string | null> {
    const hands = handsManager.getHands();
    if (!hands) return null;
    
    try {
      return await hands.getCurrentApp();
    } catch (error) {
      return null;
    }
  },

  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Register built-in observers
observationManager.registerObserver(webObserver);
observationManager.registerObserver(androidObserver);

// Set web observer as active by default
observationManager.setActiveObserver('web');
