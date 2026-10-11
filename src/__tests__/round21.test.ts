// Раунд 21: жест привязан к точным аргументам и выдаётся только по настоящему Event;
// send_message не выбирает «первого попавшегося» из нескольких контактов с одним именем.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authorizeAction, userGesture, setActionConfirmer, resetActionGate } from '../services/security/ActionGate';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';
import { HTTPHands } from '../services/HTTPHands';

const trusted = () => Object.create(Event.prototype, { isTrusted: { value: true } }) as Event;

describe('gesture bound to exact arguments', () => {
  beforeEach(() => resetActionGate());

  it('a gesture for 100 does not authorize 999999', async () => {
    const asked: string[] = [];
    setActionConfirmer(async (req) => { asked.push(req.source); return false; });
    const g = userGesture(trusted(), 'biz_add_income', { amount: 100 });
    expect(await authorizeAction({ tool: 'biz_add_income', args: { amount: 999999 }, source: 'user', gesture: g })).toBe(false);
    expect(asked).toEqual(['unknown']);
  });

  it('key order does not matter, values do', async () => {
    setActionConfirmer(async () => false);
    const g = userGesture(trusted(), 'biz_add_income', { amount: 100, description: 'a' });
    expect(await authorizeAction({ tool: 'biz_add_income', args: { description: 'a', amount: 100 }, source: 'user', gesture: g })).toBe(true);
  });

  it('a plain object pretending to be a trusted event gives no gesture', () => {
    expect(userGesture({ isTrusted: true }, 'biz_add_income', {})).toBeUndefined();
    expect(userGesture(new Event('click'), 'biz_add_income', {})).toBeUndefined(); // синтетическое событие
  });

  it('a tool-bound gesture without arguments authorizes nothing', async () => {
    setActionConfirmer(async () => false);
    const g = userGesture(trusted(), 'biz_add_income');
    expect(await authorizeAction({ tool: 'biz_add_income', args: {}, source: 'user', gesture: g })).toBe(false);
  });
});

describe('send_message refuses an ambiguous contact name', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  function phone(contacts: { name: string }[]) {
    const hands = Object.assign(Object.create(HTTPHands.prototype), {
      listContacts: vi.fn().mockResolvedValue({ total: contacts.length, offset: 0, contacts }),
      launchApp: vi.fn().mockResolvedValue({ success: false }),
      getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger'),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);
    return hands;
  }

  it('two phone contacts named Alex: nothing is opened or typed', async () => {
    const hands = phone([{ name: 'Alex' }, { name: 'Alex Smith' }]);
    const r = await toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact: 'Alex', message: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('several contacts');
    expect(hands.launchApp).not.toHaveBeenCalled();
    expect(hands.type).not.toHaveBeenCalled();
  });

  it('a unique name goes on to the messenger', async () => {
    const hands = phone([{ name: 'Alex' }, { name: 'Alexandra' }]);
    await toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact: 'Alex', message: 'hi' });
    expect(hands.launchApp).toHaveBeenCalled();
  });

  it('a phone number is not checked against names', async () => {
    const hands = phone([{ name: 'A' }, { name: 'B' }]);
    await toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact: '+7 900 000-00-01', message: 'hi' });
    expect(hands.listContacts).not.toHaveBeenCalled();
    expect(hands.launchApp).toHaveBeenCalled();
  });
});
