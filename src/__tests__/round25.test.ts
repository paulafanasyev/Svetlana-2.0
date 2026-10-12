// Раунд 25: инструменты выполняются только через toolRegistry (ActionGate + схема). Ни один модуль
// приложения (кроме самого реестра) не зовёт Tool.execute напрямую; E2E-отправка без согласия не идёт.
import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';
import { setActionConfirmer, resetActionGate } from '../services/security/ActionGate';
import { runRealE2ETest_SendMessage } from '../services/RealE2ETest';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') out.push(...sources(p)); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('tools run only through the registry gate', () => {
  it('no app module calls Tool.execute directly', () => {
    const direct = /\b(?:[A-Za-z_$][\w$]*Tool|tool)\.execute\s*\(/;
    const offenders = sources('src')
      .filter(f => !/[\\/]ToolRegistry\.ts$/.test(f))
      .filter(f => direct.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  beforeEach(() => { vi.restoreAllMocks(); resetActionGate(); registerRealTools(); });

  it('the E2E send is refused when the human declines', async () => {
    const asked: string[] = [];
    setActionConfirmer(async (req) => { asked.push(req.tool); return false; });
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    const execute = vi.spyOn(toolRegistry.getTool('send_message')!, 'execute');
    const r = await runRealE2ETest_SendMessage('org.telegram.messenger', 'Alex', 'hi');
    expect(r.success).toBe(false);
    expect(asked).toContain('send_message');
    expect(execute).not.toHaveBeenCalled();
  });
});
