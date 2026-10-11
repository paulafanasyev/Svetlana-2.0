// Защита от записи голоса: случайные цифры, строгий разбор, доверенная сессия и пауза после неудач.
import { describe, it, expect } from 'vitest';
import {
  makeChallenge, generateChallenge, matchesChallenge, secureRandomInt, templateId,
  VoiceTrust, VoiceLockout, MAX_VOICE_FAILURES, VOICE_LOCK_MS,
} from '../services/voice/Liveness';

const c742 = makeChallenge([7, 4, 2]);
const c702 = makeChallenge([7, 0, 2]);
const c715 = makeChallenge([7, 1, 5]);

function seeded(seed: number) { return (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; }; }
function kv() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('liveness challenge', () => {
  it('spoken form and code', () => {
    expect(c742.code).toBe('742');
    expect(c742.spoken).toBe('семь, четыре, два');
    expect(() => makeChallenge([7, 4])).toThrow();
    expect(() => makeChallenge([7, 4, 12])).toThrow();
  });
  it('accepts typical recognizer outputs', () => {
    for (const t of ['7 4 2', '742', '7, 4, 2', 'семь четыре два', 'Семь, четыре, два.', 'семьсот сорок два', 'семьсот 42', 'это 7 4 2', 'света 742', '74 2', '7-4-2'])
      expect(matchesChallenge(t, c742), t).toBe(true);
    for (const t of ['702', '7 0 2', 'семь ноль два', 'семьсот два', 'семьсот 2']) expect(matchesChallenge(t, c702), t).toBe(true);
    for (const t of ['семьсот пятнадцать', '715', 'семь один пять', 'семьсот 15']) expect(matchesChallenge(t, c715), t).toBe(true);
  });
  it('rejects wrong, partial and malformed answers', () => {
    for (const t of [null, undefined, '', '   ', '7 4 3', '7 4', '7 4 2 1', 'семь четыре', 'семьсот сорок три', 'сорок два', 'светлана это я', '247', '7420', '1 742', 'x'.repeat(500),
      'семьсот сорок два ноль', 'сорок семьсот два', 'семьсот сорок 2 два', 'семьсот сорок два два', 'семьсот семьсот', 'семьсот 142', 'семь сорок два', 'constructor toString'])
      expect(matchesChallenge(t as string, c742), String(t)).toBe(false);
  });
  it('generates 3 digits without a leading zero', () => {
    const r = seeded(42);
    for (let i = 0; i < 500; i++) {
      const c = generateChallenge(r);
      expect(c.code).toMatch(/^[1-9][0-9]{2}$/);
      expect(matchesChallenge(c.code, c)).toBe(true);
      expect(matchesChallenge(c.spoken, c)).toBe(true);
    }
  });
  it('uses crypto randomness and varies', () => {
    const codes = new Set(Array.from({ length: 60 }, () => generateChallenge().code));
    expect(codes.size).toBeGreaterThan(20);
    for (let i = 0; i < 200; i++) { const n = secureRandomInt(9); expect(n >= 0 && n < 9).toBe(true); }
    expect(() => secureRandomInt(0)).toThrow();
  });
});

describe('voice trust session', () => {
  it('expires on idle and max time and is bound to the template', () => {
    const t = new VoiceTrust(100, 300, () => 0);
    expect(t.isValid('a', 0)).toBe(false);
    t.start('a', 0);
    expect(t.isValid('a', 50)).toBe(true);
    expect(t.isValid('b', 50)).toBe(false);
    expect(t.isValid('a', 101)).toBe(false);
    t.touch(90); t.touch(180);
    expect(t.isValid('a', 250)).toBe(true);
    t.touch(280);
    expect(t.isValid('a', 301)).toBe(false);
    t.start('a', 1000); t.end();
    expect(t.isValid('a', 1001)).toBe(false);
    t.start('a', 1000);
    expect(t.isValid('a', 995)).toBe(false); // часы назад
  });
  it('template id changes when the voice is re-recorded', () => {
    const base = { version: 1, createdAt: 1, samples: 5, distThreshold: 1.5, mean: [0.1, 0.2], sd: [1, 1] };
    expect(templateId(base)).toBe(templateId({ ...base }));
    expect(templateId(base)).not.toBe(templateId({ ...base, createdAt: 2 }));
    expect(templateId(base)).not.toBe(templateId({ ...base, sd: [1, 50] }));
    expect(templateId(base)).not.toBe(templateId({ ...base, mean: [0.1, 0.20001] }));
  });
});

describe('voice lockout', () => {
  it('locks after 5 failures, persists and resets on success', () => {
    const store = kv(); let now = 1_000_000;
    const l = new VoiceLockout(store, () => now);
    for (let i = 1; i < MAX_VOICE_FAILURES; i++) expect(l.fail()).toBe(0);
    expect(l.remainingMs()).toBe(0);
    expect(l.fail()).toBe(VOICE_LOCK_MS);
    expect(new VoiceLockout(store, () => now).remainingMs()).toBe(VOICE_LOCK_MS); // после перезапуска
    now += VOICE_LOCK_MS - 1;
    expect(l.remainingMs()).toBe(1);
    now += 2;
    expect(l.remainingMs()).toBe(0);
    l.fail(); l.fail(); l.reset(); l.fail(); l.fail(); l.fail(); l.fail();
    expect(l.remainingMs()).toBe(0);
  });
  it('is not extended or lifted by clock tricks and ignores garbage', () => {
    const store = kv(); let now = 10_000_000;
    const l = new VoiceLockout(store, () => now);
    for (let i = 0; i < MAX_VOICE_FAILURES; i++) l.fail();
    now -= 60 * 60_000; // часы перевели на час назад
    expect(l.remainingMs()).toBe(VOICE_LOCK_MS);
    store.m.set('svetlana_voice_lockout_v1', '{bad');
    expect(l.remainingMs()).toBe(0);
    store.m.set('svetlana_voice_lockout_v1', JSON.stringify({ failures: -3, until: 'x' }));
    expect(l.fail()).toBe(0);
  });
});
