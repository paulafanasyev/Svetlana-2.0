// Голос владельца: признаки, шаблон, отказ чужому голосу, тишине и битому шаблону.
import { describe, it, expect } from 'vitest';
import { computeVoicePrint, buildTemplate, verifyPrint, loadTemplate, saveTemplate } from '../services/voice/VoicePrint';

function rnd(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
/** Синтетический «голос»: основной тон f0 и форманты (резонансы речевого тракта). */
function voice(f0: number, formants: number[], seed: number, sr = 16000, sec = 2): Float32Array {
  const r = rnd(seed); const n = sr * sec; const out = new Float32Array(n);
  const jitter = 1 + (r() - 0.5) * 0.06;
  for (let h = 1; h * f0 * jitter < sr / 2 - 200; h++) {
    const f = h * f0 * jitter; let a = 0;
    for (const F of formants) a += Math.exp(-((f - F) ** 2) / (2 * (F * 0.08) ** 2));
    a = a / h ** 0.3 + 0.01; const ph = r() * 6.28;
    for (let i = 0; i < n; i++) out[i] += a * Math.sin(2 * Math.PI * f * i / sr + ph) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / sr));
  }
  let m = 0; for (const x of out) m = Math.max(m, Math.abs(x));
  for (let i = 0; i < n; i++) out[i] = out[i] / m * 0.5 + (r() - 0.5) * 0.01;
  return out;
}
const OWNER = [700, 1200, 2600];
const OTHER = [400, 2000, 2900];
const owner = (seed: number, f0 = 120) => computeVoicePrint(voice(f0, OWNER, seed), 16000);

describe('voiceprint', () => {
  const tpl = buildTemplate([owner(1)!, owner(2)!, owner(3)!]);
  it('accepts the owner on new phrases', () => {
    for (const s of [10, 11, 12]) expect(verifyPrint(owner(s, 118 + (s % 5)), tpl).ok).toBe(true);
  });
  it('rejects another voice', () => {
    for (const s of [20, 21]) expect(verifyPrint(computeVoicePrint(voice(210, OTHER, s), 16000), tpl).ok).toBe(false);
  });
  it('rejects silence, too-short audio and needs 3 enrollment phrases', () => {
    expect(verifyPrint(computeVoicePrint(new Float32Array(32000), 16000), tpl).ok).toBe(false);
    expect(computeVoicePrint(voice(120, OWNER, 5, 16000, 0.3), 16000)).toBeNull();
    expect(() => buildTemplate([owner(1)!, owner(2)!])).toThrow();
  });
  it('stores only valid templates', () => {
    const m = new Map<string, string>();
    const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    saveTemplate(tpl, kv);
    expect(loadTemplate(kv)?.distThreshold).toBe(tpl.distThreshold);
    m.set('svetlana_voiceprint_v1', JSON.stringify({ ...tpl, distThreshold: 1000 }));
    expect(loadTemplate(kv)).toBeNull(); // подмена «пропускать всех» не принимается
    m.set('svetlana_voiceprint_v1', '{bad');
    expect(loadTemplate(kv)).toBeNull();
  });
});
