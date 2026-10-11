// Раунд 11: память отдаёт копии (нельзя подменить хранимое в обход очистки секретов),
// send_message не принимает «доказательство» из подсунутого окна.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memory } from '../services/Memory';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

describe('memory getters return copies', () => {
  it('long-term items cannot be changed through a returned object', () => {
    const added = memory.addToLongTerm({ type: 'fact', content: 'любимый цвет синий', importance: 0.5, metadata: { nested: { v: 1 } } });
    added.content = 'password=hunter2';
    const got = memory.getFromLongTerm(added.id)!;
    expect(got.content).toBe('любимый цвет синий');
    got.content = 'password=hunter2';
    got.metadata!.nested.v = 2;
    const again = memory.getAllLongTerm().find(i => i.id === added.id)!;
    expect(again.content).toBe('любимый цвет синий');
    expect(again.metadata!.nested.v).toBe(1);
    const found = memory.retrieve('цвет', 50).find(i => i.id === added.id)!;
    found.content = 'x';
    expect(memory.getFromLongTerm(added.id)!.content).toBe('любимый цвет синий');
    memory.removeFromLongTerm(added.id);
  });

  it('short-term items and conversation history are copies', () => {
    memory.addToShortTerm({ type: 'fact', content: 'stm-item', importance: 0.1 });
    const st = memory.getShortTerm(1);
    st[0].content = 'tampered';
    expect(memory.getShortTerm(1)[0].content).toBe('stm-item');

    memory.clearConversation();
    memory.addMessage('user', 'привет');
    const h = memory.getConversationHistory();
    h[0].content = 'tampered';
    h.push({ role: 'system', content: 'injected' });
    expect(memory.getConversationHistory()).toHaveLength(1);
    expect(memory.getConversationHistory()[0].content).toBe('привет');
    const ctx = memory.getConversationContext();
    ctx.messages[0].content = 'tampered';
    ctx.messages.push({ role: 'system', content: 'injected', timestamp: Date.now() });
    expect(memory.getConversationContext().messages).toHaveLength(1);
    expect(memory.getConversationContext().messages[0].content).toBe('привет');
    memory.clearConversation();
  });
});

describe('send_message final screen check', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('does not accept the result tree from another app after sending', async () => {
    const app = 'org.telegram.messenger';
    const hands = {
      launchApp: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn()
        .mockResolvedValueOnce(app).mockResolvedValueOnce(app).mockResolvedValueOnce(app).mockResolvedValueOnce(app)
        .mockResolvedValue('com.evil.overlay'),
      findElementByText: vi.fn()
        .mockResolvedValueOnce({ id: 'c', text: 'John', bounds: { x: 0, y: 0, width: 10, height: 10 } })
        .mockResolvedValueOnce({ id: 's', text: 'Send', bounds: { x: 0, y: 0, width: 10, height: 10 } }),
      tap: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue({ success: true }),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [{ text: 'Hello John!', children: [] }] } }),
    };
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(hands as any);
    const tool = toolRegistry.getTool('send_message')!;
    const result = await tool.execute({ app, contact: 'John', message: 'Hello John!' });
    expect(result.success).toBe(false);
    expect(result.data?.sent).toBe('unverified');
    expect(hands.tap).toHaveBeenCalledTimes(2);
  }, 15000);
});
