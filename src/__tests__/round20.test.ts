// Раунд 20: жест пользователя, выданный под конкретное действие, не разрешает другое.
import { describe, it, expect, beforeEach } from 'vitest';
import { authorizeAction, userGesture, setActionConfirmer, resetActionGate } from '../services/security/ActionGate';

beforeEach(() => resetActionGate());

describe('gesture bound to an action', () => {
  it('a gesture for one tool does not authorize another tool', async () => {
    const asked: string[] = [];
    setActionConfirmer(async (req) => { asked.push(`${req.tool}:${req.source}`); return false; });
    const g = userGesture({ isTrusted: true }, 'biz_add_income');
    expect(await authorizeAction({ tool: 'crm_add_contact', args: { name: 'X' }, source: 'user', gesture: g })).toBe(false);
    expect(asked).toEqual(['crm_add_contact:unknown']);
  });

  it('a gesture for the same tool authorizes once', async () => {
    setActionConfirmer(async () => false);
    const g = userGesture({ isTrusted: true }, 'biz_add_income');
    expect(await authorizeAction({ tool: 'biz_add_income', args: { amount: 1 }, source: 'user', gesture: g })).toBe(true);
    expect(await authorizeAction({ tool: 'biz_add_income', args: { amount: 1 }, source: 'user', gesture: g })).toBe(false);
  });

  it('an unbound gesture still works as before', async () => {
    setActionConfirmer(async () => false);
    const g = userGesture({ isTrusted: true });
    expect(await authorizeAction({ tool: 'biz_add_income', args: {}, source: 'user', gesture: g })).toBe(true);
  });
});
