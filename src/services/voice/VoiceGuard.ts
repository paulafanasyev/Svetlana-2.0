// Голосовые команды принимаются только от владельца: параллельно с распознаванием речи
// пишем звук с микрофона и сверяем каждую фразу с отпечатком голоса (VoicePrint).
// Без записанного голоса голосовое управление выключено.
import { listen, type ListenOptions, type Listener } from './SpeechEngine';
import { computeVoicePrint, loadTemplate, verifyPrint, type VerifyResult, type VoicePrint } from './VoicePrint';

export interface PcmCapture { take(seconds: number): { pcm: Float32Array; sampleRate: number }; stop(): void }

/** Запись PCM с микрофона в кольцевой буфер (последние 10 секунд). */
export async function startCapture(): Promise<PcmCapture> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('Нет доступа к микрофону');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const Ctx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
  if (!Ctx) { stream.getTracks().forEach(t => t.stop()); throw new Error('Браузер не умеет обрабатывать звук'); }
  const ctx: AudioContext = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const max = ctx.sampleRate * 10;
  let chunks: Float32Array[] = [];
  let total = 0;
  proc.onaudioprocess = e => {
    const c = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(c); total += c.length;
    while (total - chunks[0].length > max) total -= chunks.shift()!.length;
  };
  src.connect(proc); proc.connect(ctx.destination);
  return {
    take(seconds) {
      const want = Math.min(total, Math.round(seconds * ctx.sampleRate));
      const out = new Float32Array(want);
      let pos = want;
      for (let i = chunks.length - 1; i >= 0 && pos > 0; i--) {
        const c = chunks[i]; const n = Math.min(c.length, pos);
        out.set(c.subarray(c.length - n), pos - n); pos -= n;
      }
      chunks = []; total = 0; // следующая фраза проверяется по своему звуку
      return { pcm: out, sampleRate: ctx.sampleRate };
    },
    stop() {
      try { proc.disconnect(); src.disconnect(); } catch { /* уже отключено */ }
      stream.getTracks().forEach(t => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}

/** Записать фразу заданной длины (для записи голоса владельца и проверки). */
export async function recordPrint(seconds = 4): Promise<VoicePrint | null> {
  const cap = await startCapture();
  try {
    await new Promise(r => setTimeout(r, seconds * 1000));
    const { pcm, sampleRate } = cap.take(seconds);
    return computeVoicePrint(pcm, sampleRate);
  } finally { cap.stop(); }
}

export function voiceEnrolled(): boolean { return !!loadTemplate(); }

export const NOT_ENROLLED = 'Голосовые команды выполняются только по вашему голосу. Запишите голос: кнопка «Голос» → настройки (шестерёнка) → «Записать мой голос».';

/**
 * Как listen(), но onFinal вызывается только если фразу сказал владелец.
 * Чужой голос, тишина в микрофоне (подставленный текст) или отсутствие доступа к звуку — фраза отбрасывается.
 * В режиме «без рук» (continuous) чужие фразы игнорируются молча, иначе — сообщение об отказе.
 */
export function listenVerified(opts: ListenOptions, onVerify?: (r: VerifyResult) => void): Listener | null {
  const tpl = loadTemplate();
  if (!tpl) { opts.onError?.(NOT_ENROLLED); opts.onEnd?.(); return null; }
  let cap: PcmCapture | null = null;
  let ended = false;
  const capReady = startCapture()
    .then(c => { if (ended) { c.stop(); return null; } cap = c; return c; })
    .catch(() => null);
  const reject = (msg: string) => { if (!opts.continuous) opts.onError?.(msg); };
  const inner = listen({
    ...opts,
    onFinal: text => {
      void (async () => {
        const c = cap ?? (await capReady);
        if (!c) { reject('Нет доступа к микрофону для проверки голоса. Команда не выполнена.'); return; }
        const { pcm, sampleRate } = c.take(8);
        const r = verifyPrint(computeVoicePrint(pcm, sampleRate), tpl);
        onVerify?.(r);
        if (!r.ok) { reject(r.reason ?? 'Голос не узнан.'); return; }
        opts.onFinal(text);
      })();
    },
    onEnd: () => { ended = true; cap?.stop(); cap = null; opts.onEnd?.(); },
  });
  if (!inner) { ended = true; void capReady.then(c => c?.stop()); }
  return inner;
}
