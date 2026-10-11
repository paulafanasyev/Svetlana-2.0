// Раунд 19: Enter и другие «отправляющие» клавиши только в поле в фокусе;
// поиск в браузере вводит и отправляет запрос только в то же поле.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../services/ToolRegistry';
import { registerRealTools } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const input = (id: string) => ({ type: 'EditText', focused: true, id, bounds: { x: 0, y: 0, width: 500, height: 80 }, text: '', children: [] });
const noField = { root: { children: [{ type: 'TextView', text: 'x', children: [] }] } };

function use(hands: any) {
  vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
  vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);
}

describe('press_key submit keys', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  it('refuses Enter when no field is focused', async () => {
    const hands = {
      pressKey: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      getAccessibilityTree: vi.fn().mockResolvedValue(noField),
    };
    use(hands);
    const result = await toolRegistry.getTool('press_key')!.execute({ key: 'KEYCODE_ENTER' });
    expect(result.success).toBe(false);
    expect(hands.pressKey).not.toHaveBeenCalled();
  });

  it('allows navigation keys without a focused field', async () => {
    const hands = {
      pressKey: vi.fn().mockResolvedValue({ success: true }),
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      getAccessibilityTree: vi.fn().mockResolvedValue(noField),
    };
    use(hands);
    const result = await toolRegistry.getTool('press_key')!.execute({ key: 'volume_up' });
    expect(result.success).toBe(true);
    expect(hands.pressKey).toHaveBeenCalledWith('volume_up');
  });
});

describe('search_web binds the browser field', () => {
  beforeEach(() => { vi.restoreAllMocks(); registerRealTools(); });

  const base = () => ({
    launchApp: vi.fn().mockResolvedValue({ success: true }),
    getCurrentApp: vi.fn().mockResolvedValue('com.android.chrome'),
    type: vi.fn().mockResolvedValue({ success: true }),
    pressKey: vi.fn().mockResolvedValue({ success: true }),
  });

  it('refuses to type when no field is focused', async () => {
    const hands = { ...base(), getAccessibilityTree: vi.fn().mockResolvedValue(noField) };
    use(hands);
    const result = await toolRegistry.getTool('search_web')!.execute({ query: 'погода' });
    expect(result.success).toBe(false);
    expect(hands.type).not.toHaveBeenCalled();
  });

  it('does not press Enter when focus moved after typing', async () => {
    let calls = 0;
    const hands = { ...base(), getAccessibilityTree: vi.fn(async () => { calls += 1; return { root: { children: [input(calls <= 2 ? 'url' : 'other')] } }; }) };
    use(hands);
    const result = await toolRegistry.getTool('search_web')!.execute({ query: 'погода' });
    expect(result.success).toBe(false);
    expect(hands.type).toHaveBeenCalledTimes(1);
    expect(hands.pressKey).not.toHaveBeenCalled();
  });

  it('searches when the field stays the same', async () => {
    const hands = { ...base(), getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [input('url')] } }) };
    use(hands);
    const result = await toolRegistry.getTool('search_web')!.execute({ query: 'погода' });
    expect(result.success).toBe(true);
    expect(hands.pressKey).toHaveBeenCalledWith('enter');
  });
});
