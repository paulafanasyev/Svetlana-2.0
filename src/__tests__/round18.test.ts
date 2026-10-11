// Раунд 18: перед нажатием «Отправить» фокус всё ещё в том же поле сообщения;
// клавиша (Enter и т.п.) нажимается только если фокус не ушёл в другое поле.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const APP = 'org.telegram.messenger';
const input = (id: string, text = '') => ({ type: 'EditText', focused: true, id, bounds: { x: 0, y: 900, width: 500, height: 80 }, text, children: [] });
const chat = (title: string, fieldId = 'msg') => ({ root: { children: [{ text: title, children: [] }, input(fieldId), { text: 'Hello John!', children: [] }] } });
const contactRow = { id: 'c', text: 'John', bounds: { x: 0, y: 100, width: 500, height: 80 } };
const sendBtn = { id: 's', text: 'Send', bounds: { x: 500, y: 900, width: 80, height: 80 } };

function use(hands: any) {
  vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
  vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);
}

describe('send_message re-checks the message field before Send', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('refuses when focus moved to another field after typing', async () => {
    let calls = 0;
    const hands = {
      launchApp: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue(APP),
      findElementByText: vi.fn(async (t: string) => (t === 'John' ? contactRow : t === 'Send' ? sendBtn : null)),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
      // До ввода — поле сообщения; после ввода фокус в другом поле (заголовок тот же).
      getAccessibilityTree: vi.fn(async () => { calls += 1; return calls <= 3 ? chat('John') : chat('John', 'other'); }),
    };
    use(hands);
    const result = await toolRegistry.getTool('send_message')!.execute({ app: APP, contact: 'John', message: 'Hello John!' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('input field changed');
    expect(result.data?.sent).toBe(false);
    expect(hands.type).toHaveBeenCalledTimes(1);
    expect(hands.tap).toHaveBeenCalledTimes(1);
  }, 15000);
});

describe('press_key binds to the focused field', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('refuses when focus moved to another field before the key', async () => {
    const hands = {
      pressKey: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
      getAccessibilityTree: vi.fn()
        .mockResolvedValueOnce({ root: { children: [input('note')] } })
        .mockResolvedValue({ root: { children: [input('password')] } }),
    };
    use(hands);
    const result = await toolRegistry.getTool('press_key')!.execute({ key: 'enter' });
    expect(result.success).toBe(false);
    expect(hands.pressKey).not.toHaveBeenCalled();
  });

  it('presses the key when focus is unchanged', async () => {
    const hands = {
      pressKey: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [input('note')] } }),
    };
    use(hands);
    const result = await toolRegistry.getTool('press_key')!.execute({ key: 'enter' });
    expect(result.success).toBe(true);
    expect(hands.pressKey).toHaveBeenCalledWith('enter');
  });
});
