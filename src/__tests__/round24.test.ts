// Раунд 24: «номер» без цифр не обходит проверку телефонной книги; по имени пишем только
// если в книге ровно один подходящий контакт.
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

const send = (contact: string) => toolRegistry.getTool('send_message')!.execute({ app: 'org.telegram.messenger', contact, message: 'hi' });
const page = (names: string[]) => ({ total: names.length, offset: 0, contacts: names.map(name => ({ name })) });

describe('send_message: phone numbers and exactly one phone contact', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('separators without digits are not a phone number', async () => {
    const hands = phone(vi.fn().mockRejectedValue(new Error('denied')));
    for (const fake of ['-----', '.....', '(  )  -', '+ . . . .']) {
      expect((await send(fake)).success).toBe(false);
    }
    expect(hands.listContacts).toHaveBeenCalled();
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('a real number still skips the phone book', async () => {
    const hands = phone(vi.fn().mockResolvedValue(page([])));
    await send('+84 90 123 45 67');
    expect(hands.listContacts).not.toHaveBeenCalled();
    expect(hands.launchApp).toHaveBeenCalled();
  });

  it('a name that is not in the phone contacts: refused', async () => {
    const hands = phone(vi.fn().mockResolvedValue(page(['Boris', 'Alexandra'])));
    const r = await send('Alex');
    expect(r.success).toBe(false);
    expect(r.error).toContain('not in the phone contacts');
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('an empty, complete reply: refused', async () => {
    const hands = phone(vi.fn().mockResolvedValue(page([])));
    expect((await send('Alex')).success).toBe(false);
    expect(hands.launchApp).not.toHaveBeenCalled();
  });

  it('exactly one matching contact goes on', async () => {
    const hands = phone(vi.fn().mockResolvedValue(page(['Alex Smith', 'Boris'])));
    await send('Alex');
    expect(hands.launchApp).toHaveBeenCalled();
  });
});
