import { describe, it, expect, vi, afterEach } from 'vitest';
import { tapElementTool } from '../services/RealTools';
import { handsManager } from '../services/HandsManager';

const b = (y: number) => ({ x: 0, y, width: 300, height: 60 });

function setup(element: any, root: any) {
  const tap = vi.fn().mockResolvedValue({ success: true });
  const mockHands = {
    isConnected: () => true,
    getCurrentApp: vi.fn().mockResolvedValue('com.example.app'),
    findElementByText: vi.fn().mockImplementation(async () => JSON.parse(JSON.stringify(element))),
    getAccessibilityTree: vi.fn().mockResolvedValue({ root }),
    tap,
  };
  vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
  vi.spyOn(handsManager, 'getHands').mockReturnValue(mockHands as any);
  return tap;
}

describe('round 26: tap does not escalate to a dangerous clickable parent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a safe label inside a clickable "Delete account" parent', async () => {
    const child = { id: 'label', text: 'Continue', clickable: false, bounds: b(100) };
    const root = { id: 'root', clickable: false, bounds: b(0), children: [
      { id: 'btn_delete_account', text: '', contentDescription: 'Delete account', clickable: true, bounds: b(90), children: [child] },
    ] };
    const tap = setup(child, root);
    const r = await tapElementTool.execute({ elementText: 'Continue' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/risky/i);
    expect(tap).not.toHaveBeenCalled();
  });

  it('refuses a safe label inside a clickable Russian "Оплатить" parent', async () => {
    const child = { id: 'label', text: 'Далее', clickable: false, bounds: b(100) };
    const root = { id: 'root', clickable: false, bounds: b(0), children: [
      { id: 'row', text: '', contentDescription: 'Оплатить 5000 ₽', clickable: true, bounds: b(90), children: [child] },
    ] };
    const tap = setup(child, root);
    const r = await tapElementTool.execute({ elementText: 'Далее' });
    expect(r.success).toBe(false);
    expect(tap).not.toHaveBeenCalled();
  });

  it('taps a label inside a harmless clickable row', async () => {
    const child = { id: 'label', text: 'Settings', clickable: false, bounds: b(100) };
    const root = { id: 'root', clickable: false, bounds: b(0), children: [
      { id: 'row_settings', text: '', contentDescription: 'Open settings', clickable: true, bounds: b(90), children: [child] },
    ] };
    const tap = setup(child, root);
    const r = await tapElementTool.execute({ elementText: 'Settings' });
    expect(r.success).toBe(true);
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('taps a clickable element even inside a dangerous parent (the element itself gets the tap)', async () => {
    const child = { id: 'cancel', text: 'Cancel', clickable: true, bounds: b(100) };
    const root = { id: 'root', clickable: false, bounds: b(0), children: [
      { id: 'delete_dialog', text: '', contentDescription: 'Delete', clickable: true, bounds: b(90), children: [child] },
    ] };
    const tap = setup(child, root);
    const r = await tapElementTool.execute({ elementText: 'Cancel' });
    expect(r.success).toBe(true);
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-clickable element that is missing from the tree', async () => {
    const el = { id: 'ghost', text: 'Continue', clickable: false, bounds: b(100) };
    const tap = setup(el, { id: 'root', clickable: false, bounds: b(0), children: [] });
    const r = await tapElementTool.execute({ elementText: 'Continue' });
    expect(r.success).toBe(false);
    expect(tap).not.toHaveBeenCalled();
  });
});
