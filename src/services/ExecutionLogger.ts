// Execution Logger - Detailed logging for local execution and verification

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
    this.logs.push({ timestamp: Date.now(), level, category, message, data, requestId });
    if (this.logs.length > this.maxLogs) this.logs = this.logs.slice(-this.maxLogs);

    if (typeof window !== 'undefined' && (window as any).__DEV__) {
      const prefix = `[${level.toUpperCase()}] [${category}]`;
      if (level === 'error') console.error(prefix, message, data || '');
      else if (level === 'warn') console.warn(prefix, message, data || '');
      else if (level === 'debug') console.debug(prefix, message, data || '');
      else console.log(prefix, message, data || '');
    }
  }

  info(category: string, message: string, data?: any, requestId?: string) { this.log('info', category, message, data, requestId); }
  warn(category: string, message: string, data?: any, requestId?: string) { this.log('warn', category, message, data, requestId); }
  error(category: string, message: string, data?: any, requestId?: string) { this.log('error', category, message, data, requestId); }
  debug(category: string, message: string, data?: any, requestId?: string) { this.log('debug', category, message, data, requestId); }

  toolExecution(toolId: string, params: any, requestId: string) { this.info('tool', `Executing tool: ${toolId}`, { params }, requestId); }
  toolSuccess(toolId: string, result: any, requestId: string) { this.info('tool', `Tool succeeded: ${toolId}`, { result }, requestId); }
  toolFailure(toolId: string, error: string, requestId: string) { this.error('tool', `Tool failed: ${toolId}`, { error }, requestId); }

  verificationStart(toolId: string, requestId: string) { this.debug('verification', `Starting verification for: ${toolId}`, undefined, requestId); }
  verificationSuccess(toolId: string, details: any, requestId: string) { this.info('verification', `Verification passed: ${toolId}`, details, requestId); }
  verificationFailure(toolId: string, details: any, requestId: string) { this.warn('verification', `Verification failed: ${toolId}`, details, requestId); }

  localExecutionStart(toolId: string, requestId: string) { this.debug('local-execution', `Starting local Android execution: ${toolId}`, undefined, requestId); }
  localExecutionResult(toolId: string, result: any, requestId: string) { this.info('local-execution', `Local Android execution result: ${toolId}`, result, requestId); }
  accessibilityServiceState(state: string, data?: any) { this.info('accessibility', `AccessibilityService state: ${state}`, data); }

  policyCheck(toolId: string, riskLevel: string, decision: string, requestId: string) { this.info('policy', `Policy check: ${toolId}`, { riskLevel, decision }, requestId); }
  policyDenial(toolId: string, reason: string, requestId: string) { this.warn('policy', `Policy denied: ${toolId}`, { reason }, requestId); }

  getLogs(limit?: number, category?: string, level?: LogEntry['level']): LogEntry[] {
    let filtered = this.logs;
    if (category) filtered = filtered.filter(log => log.category === category);
    if (level) filtered = filtered.filter(log => log.level === level);
    return limit ? filtered.slice(-limit) : filtered;
  }

  getLogsByRequestId(requestId: string): LogEntry[] { return this.logs.filter(log => log.requestId === requestId); }
  clearLogs() { this.logs = []; }
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  isEnabled(): boolean { return this.enabled; }

  getStats() {
    const stats = { total: this.logs.length, byLevel: { info: 0, warn: 0, error: 0, debug: 0 }, byCategory: {} as Record<string, number> };
    for (const log of this.logs) {
      stats.byLevel[log.level]++;
      stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
    }
    return stats;
  }

  exportLogs(): string { return JSON.stringify(this.logs, null, 2); }
  importLogs(json: string) {
    try {
      const logs = JSON.parse(json);
      if (Array.isArray(logs)) this.logs = logs;
    } catch (error) {
      this.error('logger', 'Failed to import logs', { error });
    }
  }
}

export const executionLogger = new ExecutionLogger();
