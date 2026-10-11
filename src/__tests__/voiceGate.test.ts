// Голос — не согласие: даже проверенная голосом команда (или запись голоса владельца, воспроизведённая
// в доверенной сессии) не меняет и не показывает данные без явного нажатия в окне подтверждения.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { runCRMActions } from '../services/crm/CRMTools';
import { setActionConfirmer, resetActionGate, needsConfirmation, type ActionRequest } from '../services/security/ActionGate';
import { VoiceTrust } from '../services/voice/Liveness';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

describe('voice-originated actions', () => {
  beforeAll(() => {
    if (typeof (globalThis as any).localStorage === 'undefined') (globalThis as any).localStorage = memoryStorage();
  });
  afterEach(() => resetActionGate());

  it('a data change by voice is not executed until the person confirms it', async () => {
    const asked: ActionRequest[] = [];
    setActionConfirmer(async req => { asked.push(req); return false; });
    const lines = await runCRMActions([{ tool: 'crm_add_contact', args: { name: 'Тест Голос' } } as any], 'voice');
    expect(asked).toHaveLength(1);
    expect(asked[0].source).toBe('voice');
    expect(lines.join('\n')).toContain('Не выполнено без вашего подтверждения');
  });

  it('a voice command cannot claim to be a user click', async () => {
    const asked: ActionRequest[] = [];
    setActionConfirmer(async req => { asked.push(req); return false; });
    const lines = await runCRMActions([{ tool: 'crm_add_note', args: { name: 'X', text: 'y' } } as any], 'user');
    expect(asked).toHaveLength(1);
    expect(asked[0].source).not.toBe('user');
    expect(lines.join('\n')).toContain('Не выполнено без вашего подтверждения');
  });

  it('even a read-only lookup by voice is shown only after a click (a replayed recording learns nothing)', async () => {
    const asked: ActionRequest[] = [];
    setActionConfirmer(async req => { asked.push(req); return false; });
    const lines = await runCRMActions([{ tool: 'crm_stats', args: {} } as any], 'voice');
    expect(asked).toHaveLength(1);
    expect(asked[0].source).toBe('voice');
    expect(lines.join('\n')).toContain('Не выполнено без вашего подтверждения');
    expect(needsConfirmation('crm_find_contacts', 'voice')).toBe(true);
    expect(needsConfirmation('crm_find_contacts', 'unknown')).toBe(false);
    expect(needsConfirmation('crm_add_contact', 'user')).toBe(false);
  });

  it('trusted voice session ends after at most 5 minutes even with constant activity', () => {
    let now = 0;
    const trust = new VoiceTrust(undefined, undefined, () => now);
    trust.start('tpl');
    for (let i = 0; i < 4; i++) { now += 60_000; expect(trust.isValid('tpl')).toBe(true); trust.touch(); }
    now += 60_001;
    expect(trust.isValid('tpl')).toBe(false);
  });
});
