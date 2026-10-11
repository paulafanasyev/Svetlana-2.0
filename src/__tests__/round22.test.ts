// Раунд 22: если телефонную книгу не удалось проверить (нет разрешения, ошибка моста),
// send_message по имени не пишет (fail closed); по номеру — можно.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';
import { HTTPHands } from '../services/HTTPHands';

function phone(listContacts: ReturnType<typeof vi.fn>) {
  const hands = Object.assign(Object.create(HTTPHands.prototype), {
    listContacts,
    launchApp: vi.fn().mockResolvedValue({ success: false }),
    getCurrentApp: vi.fn().mockResolvedValue('org.telegram.messenger'),
    tap: vi.fn().mockResolvedValue({ success: true }),
    type: vi.fn().mockResolvedValue({ success: true }),
  });
  vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
  vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);
  return hands;
}

describe('send_message fails closed when contacts cannot be checked', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('contacts permission denied: nothing is opened or typed', async () => {
    const hands = phone(vi.fn().mockRejectedValue(new Error('READ_CONTACTS denied')));
    const r = await toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact: 'Alex', message: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Could not check');
    expect(hands.launchApp).not.toHaveBeenCalled();
    expect(hands.type).not.toHaveBeenCalled();
  });

  it('garbage reply from the bridge: refused', async () => {
    const hands = phone(vi.fn().mockResolvedValue({ nope: true }));
    const r = await toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact: 'Alex', message: 'hi' });
    expect(r.success).toBe(false);
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('a phone number still works without the phone book', async () => {
    const hands = phone(vi.fn().mockRejectedValue(new Error('denied')));
    await toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact: '+7 900 000-00-01', message: 'hi' });
    expect(hands.launchApp).toHaveBeenCalled();
  });
});
