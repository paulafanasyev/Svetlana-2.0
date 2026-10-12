import { describe, it, expect, vi, afterEach } from 'vitest';
import { tapElementTool } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const b = (y: number) => ({ x: 0, y, width: 300, height: 60 });

describe('round 27: tap checks the freshest tree after the element re-check', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses when the element is reparented under a dangerous clickable parent after the first look', async () => {
    const child = { id: 'label', text: 'Continue', clickable: false, bounds: b(100) };
    const safeTree = { root: { id: 'root', clickable: false, bounds: b(0), children: [
      { id: 'row_next', text: '', contentDescription: 'Next step', clickable: true, bounds: b(90), children: [child] },
    ] } };
    const dangerousTree = { root: { id: 'root', clickable: false, bounds: b(0), children: [
      { id: 'btn_delete_account', text: '', contentDescription: 'Delete account', clickable: true, bounds: b(90), children: [child] },
    ] } };
    const tap = vi.fn().mockResolvedValue({ success: true });
    const mockHands = {
      isConnected: () => true,
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      findElementByText: vi.fn().mockImplementation(async () => JSON.parse(JSON.stringify(child))),
      // The tree is read only after the second look; by then the parent is dangerous.
      getAccessibilityTree: vi.fn().mockResolvedValueOnce(dangerousTree).mockResolvedValue(safeTree),
      tap,
    };
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
    const r = await tapElementTool.execute({ elementText: 'Continue' });
    expect(r.success).toBe(false);
    expect(tap).not.toHaveBeenCalled();
  });

  it('refuses when the element became non-clickable or its description changed between the two looks', async () => {
    const first = { id: 'go', text: 'Go', contentDescription: 'Go', clickable: true, bounds: b(100) };
    const second = { ...first, contentDescription: 'Delete', clickable: false };
    const tap = vi.fn().mockResolvedValue({ success: true });
    const mockHands = {
      isConnected: () => true,
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      findElementByText: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      getAccessibilityTree: vi.fn().mockResolvedValue({ root: { children: [] } }),
      tap,
    };
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
    const r = await tapElementTool.execute({ elementText: 'Go' });
    expect(r.success).toBe(false);
    expect(tap).not.toHaveBeenCalled();
  });

  it('refuses when the tree node disagrees with the element about clickability', async () => {
    const el = { id: 'label', text: 'Continue', clickable: true, bounds: b(100) };
    const tree = { root: { id: 'root', clickable: false, bounds: b(0), children: [
      { id: 'btn_delete', text: '', contentDescription: 'Delete', clickable: true, bounds: b(90), children: [{ ...el, clickable: false }] },
    ] } };
    const tap = vi.fn().mockResolvedValue({ success: true });
    const mockHands = {
      isConnected: () => true,
      getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
      findElementByText: vi.fn().mockImplementation(async () => ({ ...el, bounds: { ...el.bounds } })),
      getAccessibilityTree: vi.fn().mockResolvedValue(tree),
      tap,
    };
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
    const r = await tapElementTool.execute({ elementText: 'Continue' });
    expect(r.success).toBe(false);
    expect(tap).not.toHaveBeenCalled();
  });
});
