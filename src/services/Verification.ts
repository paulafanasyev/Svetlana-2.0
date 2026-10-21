// Verification Module - Post-action state verification
// Проверка строгая (fail-closed):
// - ожидаемое состояние — подмножество: каждое ожидаемое поле должно совпасть; лишние поля ответа (data, message)
//   не считаются ошибкой, а только записываются в extras;
// - любое расхождение = неудача (раньше одно расхождение давало «уверенность 0,9» и успех,
//   даже если инструмент ответил success: false). Допуск даёт только явный tolerance;
// - нет ответа (null, не объект), ошибка наблюдения или не найденный элемент экрана — тоже неудача.

export interface VerificationRequest {
  action: string;
  expectedState: any;
  actualState: any;
  /** Сколько расхождений допустимо (по умолчанию 0: любое расхождение — неудача). */
  tolerance?: number;
  timeout?: number;
}

export interface VerificationResult {
  success: boolean;
  confidence: number; // 0-1
  differences: string[];
  /** Лишние поля в ответе: для журнала, на успех не влияют. */
  extras?: string[];
  suggestions?: string[];
  timestamp: number;
}

export interface ScreenState {
  elements: UIElement[];
  text?: string;
  screenshot?: string;
}

export interface UIElement {
  id: string;
  type: string;
  text?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  clickable?: boolean;
  visible?: boolean;
}

const MAX_DIFFS = 50;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function confidenceFor(diffs: number): number {
  return diffs === 0 ? 1 : Math.max(0, 1 - diffs * 0.25);
}

function allowed(diffs: number, tolerance: unknown): boolean {
  if (diffs === 0) return true;
  const t = Number(tolerance);
  return Number.isInteger(t) && t > 0 && diffs <= t;
}

class Verification {
  private readonly MAX_RETRIES = 3;
  private verificationHistory: VerificationResult[] = [];

  private record(result: VerificationResult): VerificationResult {
    this.verificationHistory.push(result);
    if (this.verificationHistory.length > 100) {
      this.verificationHistory.shift();
    }
    return result;
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const differences: string[] = [];
    const extras: string[] = [];

    if (typeof request.expectedState === 'object' && request.expectedState !== null) {
      this.deepCompare(request.expectedState, request.actualState, '', differences, extras);
    } else if (!Object.is(request.expectedState, request.actualState)) {
      differences.push(`Expected: ${String(request.expectedState)}, Actual: ${String(request.actualState)}`);
    }

    const result: VerificationResult = {
      success: allowed(differences.length, request.tolerance),
      confidence: confidenceFor(differences.length),
      differences,
      extras,
      suggestions: this.generateSuggestions(differences),
      timestamp: Date.now(),
    };
    return this.record(result);
  }

  /** Сравнение «ожидаемое — подмножество фактического»: расхождения в differences, лишние поля в extras. */
  private deepCompare(expected: any, actual: any, path: string, differences: string[], extras: string[]): void {
    if (differences.length >= MAX_DIFFS) return;
    if (Object.is(expected, actual)) return;
    const at = path || '(root)';

    if (expected === null || actual === null || actual === undefined || typeof expected !== typeof actual) {
      differences.push(`${at}: Type mismatch - expected ${expected === null ? 'null' : typeof expected}, got ${actual === null ? 'null' : typeof actual}`);
      return;
    }

    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) {
        differences.push(`${at}: Type mismatch - expected array, got object`);
        return;
      }
      if (expected.length !== actual.length) {
        differences.push(`${at}: Array length mismatch - expected ${expected.length}, got ${actual.length}`);
      }
      const minLen = Math.min(expected.length, actual.length);
      for (let i = 0; i < minLen; i++) {
        this.deepCompare(expected[i], actual[i], `${path}[${i}]`, differences, extras);
      }
      return;
    }

    if (isPlainObject(expected)) {
      if (!isPlainObject(actual)) {
        differences.push(`${at}: Type mismatch - expected object, got array`);
        return;
      }
      for (const key of Object.keys(expected)) {
        if (!Object.prototype.hasOwnProperty.call(actual, key)) {
          differences.push(`${path}.${key}: Missing in actual state`);
        } else {
          this.deepCompare(expected[key], actual[key], `${path}.${key}`, differences, extras);
        }
      }
      for (const key of Object.keys(actual)) {
        if (!Object.prototype.hasOwnProperty.call(expected, key) && extras.length < MAX_DIFFS) {
          extras.push(`${path}.${key}`);
        }
      }
      return;
    }

    differences.push(`${at}: Value mismatch - expected "${String(expected)}", got "${String(actual)}"`);
  }

  private generateSuggestions(differences: string[]): string[] {
    const suggestions: string[] = [];

    if (differences.length === 0) return suggestions;

    // Analyze differences and provide suggestions
    for (const diff of differences) {
      if (diff.includes('Missing')) {
        suggestions.push('Element may not have loaded yet. Wait and retry.');
      } else if (diff.includes('Value mismatch')) {
        suggestions.push('State changed differently than expected. Re-observe and re-plan.');
      } else if (diff.includes('Type mismatch')) {
        suggestions.push('Data structure changed. Re-ground to correct element.');
      } else if (diff.includes('Observation failed')) {
        suggestions.push('Could not observe the result. Check the screen manually.');
      }
    }

    // Remove duplicates
    return [...new Set(suggestions)];
  }

  /** Наблюдение с ошибкой — неудача проверки, а не исключение наружу. */
  private async observeAndVerify(request: VerificationRequest, observeFn: () => Promise<any>): Promise<VerificationResult> {
    let actualState: any;
    try {
      actualState = await observeFn();
    } catch {
      return this.record({
        success: false,
        confidence: 0,
        differences: ['Observation failed'],
        extras: [],
        suggestions: this.generateSuggestions(['Observation failed']),
        timestamp: Date.now(),
      });
    }
    return this.verify({ ...request, actualState });
  }

  async verifyWithRetry(
    request: VerificationRequest,
    observeFn: () => Promise<any>,
    maxRetries: number = this.MAX_RETRIES
  ): Promise<{ result: VerificationResult; retries: number }> {
    const limit = Number.isInteger(maxRetries) ? Math.min(10, Math.max(0, maxRetries)) : this.MAX_RETRIES;
    let retries = 0;

    while (retries < limit) {
      const result = await this.observeAndVerify(request, observeFn);

      if (result.success) {
        return { result, retries };
      }

      retries++;
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
    }

    // Final attempt
    const result = await this.observeAndVerify(request, observeFn);
    return { result, retries };
  }

  // Screen state verification: любое несовпадение (текст не найден, элемента нет, он скрыт) — неудача.
  async verifyScreenState(expected: ScreenState, actual: ScreenState): Promise<VerificationResult> {
    const differences: string[] = [];
    const expectedElements = Array.isArray(expected?.elements) ? expected.elements : [];
    const actualElements = Array.isArray(actual?.elements) ? actual.elements : [];

    if (!actual || typeof actual !== 'object') {
      differences.push('Observation failed');
    }

    // Compare text content
    if (expected?.text) {
      if (typeof actual?.text !== 'string' || !actual.text.includes(expected.text)) {
        differences.push(`Expected text "${expected.text}" not found in screen`);
      }
    }

    // Compare elements
    for (const expectedElement of expectedElements) {
      const matchingElement = actualElements.find(e => e.id === expectedElement.id);
      
      if (!matchingElement) {
        differences.push(`Element ${expectedElement.id} not found`);
      } else {
        if (expectedElement.visible && !matchingElement.visible) {
          differences.push(`Element ${expectedElement.id} is not visible`);
        }
        if (expectedElement.clickable && !matchingElement.clickable) {
          differences.push(`Element ${expectedElement.id} is not clickable`);
        }
        if (expectedElement.text && matchingElement.text !== expectedElement.text) {
          differences.push(`Element ${expectedElement.id} text mismatch`);
        }
      }
    }

    return this.record({
      success: differences.length === 0,
      confidence: confidenceFor(differences.length),
      differences,
      extras: [],
      suggestions: this.generateSuggestions(differences),
      timestamp: Date.now(),
    });
  }

  // Get verification history
  getHistory(limit: number = 10): VerificationResult[] {
    return this.verificationHistory.slice(-limit);
  }

  // Get success rate
  getSuccessRate(): number {
    if (this.verificationHistory.length === 0) return 1.0;
    const successful = this.verificationHistory.filter(r => r.success).length;
    return successful / this.verificationHistory.length;
  }

  clearHistory() {
    this.verificationHistory = [];
  }
}

export const verification = new Verification();
