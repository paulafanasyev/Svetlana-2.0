// Голосовые команды принимаются только от владельца: параллельно с распознаванием речи
// пишем звук с микрофона и сверяем каждую фразу с отпечатком голоса (VoicePrint).
// Защита от записи: перед первой командой Светлана просит сказать 3 случайные цифры (Liveness),
// цифры и голос проверяются по одному и тому же звуку. Без записанного голоса управление выключено.
import { listen, getCloudStt, transcribe, type ListenOptions, type Listener } from './SpeechEngine';
import { computeVoicePrint, loadTemplate, verifyPrint, type VerifyResult, type VoicePrint, type VoiceTemplate } from './VoicePrint';
import { speakText, stopSpeaking } from './Tts';
import { generateChallenge, matchesChallenge, templateId, VoiceLockout, VoiceTrust, type Challenge } from './Liveness';
import { localSttReady, localTranscribe } from './LocalStt';

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
  // ScriptProcessor работает, только если подключён к выходу; глушим его, чтобы звук микрофона не шёл в колонки.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
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
      try { proc.disconnect(); src.disconnect(); sink.disconnect(); } catch { /* уже отключено */ }
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

/** PCM (-1..1) в WAV 16 бит моно: так облачное распознавание получает ровно тот звук, по которому проверен голос. */
export function pcmToWav(pcm: Float32Array, sampleRate: number): Blob {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  const rate = Math.round(sampleRate);
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

export const NO_SAME_AUDIO_STT = 'Для проверки цифрами нужна модель распознавания на компьютере (Голос → настройки → «Скачать модель») или облачное распознавание. Команда не выполнена.';

export const NOT_ENROLLED = 'Голосовые команды выполняются только по вашему голосу. Запишите голос: кнопка «Голос» → настройки (шестерёнка) → «Записать мой голос».';

export function lockedMessage(ms: number): string {
  return `Слишком много неудачных попыток. Голосовое управление на паузе ${Math.max(1, Math.ceil(ms / 60_000))} мин.`;
}

export interface VerifiedListenOptions extends ListenOptions {
  /**
   * Фильтр до проверки голоса: фразы, которые всё равно не станут командой (например, без «Светлана, …»
   * в режиме «без рук»), не проверяются и не запускают цифры.
   */
  accept?: (text: string) => boolean;
}

/** Зависимости вынесены, чтобы логику проверки можно было прогнать в тестах без микрофона. */
export interface GuardDeps {
  listen(opts: ListenOptions): Listener | null;
  startCapture(): Promise<PcmCapture>;
  speak(text: string, onEnd: () => void): void;
  stopSpeaking(): void;
  loadTemplate(): VoiceTemplate | null;
  computePrint(pcm: Float32Array, sampleRate: number): VoicePrint | null;
  verify(p: VoicePrint, t: VoiceTemplate): VerifyResult;
  generate(): Challenge;
  /**
   * Облачное распознавание записанного нами же звука (null, если не настроено). Если есть, ответ с цифрами
   * распознаётся из той же записи, по которой проверяется голос: подменить звук для одной из проверок нельзя.
   * Встроенное распознавание браузера для цифр не используется: оно слушает микрофон отдельно от нашей записи.
   */
  cloudTranscribe(): ((wav: Blob) => Promise<string>) | null;
  /**
   * Распознавание на самом компьютере (GigaAM-v3 в приложении для Windows), null, если модель не установлена.
   * Приоритетнее облака: та же запись, но звук никуда не уходит.
   */
  localTranscribe(): ((pcm: Float32Array, sampleRate: number) => Promise<string>) | null;
  trust: VoiceTrust;
  lockout: VoiceLockout;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const CHALLENGE_TIMEOUT_MS = 20_000;
const ANSWER_DELAY_MS = 350; // пауза после озвучки цифр, чтобы микрофон не поймал хвост своей речи
export const ANSWER_RECORD_MS = 4500; // окно записи ответа для распознавания на компьютере или в облаке

export function createVoiceGuard(d: GuardDeps) {
  return function listenVerified(opts: VerifiedListenOptions, onVerify?: (r: VerifyResult) => void): Listener | null {
    const tpl = d.loadTemplate();
    if (!tpl) { opts.onError?.(NOT_ENROLLED); opts.onEnd?.(); return null; }
    const locked = d.lockout.remainingMs();
    if (locked > 0) { opts.onError?.(lockedMessage(locked)); opts.onEnd?.(); return null; }
    const tplKey = templateId(tpl);

    let closed = false;       // сессия завершена, onEnd отдан
    let stopped = false;      // пользователь остановил
    let resume = false;       // в режиме «без рук» вернуться к прослушиванию после цифр
    let busy = 0;             // фразы на проверке
    let mainGen = 0;
    let inner: Listener | null = null;
    let cap: PcmCapture | null = null;
    let challenge: { cancel(): void } | null = null;

    const quiet = (msg: string) => { if (!opts.continuous) opts.onError?.(msg); };

    const finish = () => {
      if (closed) return;
      closed = true;
      challenge?.cancel(); challenge = null;
      mainGen++;
      const l = inner; inner = null; l?.stop();
      cap?.stop(); cap = null;
      opts.onEnd?.();
    };

    /** Неудача, которая считается попыткой подбора: чужой голос или не те цифры. */
    const failure = (msg: string, loud: boolean) => {
      d.trust.end();
      const lock = d.lockout.fail();
      if (lock > 0) { opts.onError?.(lockedMessage(lock)); finish(); return; }
      if (loud) opts.onError?.(msg); else quiet(msg);
    };

    const currentTemplate = (): VoiceTemplate | null => {
      const t = d.loadTemplate();
      return t && templateId(t) === tplKey ? t : null;
    };

    const settle = () => {
      if (closed || busy > 0 || challenge || inner) return;
      if (resume && !stopped) { resume = false; if (startMain()) return; }
      finish();
    };

    const pauseMain = () => {
      mainGen++;
      resume = !!opts.continuous;
      const l = inner; inner = null; l?.stop();
      cap?.stop(); cap = null;
    };

    const startMain = (): boolean => {
      const gen = ++mainGen;
      let ended = false; // распознавание уже закончилось: запоздавшую запись сразу закрываем
      const capP: Promise<PcmCapture | null> = d.startCapture()
        .then(c => { if (closed || ended || gen !== mainGen) { c.stop(); return null; } cap = c; return c; })
        .catch(() => null);
      const l = d.listen({
        continuous: opts.continuous,
        onPartial: t => { if (gen === mainGen && !challenge) opts.onPartial?.(t); },
        onError: m => { if (gen === mainGen && !challenge) opts.onError?.(m); },
        onFinal: text => { if (gen === mainGen) onPhrase(text, capP); },
        onEnd: () => {
          ended = true;
          if (gen !== mainGen) return;
          inner = null; cap?.stop(); cap = null;
          settle();
        },
      });
      if (!l) { mainGen++; void capP.then(c => c?.stop()); return false; }
      if (gen === mainGen) inner = l;
      return true;
    };

    const onPhrase = (text: string, capP: Promise<PcmCapture | null>) => {
      if (closed || challenge) return;
      if (opts.accept && !opts.accept(text)) {
        void capP.then(c => c?.take(0)); // звук отброшенной фразы не должен попасть в проверку следующей
        return;
      }
      busy++;
      void (async () => {
        try {
          const c = await capP;
          if (closed) return;
          if (!c) { quiet('Нет доступа к микрофону для проверки голоса. Команда не выполнена.'); return; }
          const { pcm, sampleRate } = c.take(8);
          const t = currentTemplate();
          if (!t) { d.trust.end(); opts.onError?.('Голос владельца изменён. Начните заново.'); finish(); return; }
          const print = d.computePrint(pcm, sampleRate);
          if (!print) { quiet('Не расслышала голос (слишком тихо или коротко). Команда не выполнена.'); return; }
          const r = d.verify(print, t);
          onVerify?.(r);
          if (!r.ok) { failure(r.reason ?? 'Голос не узнан. Команда не выполнена.', false); return; }
          if (d.trust.isValid(tplKey)) { d.trust.touch(); opts.onFinal(text); return; }
          if (closed || challenge) return;
          runChallenge(text);
        } finally { busy--; settle(); }
      })();
    };

    const runChallenge = (command: string) => {
      pauseMain();
      let generated: Challenge | null = null;
      try { generated = d.generate(); } catch { generated = null; }
      if (!generated) { opts.onError?.('Проверка цифрами недоступна на этом устройстве. Команда не выполнена.'); settle(); return; }
      const ch: Challenge = generated;
      // Цифры распознаются только из той же записи, по которой проверяется голос: на компьютере (GigaAM)
      // или в облаке. Встроенное распознавание браузера слушает микрофон отдельно, поэтому для проверки
      // не годится: без локальной модели и без облака команда не выполняется (как на Android, fail closed).
      const local = d.localTranscribe();
      const cloud = local ? null : d.cloudTranscribe();
      const recognize = local ?? (cloud ? (pcm: Float32Array, sr: number) => cloud(pcmToWav(pcm, sr)) : null);
      if (!recognize) { opts.onError?.(NO_SAME_AUDIO_STT); settle(); return; }
      let done = false;
      let started = false;
      let cap2: PcmCapture | null = null;
      const timers: unknown[] = [];
      const cleanup = () => {
        done = true;
        timers.forEach(id => d.clearTimeout(id));
        cap2?.stop(); cap2 = null;
        challenge = null;
      };
      const end = (ok: boolean, msg?: string, counts = false) => {
        if (done) return;
        cleanup();
        if (closed) return;
        if (ok) { d.lockout.reset(); d.trust.start(tplKey); opts.onFinal(command); }
        else if (counts) failure(msg!, true);
        else { d.trust.end(); if (msg) opts.onError?.(msg); }
        settle();
      };
      challenge = { cancel: () => { if (!done) { cleanup(); d.stopSpeaking(); } } };

      const evaluate = (text: string | null, pcm: Float32Array, sampleRate: number) => {
        if (done) return;
        if (!text) { end(false, 'Не расслышала цифры. Скажите команду ещё раз.'); return; }
        const t = currentTemplate();
        if (!t) { end(false, 'Голос владельца изменён. Команда не выполнена.'); return; }
        const print = d.computePrint(pcm, sampleRate);
        if (!print) { end(false, 'Не расслышала цифры (слишком тихо). Скажите команду ещё раз.'); return; }
        const r = d.verify(print, t);
        onVerify?.(r);
        if (!r.ok) { end(false, r.reason ?? 'Голос не узнан. Команда не выполнена.', true); return; }
        if (!matchesChallenge(text, ch)) { end(false, 'Цифры не совпали. Команда не выполнена.', true); return; }
        end(true);
      };

      const listenAnswer = async () => {
        if (done || started) return;
        started = true;
        let c: PcmCapture;
        try { c = await d.startCapture(); } catch { end(false, 'Нет доступа к микрофону для проверки голоса. Команда не выполнена.'); return; }
        if (done) { c.stop(); return; }
        cap2 = c;
        // Одна запись: из неё и текст, и отпечаток голоса.
        opts.onPartial?.('Слушаю цифры…');
        timers.push(d.setTimeout(() => {
          if (done || !cap2) return;
          const { pcm, sampleRate } = cap2.take(ANSWER_RECORD_MS / 1000 + 1);
          cap2.stop(); cap2 = null;
          opts.onPartial?.('Проверяю…');
          recognize(pcm, sampleRate).then(
            text => evaluate(text, pcm, sampleRate),
            () => end(false, 'Не удалось распознать цифры. Скажите команду ещё раз.'),
          );
        }, ANSWER_RECORD_MS));
      };

      timers.push(d.setTimeout(() => end(false, 'Время на ответ вышло. Скажите команду ещё раз.'), CHALLENGE_TIMEOUT_MS));
      opts.onPartial?.(`Для проверки скажите цифры: ${ch.digits.join(' ')}`);
      d.speak(`Для проверки скажите цифры: ${ch.spoken}`, () => {
        if (!done) timers.push(d.setTimeout(() => { void listenAnswer(); }, ANSWER_DELAY_MS));
      });
    };

    if (!startMain()) { closed = true; return null; }
    const mode = inner ? (inner as Listener).mode : 'web';
    return {
      mode,
      stop: () => {
        stopped = true;
        resume = false;
        challenge?.cancel();
        if (inner) inner.stop(); else settle();
      },
    };
  };
}

const sharedTrust = new VoiceTrust();
const sharedLockout = new VoiceLockout();

/** Закрыть доверенную сессию (например, после записи нового голоса). */
export function endVoiceTrust(): void { sharedTrust.end(); }

/**
 * Как listen(), но onFinal вызывается только если фразу сказал владелец, а при первой команде
 * ещё и произнёс случайные цифры. Чужой голос, тишина (подставленный текст), не те цифры или
 * отсутствие доступа к звуку: фраза отбрасывается. В режиме «без рук» чужие фразы игнорируются молча.
 */
export const listenVerified = createVoiceGuard({
  listen,
  startCapture,
  speak: (text, onEnd) => speakText(text, { force: true, onEnd }),
  stopSpeaking,
  loadTemplate: () => loadTemplate(),
  computePrint: computeVoicePrint,
  verify: (p, t) => verifyPrint(p, t),
  generate: () => generateChallenge(),
  cloudTranscribe: () => {
    const cfg = getCloudStt();
    return cfg ? (wav: Blob) => transcribe(wav, cfg) : null;
  },
  localTranscribe: () => (localSttReady() ? localTranscribe : null),
  trust: sharedTrust,
  lockout: sharedLockout,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
});
