// Раунд 16: ввод только в то поле, что было в фокусе; сообщение — только в чат с нужным собеседником
// и той же кнопкой «Отправить», строка чата не подменена между поиском и нажатием.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const APP = 'org.telegram.messenger';
const input = (id: string, text = '') => ({ type: 'EditText', focused: true, id, bounds: { x: 0, y: 900, width: 500, height: 80 }, text, children: [] });
const chat = (title: string) => ({ root: { children: [{ text: title, children: [] }, input('msg'), { text: 'Hello John!', children: [] }] } });
const contactRow = { id: 'c', text: 'John', bounds: { x: 0, y: 100, width: 500, height: 80 } };
const sendBtn = { id: 's', text: 'Send', bounds: { x: 500, y: 900, width: 80, height: 80 } };

function use(hands: any) {
  vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
  vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);
}

describe('type_text binds to the focused field', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('refuses when focus moved to another field before typing', async () => {
    const hands = {
      type: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
      getAccessibilityTree: vi.fn()
        .mockResolvedValueOnce({ root: { children: [input('note')] } })
        .mockResolvedValue({ root: { children: [input('password')] } }),
    };
    use(hands);
    const result = await toolRegistry.getTool('type_text')!.execute({ text: 'secret' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('input field changed');
    expect(hands.type).not.toHaveBeenCalled();
  });

  it('refuses when no field is focused', async () => {
    const hands = {
      type: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [{ type: 'TextView', text: 'x', children: [] }] } }),
    };
    use(hands);
    const result = await toolRegistry.getTool('type_text')!.execute({ text: 'x' });
    expect(result.success).toBe(false);
    expect(hands.type).not.toHaveBeenCalled();
  });

  it('verification only reads the same field', async () => {
    const tool = toolRegistry.getTool('type_text')!;
    const hands = {
      type: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('com.example.notes'),
      getAccessibilityTree: vi.fn()
        .mockResolvedValueOnce({ root: { children: [input('note')] } })
        .mockResolvedValueOnce({ root: { children: [input('note')] } })
        .mockResolvedValue({ root: { children: [input('other', 'hi')] } }),
    };
    use(hands);
    const result = await tool.execute({ text: 'hi' });
    expect(result.success).toBe(true);
    expect(await tool.verify!({ text: 'hi' }, result)).toBe(false);
  });
});

describe('send_message binds contact, recipient and send button', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('refuses when the chat row changes between search and tap', async () => {
    const hands = {
      launchApp: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue(APP),
      findElementByText: vi.fn()
        .mockResolvedValueOnce(contactRow)
        .mockResolvedValue({ ...contactRow, bounds: { ...contactRow.bounds, y: 300 } }),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
      getAccessibilityTree: vi.fn().mockResolvedValue(chat('John')),
    };
    use(hands);
    const result = await toolRegistry.getTool('send_message')!.execute({ app: APP, contact: 'John', message: 'Hello John!' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('element changed');
    expect(hands.tap).not.toHaveBeenCalled();
  }, 15000);

  it('refuses when the opened chat is with someone else', async () => {
    const hands = {
      launchApp: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue(APP),
      findElementByText: vi.fn(async (t: string) => (t === 'John' ? contactRow : t === 'Send' ? sendBtn : null)),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
      getAccessibilityTree: vi.fn().mockResolvedValue(chat('Mallory')),
    };
    use(hands);
    const result = await toolRegistry.getTool('send_message')!.execute({ app: APP, contact: 'John', message: 'Hello John!' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not with the requested contact');
    expect(hands.type).not.toHaveBeenCalled();
  }, 15000);

  it('refuses when the send button changes before the tap', async () => {
    let sendCalls = 0;
    const hands = {
      launchApp: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue(APP),
      findElementByText: vi.fn(async (t: string) => {
        if (t === 'John') return contactRow;
        if (t === 'Send') { sendCalls += 1; return sendCalls === 1 ? sendBtn : { ...sendBtn, id: 'pay' }; }
        return null;
      }),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
      getAccessibilityTree: vi.fn().mockResolvedValue(chat('John')),
    };
    use(hands);
    const result = await toolRegistry.getTool('send_message')!.execute({ app: APP, contact: 'John', message: 'Hello John!' });
    expect(result.success).toBe(false);
    expect(result.data?.sent).toBe(false);
    expect(hands.tap).toHaveBeenCalledTimes(1);
  }, 15000);

  it('sends when contact, recipient, field and button all match', async () => {
    const hands = {
      launchApp: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue(APP),
      findElementByText: vi.fn(async (t: string) => (t === 'John' ? contactRow : t === 'Send' ? sendBtn : null)),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
      getAccessibilityTree: vi.fn().mockResolvedValue(chat('John')),
    };
    use(hands);
    const tool = toolRegistry.getTool('send_message')!;
    const params = { app: APP, contact: 'John', message: 'Hello John!' };
    const result = await tool.execute(params);
    expect(result.success).toBe(true);
    expect(hands.tap).toHaveBeenCalledTimes(2);
    expect(await tool.verify!(params, result)).toBe(true);
  }, 15000);
});
