import { describe, it, expect } from 'vitest';
import { compareScreenStates, flattenElements, observationManager, type ScreenState, type Observer } from '../services/ObservationLayer';

const base = (over: Partial<ScreenState> = {}): ScreenState => ({
  timestamp: 1,
  platform: 'android',
  currentApp: 'app',
  text: 'hello',
  elements: [
    { id: 'a', type: 'button', text: 'Отправить', enabled: true, children: [{ id: 'a1', type: 'text', text: 'x' }] },
    { id: 'b', type: 'input', text: '' },
  ],
  ...over,
});

describe('compareScreenStates', () => {
  it('same state means no change', () => {
    const r = compareScreenStates(base(), base());
    expect(r.changed).toBe(false);
    expect(r.differences).toEqual([]);
  });

  it('detects property change on the same id', () => {
    const after = base();
    after.elements[0] = { ...after.elements[0], enabled: false };
    const r = compareScreenStates(base(), after);
    expect(r.changed).toBe(true);
    expect(r.changedElements.map((e) => e.id)).toEqual(['a']);
  });

  it('detects text change in input', () => {
    const after = base();
    after.elements[1] = { ...after.elements[1], text: 'typed' };
    expect(compareScreenStates(base(), after).changedElements.map((e) => e.id)).toEqual(['b']);
  });

  it('looks into nested children', () => {
    const after = base();
    after.elements[0] = { ...after.elements[0], children: [{ id: 'a1', type: 'text', text: 'y' }] };
    const r = compareScreenStates(base(), after);
    expect(r.changedElements.map((e) => e.id)).toEqual(['a1']);
  });

  it('detects screen text and app change', () => {
    expect(compareScreenStates(base(), base({ text: 'other' })).changed).toBe(true);
    expect(compareScreenStates(base(), base({ currentApp: 'other' })).changed).toBe(true);
  });

  it('counts duplicate ids', () => {
    const before = base({ elements: [{ id: 'd', type: 't' }] });
    const after = base({ elements: [{ id: 'd', type: 't' }, { id: 'd', type: 't' }] });
    expect(compareScreenStates(before, after).newElements.length).toBe(1);
    expect(compareScreenStates(after, before).removedElements.length).toBe(1);
  });

  it('missing state counts as a change', () => {
    expect(compareScreenStates(undefined as unknown as ScreenState, base()).changed).toBe(true);
  });

  it('flatten survives cycles', () => {
    const a: any = { id: 'a', type: 't', children: [] };
    a.children.push(a);
    expect(flattenElements([a]).length).toBe(1);
  });
});

describe('observationManager.observe fail-closed', () => {
  const mk = (impl: Partial<Observer>): Observer => ({
    id: 'test-obs',
    name: 'T',
    platform: 'test',
    observe: async () => ({ success: true, confidence: 1 }),
    findElementByText: async () => null,
    findElementById: async () => null,
    elementExists: async () => false,
    getCurrentApp: async () => null,
    isAvailable: async () => true,
    ...impl,
  });

  it('throwing observer gives failure', async () => {
    observationManager.registerObserver(mk({ observe: async () => { throw new Error('boom'); } }));
    observationManager.setActiveObserver('test-obs');
    const r = await observationManager.observe();
    expect(r.success).toBe(false);
    expect(r.error).toBe('Observation failed');
  });

  it('success without state gives failure', async () => {
    observationManager.registerObserver(mk({}));
    observationManager.setActiveObserver('test-obs');
    expect((await observationManager.observe()).success).toBe(false);
  });

  it('throwing isAvailable gives failure', async () => {
    observationManager.registerObserver(mk({ isAvailable: async () => { throw new Error('x'); } }));
    observationManager.setActiveObserver('test-obs');
    expect((await observationManager.observe()).success).toBe(false);
    observationManager.unregisterObserver('test-obs');
    observationManager.setActiveObserver('web');
  });
});
