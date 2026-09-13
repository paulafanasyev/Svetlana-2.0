// Verification Module - Post-action state verification

export interface VerificationRequest {
  action: string;
  expectedState: any;
  actualState: any;
  tolerance?: number;
  timeout?: number;
}

export interface VerificationResult {
  success: boolean;
  confidence: number;
  differences: string[];
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

class Verification {
  private readonly MAX_RETRIES = 3;
  private verificationHistory: VerificationResult[] = [];

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const differences: string[] = [];
    let confidence = 1.0;

    if (typeof request.expectedState === 'object' && request.expectedState !== null &&
        typeof request.actualState === 'object' && request.actualState !== null) {
      differences.push(...this.deepCompare(request.expectedState, request.actualState));
      confidence = Math.max(0, 1 - differences.length * 0.1);
    } else if (request.expectedState !== request.actualState) {
      differences.push(`Expected: ${request.expectedState}, Actual: ${request.actualState}`);
      confidence = 0;
    }

    if (request.tolerance !== undefined && differences.length <= request.tolerance) {
      confidence = Math.min(1, confidence + 0.2);
    }

    // Verification must not report PASS while the observed state contradicts
    // the expected contract. Tolerance is the only explicit exception.
    const withinTolerance = request.tolerance !== undefined && differences.length <= request.tolerance;
    const result: VerificationResult = {
      success: differences.length === 0 || (withinTolerance && confidence > 0.8),
      confidence,
      differences,
      suggestions: this.generateSuggestions(differences),
      timestamp: Date.now(),
    };

    this.verificationHistory.push(result);
    if (this.verificationHistory.length > 100) this.verificationHistory.shift();
    return result;
  }

  private deepCompare(expected: any, actual: any, path: string = ''): string[] {
    const differences: string[] = [];
    if (expected === actual) return differences;
    if (typeof expected !== typeof actual) {
      differences.push(`${path}: Type mismatch - expected ${typeof expected}, got ${typeof actual}`);
      return differences;
    }
    if (Array.isArray(expected) && Array.isArray(actual)) {
      if (expected.length !== actual.length) {
        differences.push(`${path}: Array length mismatch - expected ${expected.length}, got ${actual.length}`);
      }
      const minLen = Math.min(expected.length, actual.length);
      for (let i = 0; i < minLen; i++) {
        differences.push(...this.deepCompare(expected[i], actual[i], `${path}[${i}]`));
      }
    } else if (typeof expected === 'object' && expected !== null) {
      // expectedState is a partial contract. Runtime metadata in actualState is allowed.
      for (const key of Object.keys(expected)) {
        if (!(key in actual)) differences.push(`${path}.${key}: Missing in actual state`);
        else differences.push(...this.deepCompare(expected[key], actual[key], `${path}.${key}`));
      }
    } else if (expected !== actual) {
      differences.push(`${path}: Value mismatch - expected "${expected}", got "${actual}"`);
    }
    return differences;
  }

  private generateSuggestions(differences: string[]): string[] {
    if (differences.length === 0) return [];
    const suggestions: string[] = [];
    for (const diff of differences) {
      if (diff.includes('Missing')) suggestions.push('Element may not have loaded yet. Wait and retry.');
      else if (diff.includes('Extra')) suggestions.push('Unexpected element appeared. Check for popups or dialogs.');
      else if (diff.includes('Value mismatch')) suggestions.push('State changed differently than expected. Re-observe and re-plan.');
      else if (diff.includes('Type mismatch')) suggestions.push('Data structure changed. Re-ground to correct element.');
    }
    return [...new Set(suggestions)];
  }

  async verifyWithRetry(request: VerificationRequest, observeFn: () => Promise<any>, maxRetries: number = this.MAX_RETRIES): Promise<{ result: VerificationResult; retries: number }> {
    let retries = 0;
    while (retries < maxRetries) {
      const result = await this.verify({ ...request, actualState: await observeFn() });
      if (result.success) return { result, retries };
      retries++;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
    }
    return { result: await this.verify({ ...request, actualState: await observeFn() }), retries };
  }

  async verifyScreenState(expected: ScreenState, actual: ScreenState): Promise<VerificationResult> {
    const differences: string[] = [];
    let confidence = 1.0;
    if (expected.text && actual.text && !actual.text.includes(expected.text)) {
      differences.push(`Expected text "${expected.text}" not found in screen`);
      confidence -= 0.3;
    }
    for (const expectedElement of expected.elements) {
      const matchingElement = actual.elements.find(e => e.id === expectedElement.id);
      if (!matchingElement) { differences.push(`Element ${expectedElement.id} not found`); confidence -= 0.2; continue; }
      if (expectedElement.visible && !matchingElement.visible) { differences.push(`Element ${expectedElement.id} is not visible`); confidence -= 0.2; }
      if (expectedElement.clickable && !matchingElement.clickable) { differences.push(`Element ${expectedElement.id} is not clickable`); confidence -= 0.1; }
      if (expectedElement.text && matchingElement.text !== expectedElement.text) { differences.push(`Element ${expectedElement.id} text mismatch`); confidence -= 0.1; }
    }
    confidence = Math.max(0, confidence);
    return { success: differences.length === 0, confidence, differences, suggestions: this.generateSuggestions(differences), timestamp: Date.now() };
  }

  getHistory(limit: number = 10): VerificationResult[] { return this.verificationHistory.slice(-limit); }
  getSuccessRate(): number {
    if (this.verificationHistory.length === 0) return 1.0;
    return this.verificationHistory.filter(r => r.success).length / this.verificationHistory.length;
  }
  clearHistory() { this.verificationHistory = []; }
}

export const verification = new Verification();
