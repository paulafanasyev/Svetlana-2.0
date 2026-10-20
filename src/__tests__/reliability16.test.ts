// Пачка 16, надёжность: визит не записывает доход дважды и откатывается целиком; после «стоп» в режиме
// «без рук» запоздавшая фраза не выполняется; память сообщает, что перестала сохраняться, и освобождает место.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BookingStore } from '../services/biz/Booking';
import { BizStore } from '../services/biz/BizStore';
import { completeAppointment, createBookingTools, BOOKING_ALREADY_DONE } from '../services/biz/BookingTools';
import { createVoiceGuard, type GuardDeps } from '../services/voice/VoiceGuard';
import { makeChallenge, templateId, VoiceLockout, VoiceTrust } from '../services/voice/Liveness';
import type { ListenOptions } from '../services/voice/SpeechEngine';
import type { VoiceTemplate } from '../services/voice/VoicePrint';
import { Memory, MEMORY_SAVE_FAILED } from '../services/Memory';

function kv(fail = { on: false }, limit = { max: Infinity }) {
  const m = new Map<string, string>();
  return {
    data: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { if (fail.on || v.length > limit.max) throw new Error('quota'); m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

// Пятница, 9 октября 2026, 09:00
const NOW = new Date(2026, 9, 9, 9, 0).getTime();
const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();

function booking(fail = { on: false }) {
  const s = new BookingStore(kv(fail), () => NOW);
  s.addService({ name: 'Стрижка', durationMin: 60, price: 1500 });
  return s;
}

describe('визит: доход записывается один раз', () => {
  it('a second completion does not add the income again', async () => {
    const s = booking();
    const biz = new BizStore(kv(), () => NOW);
    const a = s.book({ clientName: 'Иванов', start: at(9, 15), serviceName: 'Стрижка' });
    expect(completeAppointment(a, undefined, s, biz).income).toBe(1500);
    expect(() => completeAppointment(a, undefined, s, biz)).toThrow(BOOKING_ALREADY_DONE);
    const tool = createBookingTools(s, () => undefined, biz).find(t => t.id === 'biz_complete_booking')!;
    const again = await tool.execute({ id: a.id });
    expect(again.success).toBe(false);
    expect(biz.listEntries({ kind: 'income' })).toHaveLength(1);
  });

  it('the income is removed when the visit mark cannot be saved', () => {
    const fail = { on: false };
    const s = booking(fail);
    const biz = new BizStore(kv(), () => NOW);
    const a = s.book({ clientName: 'Петров', start: at(9, 16), serviceName: 'Стрижка' });
    fail.on = true;
    expect(() => completeAppointment(a, undefined, s, biz)).toThrow();
    expect(biz.listEntries({ kind: 'income' })).toHaveLength(0);
    expect(s.getAppointment(a.id)?.status).toBe('booked');
  });

  it('the booking page uses the same single-income path', () => {
    const page = readFileSync(resolve(__dirname, '../pages/BookingPage.tsx'), 'utf8');
    expect(page).toContain('completeAppointment(a, undefined)');
    expect(page).not.toContain('bizStore.addEntry(');
  });
});

const TPL: VoiceTemplate = { version: 1, mean: [0], sd: [1], distThreshold: 1.5, samples: 5, createdAt: 1 };

function guard(continuous: boolean) {
  const listeners: ListenOptions[] = [];
  const events: string[] = [];
  const store = new Map<string, string>();
  const trust = new VoiceTrust(120_000, 600_000, () => 0);
  trust.start(templateId(TPL)); // доверенная сессия: цифры не спрашиваются, голос проверяется
  const deps: GuardDeps = {
    listen: o => { listeners.push(o); return { mode: 'web', stop: () => undefined }; },
    startCapture: async () => ({ take: () => ({ pcm: new Float32Array([0.2]), sampleRate: 16000 }), stop: () => undefined }),
    speak: (_t, onEnd) => onEnd(),
    stopSpeaking: () => undefined,
    loadTemplate: () => TPL,
    computePrint: pcm => ({ v: [pcm[0]], frames: 50 }),
    verify: () => ({ ok: true, score: 0 }),
    generate: () => makeChallenge([7, 4, 2]),
    cloudTranscribe: () => null,
    localTranscribe: () => null,
    trust,
    lockout: new VoiceLockout({ getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } }, () => 1_000_000),
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
  const l = createVoiceGuard(deps)({ continuous, onFinal: t => events.push('RUN ' + t), onError: m => events.push('ERR ' + m), onEnd: () => events.push('END') });
  return { l: l!, listeners, events };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('голос: после «стоп» команды не выполняются', () => {
  it('hands-free: a phrase delivered after stop is ignored', async () => {
    const g = guard(true);
    g.l.stop();
    g.listeners[0].onFinal('светлана, удали клиента');
    await flush();
    expect(g.events.some(e => e.startsWith('RUN'))).toBe(false);
  });

  it('hands-free: a phrase still being checked when stop is pressed is dropped', async () => {
    const g = guard(true);
    g.listeners[0].onFinal('светлана, удали клиента');
    g.l.stop();
    await flush();
    expect(g.events.some(e => e.startsWith('RUN'))).toBe(false);
  });

  it('hands-free without stop still runs the command', async () => {
    const g = guard(true);
    g.listeners[0].onFinal('светлана, что у меня завтра');
    await flush();
    expect(g.events).toContain('RUN светлана, что у меня завтра');
  });

  it('push-to-talk: the phrase said before releasing the button still runs', async () => {
    const g = guard(false);
    g.listeners[0].onFinal('что у меня завтра');
    g.l.stop();
    await flush();
    expect(g.events).toContain('RUN что у меня завтра');
  });

  it('speech engine drops late results after stop in hands-free mode', () => {
    const src = readFileSync(resolve(__dirname, '../services/voice/SpeechEngine.ts'), 'utf8');
    expect(src).toContain('if (stopped && opts.continuous) return;');
    expect(src).toContain('if (ended || (continuous && stopped)) return;');
  });
});

describe('память: сбой сохранения не молчит', () => {
  it('reports once that memory is not saved and recovers', () => {
    const fail = { on: true };
    const store = kv(fail);
    const mem = new Memory(() => store);
    const msgs: string[] = [];
    mem.onSaveError(m => msgs.push(m));
    mem.addMessage('user', 'привет');
    mem.addMessage('user', 'ещё раз');
    expect(mem.isPersisted()).toBe(false);
    expect(mem.getStats().saveFailed).toBe(true);
    expect(msgs).toEqual([MEMORY_SAVE_FAILED]);
    fail.on = false;
    mem.addMessage('user', 'снова');
    expect(mem.isPersisted()).toBe(true);
    expect(mem.getStats().saveFailed).toBe(false);
  });

  it('frees space and retries when the save does not fit', () => {
    const limit = { max: Infinity };
    const store = kv({ on: false }, limit);
    const mem = new Memory(() => store);
    for (let i = 0; i < 200; i++) mem.addToLongTerm({ type: 'conversation', content: `разговор номер ${i} `.repeat(5), importance: 0.1 });
    const full = store.data.get('svetlana_memory')!.length;
    limit.max = Math.floor(full * 0.7);
    mem.addToLongTerm({ type: 'fact', content: 'важный факт', importance: 0.9 });
    expect(mem.isPersisted()).toBe(true);
    expect(mem.getStats().longTermCount).toBeLessThan(201);
    expect(mem.getAllLongTerm().some(i => i.content === 'важный факт')).toBe(true);
  });
});
