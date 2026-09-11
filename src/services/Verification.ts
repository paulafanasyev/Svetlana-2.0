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
  confidence: number; // 0-1
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
    const startTime = Date.now();
    const differences: string[] = [];
    let confidence = 1.0;

    // Compare expected vs actual state
    if (typeof request.expectedState === 'object' && typeof request.actualState === 'object') {
      const diff = this.deepCompare(request.expectedState, request.actualState);
      differences.push(...diff);
      confidence = Math.max(0, 1 - (diff.length * 0.1));
    } else if (request.expectedState !== request.actualState) {
      differences.push(`Expected: ${request.expectedState}, Actual: ${request.actualState}`);
      confidence = 0;
    }

    // Apply tolerance
    if (request.tolerance && differences.length <= request.tolerance) {
      confidence = Math.min(1, confidence + 0.2);
    }

    const result: VerificationResult = {
      success: differences.length === 0 || confidence > 0.8,
      confidence,
      differences,
      suggestions: this.generateSuggestions(differences),
      timestamp: Date.now(),
    };

    this.verificationHistory.push(result);
    if (this.verificationHistory.length > 100) {
      this.verificationHistory.shift();
    }

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
      const expectedKeys = Object.keys(expected);
      const actualKeys = Object.keys(actual);

      // Check for missing keys
      for (const key of expectedKeys) {
        if (!(key in actual)) {
          differences.push(`${path}.${key}: Missing in actual state`);
        } else {
          differences.push(...this.deepCompare(expected[key], actual[key], `${path}.${key}`));
        }
      }

      // Check for extra keys
      for (const key of actualKeys) {
        if (!(key in expected)) {
          differences.push(`${path}.${key}: Extra key in actual state`);
        }
      }
    } else if (expected !== actual) {
      differences.push(`${path}: Value mismatch - expected "${expected}", got "${actual}"`);
    }

    return differences;
  }

  private generateSuggestions(differences: string[]): string[] {
    const suggestions: string[] = [];

    if (differences.length === 0) return suggestions;

    // Analyze differences and provide suggestions
    for (const diff of differences) {
      if (diff.includes('Missing')) {
        suggestions.push('Element may not have loaded yet. Wait and retry.');
      } else if (diff.includes('Extra')) {
        suggestions.push('Unexpected element appeared. Check for popups or dialogs.');
      } else if (diff.includes('Value mismatch')) {
        suggestions.push('State changed differently than expected. Re-observe and re-plan.');
      } else if (diff.includes('Type mismatch')) {
        suggestions.push('Data structure changed. Re-ground to correct element.');
      }
    }

    // Remove duplicates
    return [...new Set(suggestions)];
  }

  async verifyWithRetry(
    request: VerificationRequest,
    observeFn: () => Promise<any>,
    maxRetries: number = this.MAX_RETRIES
  ): Promise<{ result: VerificationResult; retries: number }> {
    let retries = 0;

    while (retries < maxRetries) {
      const actualState = await observeFn();
      const result = await this.verify({ ...request, actualState });

      if (result.success) {
        return { result, retries };
      }

      retries++;
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
    }

    // Final attempt
    const actualState = await observeFn();
    const result = await this.verify({ ...request, actualState });
    return { result, retries };
  }

  // Screen state verification
  async verifyScreenState(expected: ScreenState, actual: ScreenState): Promise<VerificationResult> {
    const differences: string[] = [];
    let confidence = 1.0;

    // Compare text content
    if (expected.text && actual.text) {
      if (!actual.text.includes(expected.text)) {
        differences.push(`Expected text "${expected.text}" not found in screen`);
        confidence -= 0.3;
      }
    }

    // Compare elements
    for (const expectedElement of expected.elements) {
      const matchingElement = actual.elements.find(e => e.id === expectedElement.id);
      
      if (!matchingElement) {
        differences.push(`Element ${expectedElement.id} not found`);
        confidence -= 0.2;
      } else {
        // Check if element is visible
        if (expectedElement.visible && !matchingElement.visible) {
          differences.push(`Element ${expectedElement.id} is not visible`);
          confidence -= 0.2;
        }

        // Check if element is clickable
        if (expectedElement.clickable && !matchingElement.clickable) {
          differences.push(`Element ${expectedElement.id} is not clickable`);
          confidence -= 0.1;
        }

        // Check text content
        if (expectedElement.text && matchingElement.text !== expectedElement.text) {
          differences.push(`Element ${expectedElement.id} text mismatch`);
          confidence -= 0.1;
        }
      }
    }

    confidence = Math.max(0, confidence);

    return {
      success: differences.length === 0 || confidence > 0.7,
      confidence,
      differences,
      suggestions: this.generateSuggestions(differences),
      timestamp: Date.now(),
    };
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
