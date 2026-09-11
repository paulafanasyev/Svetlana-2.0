// Execution Logger - Detailed logging for debugging and monitoring

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  message: string;
  data?: any;
  requestId?: string;
}

class ExecutionLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private enabled = true;

  log(level: LogEntry['level'], category: string, message: string, data?: any, requestId?: string) {
    if (!this.enabled) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      requestId,
    };

    this.logs.push(entry);

    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Console output for development
    if (typeof window !== 'undefined' && (window as any).__DEV__) {
      const prefix = `[${level.toUpperCase()}] [${category}]`;
      switch (level) {
        case 'error':
          console.error(prefix, message, data || '');
          break;
        case 'warn':
          console.warn(prefix, message, data || '');
          break;
        case 'debug':
          console.debug(prefix, message, data || '');
          break;
        default:
          console.log(prefix, message, data || '');
      }
    }
  }

  info(category: string, message: string, data?: any, requestId?: string) {
    this.log('info', category, message, data, requestId);
  }

  warn(category: string, message: string, data?: any, requestId?: string) {
    this.log('warn', category, message, data, requestId);
  }

  error(category: string, message: string, data?: any, requestId?: string) {
    this.log('error', category, message, data, requestId);
  }

  debug(category: string, message: string, data?: any, requestId?: string) {
    this.log('debug', category, message, data, requestId);
  }

  // Tool execution logging
  toolExecution(toolId: string, params: any, requestId: string) {
    this.info('tool', `Executing tool: ${toolId}`, { params }, requestId);
  }

  toolSuccess(toolId: string, result: any, requestId: string) {
    this.info('tool', `Tool succeeded: ${toolId}`, { result }, requestId);
  }

  toolFailure(toolId: string, error: string, requestId: string) {
    this.error('tool', `Tool failed: ${toolId}`, { error }, requestId);
  }

  // Verification logging
  verificationStart(toolId: string, requestId: string) {
    this.debug('verification', `Starting verification for: ${toolId}`, undefined, requestId);
  }

  verificationSuccess(toolId: string, details: any, requestId: string) {
    this.info('verification', `Verification passed: ${toolId}`, details, requestId);
  }

  verificationFailure(toolId: string, details: any, requestId: string) {
    this.warn('verification', `Verification failed: ${toolId}`, details, requestId);
  }

  // Connection logging
  connectionAttempt(transport: string, endpoint: string) {
    this.info('connection', `Attempting connection via ${transport}`, { endpoint });
  }

  connectionSuccess(transport: string, endpoint: string) {
    this.info('connection', `Connected via ${transport}`, { endpoint });
  }

  connectionFailure(transport: string, endpoint: string, error: string) {
    this.error('connection', `Connection failed via ${transport}`, { endpoint, error });
  }

  // Policy logging
  policyCheck(toolId: string, riskLevel: string, decision: string, requestId: string) {
    this.info('policy', `Policy check: ${toolId}`, { riskLevel, decision }, requestId);
  }

  policyDenial(toolId: string, reason: string, requestId: string) {
    this.warn('policy', `Policy denied: ${toolId}`, { reason }, requestId);
  }

  // Get logs
  getLogs(limit?: number, category?: string, level?: LogEntry['level']): LogEntry[] {
    let filtered = this.logs;

    if (category) {
      filtered = filtered.filter(log => log.category === category);
    }

    if (level) {
      filtered = filtered.filter(log => log.level === level);
    }

    if (limit) {
      filtered = filtered.slice(-limit);
    }

    return filtered;
  }

  getLogsByRequestId(requestId: string): LogEntry[] {
    return this.logs.filter(log => log.requestId === requestId);
  }

  // Clear logs
  clearLogs() {
    this.logs = [];
  }

  // Enable/disable logging
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Statistics
  getStats() {
    const stats = {
      total: this.logs.length,
      byLevel: {
        info: 0,
        warn: 0,
        error: 0,
        debug: 0,
      },
      byCategory: {} as Record<string, number>,
    };

    for (const log of this.logs) {
      stats.byLevel[log.level]++;
      stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
    }

    return stats;
  }

  // Export logs
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  // Import logs
  importLogs(json: string) {
    try {
      const logs = JSON.parse(json);
      if (Array.isArray(logs)) {
        this.logs = logs;
      }
    } catch (error) {
      this.error('logger', 'Failed to import logs', { error });
    }
  }
}

export const executionLogger = new ExecutionLogger();
