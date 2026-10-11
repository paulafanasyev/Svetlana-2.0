// Голосовая проверка на ПК: команда выполняется только после голоса владельца и верных случайных цифр;
// затем доверенная сессия, чужой голос и не те цифры считаются попытками, после 5 неудач пауза.
import { describe, it, expect } from 'vitest';
import { createVoiceGuard, type GuardDeps, type PcmCapture } from '../services/voice/VoiceGuard';
import { makeChallenge, VoiceLockout, VoiceTrust } from '../services/voice/Liveness';
import type { ListenOptions, Listener } from '../services/voice/SpeechEngine';
import type { VoicePrint, VoiceTemplate } from '../services/voice/VoicePrint';

const TPL: VoiceTemplate = { version: 1, mean: [0], sd: [1], distThreshold: 1.5, samples: 5, createdAt: 1 };
const OWNER = 0.2, STRANGER = 9, SILENCE = -1;

function harness(opts: { continuous?: boolean } = {}) {
  const listeners: { o: ListenOptions; stopped: boolean }[] = [];
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let clock = 0; let seq = 0;
  let level = OWNER;               // какой «голос» сейчас в микрофоне
  let tpl: VoiceTemplate | null = TPL;
  const spoken: string[] = [];
  const events: string[] = [];
  const store = new Map<string, string>();
  const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  let now = 0;
  const trust = new VoiceTrust(120_000, 600_000, () => now);
  const lockout = new VoiceLockout(kv, () => 1_000_000 + now);
  const deps: GuardDeps = {
    listen: (o: ListenOptions): Listener => {
      const rec = { o, stopped: false };
      listeners.push(rec);
      return { mode: 'web', stop: () => { if (!rec.stopped) { rec.stopped = true; o.onEnd?.(); } } };
    },
    startCapture: async (): Promise<PcmCapture> => ({
      take: () => ({ pcm: new Float32Array([level]), sampleRate: 16000 }),
      stop: () => undefined,
    }),
    speak: (t, onEnd) => { spoken.push(t); onEnd(); },
    stopSpeaking: () => undefined,
    loadTemplate: () => tpl,
    computePrint: (pcm): VoicePrint | null => (pcm[0] === SILENCE ? null : { v: [pcm[0]], frames: 50 }),
    verify: (p, t) => (p.v[0] <= t.distThreshold ? { ok: true, score: p.v[0] } : { ok: false, score: p.v[0], reason: 'чужой' }),
    generate: () => makeChallenge([7, 4, 2]),
    trust, lockout,
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ at: clock + ms, fn, id }); return id; },
    clearTimeout: id => { timers = timers.filter(t => t.id !== id); },
  };
  const guard = createVoiceGuard(deps);
  const l = guard({
    continuous: opts.continuous,
    onFinal: t => events.push('RUN ' + t),
    onError: m => events.push('ERR ' + m),
    onEnd: () => events.push('END'),
  });
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  /** Прокрутить время вперёд на ms, выполняя таймеры по порядку. */
  const runTimers = async (ms = 1000) => {
    await flush();
    const until = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift(); clock = t.at; t.fn(); await flush();
    }
    clock = until;
  };
  /** Сказать фразу в активный распознаватель (последний не остановленный). */
  const say = async (text: string, voice = OWNER, end = !opts.continuous) => {
    await flush();
    level = voice;
    const rec = [...listeners].reverse().find(r => !r.stopped)!;
    rec.o.onFinal(text);
    if (end) { rec.stopped = true; rec.o.onEnd?.(); }
    await flush();
  };
  return {
    l, say, events, spoken, listeners, runTimers, flush, lockout, trust,
    setTemplate: (t: VoiceTemplate | null) => { tpl = t; },
    advance: (ms: number) => { now += ms; },
    guard,
  };
}

describe('voice guard with liveness', () => {
  it('asks for digits before the first command and runs it only after the right answer', async () => {
    const h = harness();
    await h.say('получил пять тысяч');
    expect(h.events).toEqual([]);
    expect(h.spoken[0]).toContain('семь, четыре, два');
    await h.runTimers();
    await h.say('семь четыре два');
    expect(h.events).toEqual(['RUN получил пять тысяч', 'END']);
  });
  it('trusted session skips digits but still checks the voice of every phrase', async () => {
    const h = harness();
    await h.say('команда один'); await h.runTimers(); await h.say('742');
    const h2 = h.guard({ onFinal: t => h.events.push('RUN ' + t), onError: m => h.events.push('ERR ' + m), onEnd: () => h.events.push('END') });
    expect(h2).not.toBeNull();
    await h.say('команда два');
    expect(h.events.slice(-2)).toEqual(['RUN команда два', 'END']);
    expect(h.spoken.length).toBe(1);
    const h3 = h.guard({ onFinal: t => h.events.push('RUN ' + t), onError: m => h.events.push('ERR ' + m), onEnd: () => h.events.push('END') });
    expect(h3).not.toBeNull();
    await h.say('команда три', STRANGER);
    expect(h.events.slice(-2)).toEqual(['ERR чужой', 'END']);
    expect(h.trust.isValid('x')).toBe(false);
  });
  it('rejects wrong digits, a stranger answering, silence and a timeout', async () => {
    for (const [answer, voice] of [['7 4 3', OWNER], ['742', STRANGER], ['742', SILENCE]] as const) {
      const h = harness();
      await h.say('удали клиента'); await h.runTimers(); await h.say(answer, voice);
      expect(h.events.some(e => e.startsWith('RUN'))).toBe(false);
      expect(h.events[h.events.length - 1]).toBe('END');
    }
    const h = harness();
    await h.say('удали клиента');
    await h.flush();
    await h.runTimers(30_000); // молчим дольше 20 с
    expect(h.events.some(e => e.startsWith('RUN'))).toBe(false);
    expect(h.events[h.events.length - 1]).toBe('END');
    expect(h.listeners.every(r => r.stopped)).toBe(true); // микрофон и распознавание закрыты
  });
  it('stranger never triggers digits and 5 failures pause voice control', async () => {
    const h = harness();
    await h.say('переведи деньги', STRANGER);
    expect(h.spoken.length).toBe(0);
    for (let i = 0; i < 4; i++) {
      const g = h.guard({ onFinal: () => h.events.push('RUN'), onError: m => h.events.push('ERR ' + m), onEnd: () => undefined });
      expect(g).not.toBeNull();
      await h.say('переведи деньги', STRANGER);
    }
    expect(h.lockout.remainingMs()).toBeGreaterThan(0);
    const blocked = h.guard({ onFinal: () => h.events.push('RUN'), onError: m => h.events.push('ERR ' + m), onEnd: () => undefined });
    expect(blocked).toBeNull();
    expect(h.events[h.events.length - 1]).toContain('на паузе');
    expect(h.events.includes('RUN')).toBe(false);
  });
  it('re-recorded voice cancels the pending command', async () => {
    const h = harness();
    await h.say('команда'); await h.runTimers();
    h.setTemplate({ ...TPL, createdAt: 2 });
    await h.say('742');
    expect(h.events.some(e => e.startsWith('RUN'))).toBe(false);
  });
  it('hands-free: resumes listening after the digits and ignores phrases during the check', async () => {
    const h = harness({ continuous: true });
    await h.say('светлана, что у меня завтра');
    await h.runTimers();
    const answerRec = h.listeners[h.listeners.length - 1];
    expect(answerRec.o.continuous).toBe(false);
    answerRec.o.onFinal('семьсот сорок два'); answerRec.stopped = true; answerRec.o.onEnd?.();
    await h.flush(); await h.flush();
    expect(h.events).toEqual(['RUN светлана, что у меня завтра']);
    const main = h.listeners[h.listeners.length - 1];
    expect(main.o.continuous).toBe(true);
    expect(main.stopped).toBe(false);
    h.l!.stop();
    await h.flush();
    expect(h.events[h.events.length - 1]).toBe('END');
  });
  it('without an enrolled voice nothing listens', () => {
    const h = harness();
    h.setTemplate(null);
    const g = h.guard({ onFinal: () => undefined, onError: m => h.events.push('ERR ' + m), onEnd: () => h.events.push('END') });
    expect(g).toBeNull();
    expect(h.events[h.events.length - 1]).toBe('END');
  });
});
