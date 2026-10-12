// Раунд 23: телефонная книга считается проверенной только если все записи понятного вида
// и ответ полный (total не больше пришедших записей); иначе send_message по имени не пишет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';
import { HTTPHands } from '../services/HTTPHands';

function phone(page: unknown) {
  const hands = Object.assign(Object.create(HTTPHands.prototype), {
    listContacts: vi.fn().mockResolvedValue(page),
    launchApp: vi.fn().mockResolvedValue({ success: false }),
    getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger'),
    tap: vi.fn().mockResolvedValue({ success: true }),
    type: vi.fn().mockResolvedValue({ success: true }),
  });
  vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
  vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);
  return hands;
}

const send = () => toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact: 'Alex', message: 'hi' });

describe('send_message trusts only a complete, well-formed phone-book reply', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('a null entry: refused', async () => {
    const hands = phone({ total: 1, offset: 0, contacts: [null] });
    expect((await send()).success).toBe(false);
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('an entry without a name: refused', async () => {
    const hands = phone({ total: 1, offset: 0, contacts: [{ unexpected: 'value' }] });
    expect((await send()).error).toContain('Could not check');
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('an incomplete page (more matches than returned): refused', async () => {
    const hands = phone({ total: 250, offset: 0, contacts: [{ name: 'Alex' }] });
    expect((await send()).success).toBe(false);
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('missing total: refused', async () => {
    const hands = phone({ contacts: [{ name: 'Alex' }] });
    expect((await send()).success).toBe(false);
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('a complete reply with one Alex goes on', async () => {
    const hands = phone({ total: 1, offset: 0, contacts: [{ name: 'Alex' }] });
    await send();
    expect(hands.launchApp).toHaveBeenCalled();
  });
});
