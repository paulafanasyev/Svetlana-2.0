import { describe, it, expect, vi, afterEach } from 'vitest';
import { stricterSource, needsConfirmation } from '../services/security/ActionGate';
import { toModelHistory, DATA_OMITTED } from '../services/security/History';
import { tapElementTool } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

describe('round 15: voice provenance and data', () => {
  it('voice is never downgraded to llm', () => {
    expect(stricterSource('llm', 'voice')).toBe('voice');
    expect(stricterSource('voice', 'llm')).toBe('voice');
    expect(stricterSource('voice', 'user')).toBe('voice');
    expect(stricterSource('user', 'llm')).toBe('llm');
    expect(stricterSource('user', 'user')).toBe('user');
    expect(stricterSource(undefined, 'user')).toBe('unknown');
    expect(needsConfirmation('crm_find_contacts', stricterSource('llm', 'voice'))).toBe(true);
  });

  it('voice history hides earlier tool results', () => {
    const turns = [
      { role: 'user' as const, content: 'Сводка CRM' },
      { role: 'svetlana' as const, content: 'Иван +79990000000, долг 50 000', hasData: true },
      { role: 'svetlana' as const, content: 'Привет' },
    ];
    const voice = toModelHistory(turns, { hideData: true });
    expect(voice[1].content).toBe(DATA_OMITTED);
    expect(JSON.stringify(voice)).not.toContain('79990000000');
    expect(voice[2].content).toContain('Привет');
    const typed = toModelHistory(turns);
    expect(typed[1].content).toContain('79990000000');
  });
});

describe('round 15: tap re-checks the element', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses when the element moved or changed right before the tap', async () => {
    const tap = vi.fn().mockResolvedValue({ success: true });
    const mockHands = {
      isConnected: () => true,
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      findElementByText: vi.fn()
        .mockResolvedValueOnce({ id: 'ok', text: 'OK', bounds: { x: 0, y: 0, width: 100, height: 40 } })
        .mockResolvedValueOnce({ id: 'pay', text: 'OK', bounds: { x: 0, y: 300, width: 100, height: 40 } }),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [] } }),
      tap,
    };
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
    const r = await tapElementTool.execute({ elementText: 'OK' });
    expect(r.success).toBe(false);
    expect(tap).not.toHaveBeenCalled();
  });

  it('taps when the element is unchanged', async () => {
    const el = { id: 'ok', text: 'OK', bounds: { x: 0, y: 0, width: 100, height: 40 } };
    const tap = vi.fn().mockResolvedValue({ success: true });
    const mockHands = {
      isConnected: () => true,
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      findElementByText: vi.fn().mockResolvedValue({ ...el, bounds: { ...el.bounds } }),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [] } }),
      tap,
    };
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
    const r = await tapElementTool.execute({ elementText: 'OK' });
    expect(r.success).toBe(true);
    expect(tap).toHaveBeenCalledTimes(1);
  });
});
