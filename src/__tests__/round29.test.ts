import { describe, it, expect, vi, afterEach } from 'vitest';
import { tapElementTool } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const b = { x: 0, y: 100, width: 300, height: 60 };

describe('round 29: fresh-tree match includes contentDescription', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(element: any, treeNode: any) {
    const tap = vi.fn().mockResolvedValue({ success: true });
    const mockHands = {
      isConnected: () => true,
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      findElementByText: vi.fn().mockImplementation(async () => JSON.parse(JSON.stringify(element))),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { id: 'root', clickable: false, bounds: { x: 0, y: 0, width: 300, height: 600 }, children: [treeNode] } }),
      tap,
    };
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
    return tap;
  }

  it('refuses when the tree node with the same id/text/bounds has a different description', async () => {
    const el = { id: 'go', text: 'Go', contentDescription: 'Go to settings', clickable: true, bounds: b };
    const tap = setup(el, { ...el, contentDescription: 'Delete account' });
    const r = await tapElementTool.execute({ elementText: 'Go' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('no longer on the current screen');
    expect(tap).not.toHaveBeenCalled();
  });

  it('taps when the tree node matches including the description', async () => {
    const el = { id: 'go', text: 'Go', contentDescription: 'Go to settings', clickable: true, bounds: b };
    const tap = setup(el, { ...el });
    const r = await tapElementTool.execute({ elementText: 'Go' });
    expect(r.success).toBe(true);
    expect(tap).toHaveBeenCalledTimes(1);
  });
});
