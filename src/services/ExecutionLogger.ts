// Execution Logger - Detailed logging for debugging and monitoring
// Безопасность: всё, что попадает в журнал, проходит маскировку (security/Redact): API-ключи, токены,
// код подключения телефона, номера карт и телефонов, скриншоты и поля вроде password/apiKey не
// сохраняются ни в памяти журнала, ни в экспорте. Импорт журнала проверяется и тоже маскируется.
// Хранение ограничено: не больше 1000 записей и не дольше часа с момента записи (как журнал ToolRegistry).
import { redactText, redactValue } from './security/Redact';
import { safeJsonParse } from './security/SafeData';

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  message: string;
  data?: any;
  requestId?: string;
}

const LEVELS: LogEntry['level'][] = ['info', 'warn', 'error', 'debug'];
export const LOG_TTL_MS = 60 * 60 * 1000;

function clean(level: LogEntry['level'], category: unknown, message: unknown, data?: unknown, requestId?: unknown, timestamp = Date.now()): LogEntry {
  return {
    timestamp,
    level,
    category: redactText(category).slice(0, 60),
    message: redactText(message).slice(0, 2000),
    data: data === undefined ? undefined : redactValue(data),
    requestId: requestId == null ? undefined : String(requestId).slice(0, 100),
  };
}

class ExecutionLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private enabled = true;
  /** Когда запись попала в журнал (для срока хранения; не экспортируется). */
  private addedAt = new WeakMap<LogEntry, number>();

  private prune(now = Date.now()) {
    this.logs = this.logs.filter(e => now - (this.addedAt.get(e) ?? now) <= LOG_TTL_MS).slice(-this.maxLogs);
  }

  private keep(entry: LogEntry) {
    this.addedAt.set(entry, Date.now());
    this.logs.push(entry);
    this.prune();
  }

  log(level: LogEntry['level'], category: string, message: string, data?: any, requestId?: string) {
    if (!this.enabled) return;

    const entry = clean(level, category, message, data, requestId);
    this.keep(entry);

    if (typeof window !== 'undefined' && (window as any).__DEV__) {
      const prefix = `[${level.toUpperCase()}] [${entry.category}]`;
      switch (level) {
        case 'error':
          console.error(prefix, entry.message, entry.data || '');
          break;
        case 'warn':
          console.warn(prefix, entry.message, entry.data || '');
          break;
        case 'debug':
          console.debug(prefix, entry.message, entry.data || '');
          break;
        default:
          console.log(prefix, entry.message, entry.data || '');
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

  toolExecution(toolId: string, params: any, requestId: string) {
    this.info('tool', `Executing tool: ${toolId}`, { params }, requestId);
  }

  toolSuccess(toolId: string, result: any, requestId: string) {
    this.info('tool', `Tool succeeded: ${toolId}`, { result }, requestId);
  }

  toolFailure(toolId: string, error: string, requestId: string) {
    this.error('tool', `Tool failed: ${toolId}`, { error }, requestId);
  }

  verificationStart(toolId: string, requestId: string) {
    this.debug('verification', `Starting verification for: ${toolId}`, undefined, requestId);
  }

  verificationSuccess(toolId: string, details: any, requestId: string) {
    this.info('verification', `Verification passed: ${toolId}`, details, requestId);
  }

  verificationFailure(toolId: string, details: any, requestId: string) {
    this.warn('verification', `Verification failed: ${toolId}`, details, requestId);
  }

  connectionAttempt(transport: string, endpoint: string) {
    this.info('connection', `Attempting connection via ${transport}`, { endpoint });
  }

  connectionSuccess(transport: string, endpoint: string) {
    this.info('connection', `Connected via ${transport}`, { endpoint });
  }

  connectionFailure(transport: string, endpoint: string, error: string) {
    this.error('connection', `Connection failed via ${transport}`, { endpoint, error });
  }

  policyCheck(toolId: string, riskLevel: string, decision: string, requestId: string) {
    this.info('policy', `Policy check: ${toolId}`, { riskLevel, decision }, requestId);
  }

  policyDenial(toolId: string, reason: string, requestId: string) {
    this.warn('policy', `Policy denied: ${toolId}`, { reason }, requestId);
  }

  getLogs(limit?: number, category?: string, level?: LogEntry['level']): LogEntry[] {
    this.prune();
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
    this.prune();
    return this.logs.filter(log => log.requestId === requestId);
  }

  clearLogs() {
    this.logs = [];
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getStats() {
    this.prune();
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

  exportLogs(): string {
    this.prune();
    return JSON.stringify(this.logs, null, 2);
  }

  importLogs(json: string) {
    try {
      const logs = safeJsonParse(json, 10 * 1024 * 1024);
      if (Array.isArray(logs)) {
        const now = Date.now();
        this.logs = logs
          .filter((e: any) => e && typeof e === 'object' && LEVELS.includes(e.level) && typeof e.message === 'string')
          .slice(-this.maxLogs)
          .map((e: any) => clean(e.level, e.category, e.message, e.data, e.requestId, Number.isFinite(e.timestamp) ? e.timestamp : now));
        for (const e of this.logs) this.addedAt.set(e, now);
      }
    } catch (error) {
      this.error('logger', 'Failed to import logs', { error });
    }
  }
}

export const executionLogger = new ExecutionLogger();
