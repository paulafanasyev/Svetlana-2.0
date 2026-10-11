// Раунд 20: жест пользователя разрешает только то действие, под которое выдан; жест без привязки — никакое.
import { describe, it, expect, beforeEach } from 'vitest';
import { authorizeAction, userGesture, setActionConfirmer, resetActionGate } from '../services/security/ActionGate';

/** Объект, который проходит проверку «настоящее событие браузера» (в тестах нет живых нажатий). */
const trusted = () => Object.create(Event.prototype, { isTrusted: { value: true } }) as Event;

beforeEach(() => resetActionGate());

describe('gesture bound to an action', () => {
  it('a gesture for one tool does not authorize another tool', async () => {
    const asked: string[] = [];
    setActionConfirmer(async (req) => { asked.push(`${req.tool}:${req.source}`); return false; });
    const g = userGesture(trusted(), 'biz_add_income', { name: 'X' });
    expect(await authorizeAction({ tool: 'crm_add_contact', args: { name: 'X' }, source: 'user', gesture: g })).toBe(false);
    expect(asked).toEqual(['crm_add_contact:unknown']);
  });

  it('a gesture for the same tool authorizes once', async () => {
    setActionConfirmer(async () => false);
    const g = userGesture(trusted(), 'biz_add_income', { amount: 1 });
    expect(await authorizeAction({ tool: 'biz_add_income', args: { amount: 1 }, source: 'user', gesture: g })).toBe(true);
    expect(await authorizeAction({ tool: 'biz_add_income', args: { amount: 1 }, source: 'user', gesture: g })).toBe(false);
  });

  it('an unbound gesture authorizes no tool', async () => {
    const asked: string[] = [];
    setActionConfirmer(async (req) => { asked.push(req.source); return false; });
    const g = userGesture(trusted());
    expect(await authorizeAction({ tool: 'biz_add_income', args: {}, source: 'user', gesture: g })).toBe(false);
    expect(asked).toEqual(['unknown']);
  });
});
