// Голос: распознавание речи. Web Speech API там, где он работает (Chrome, Edge, Android Chrome),
// иначе — запись с микрофона и облачное распознавание (Whisper-совместимый API: Groq бесплатно, OpenAI).
// В окне приложения на Windows (WebView2) встроенное распознавание обычно недоступно, поэтому при
// ошибке «network»/«not-allowed» переключаемся на облако, если оно настроено. В приложении для Android слушает
// распознавание речи самого телефона (режим «native»), а с записанным голосом — запись с микрофона,
// которую распознаёт GigaAM на самом телефоне или облако (listenRecorded): тогда голос проверяется как на компьютере,
// причём по той же записи, из которой распознан текст (onAudio).

import { getSecret, setSecret } from '../security/SecretStore';
import { isAndroidApp } from '../../platform';
import { androidListen, androidStopListening } from '../AndroidBridge';
import { localSttReady, localTranscribe } from './LocalStt';

export interface CloudSttConfig { baseUrl: string; apiKey: string; model: string }

export const STT_PRESETS: { id: string; title: string; baseUrl: string; model: string; keyUrl: string }[] = [
  { id: 'groq', title: 'Groq (бесплатно)', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openai', title: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', keyUrl: 'https://platform.openai.com/api-keys' },
];

const CFG_KEY = 'svetlana_stt_v1';
const WEB_BROKEN_KEY = 'svetlana_stt_web_broken';

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }
function storage(): KV | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

// Ключ сервиса распознавания хранится зашифрованным (SecretStore); здесь — только адрес и модель.
// Адрес — строго один из STT_PRESETS: подменить сервер и увести на него ключ и записи голоса нельзя.
const STT_SECRET = 'stt.apikey';
let sttKey: string | null = null;
let sttKeyLoaded = false;
const ALLOWED_STT = new Set(STT_PRESETS.map(p => p.baseUrl));

/** Загрузить ключ из зашифрованного хранилища (вызывается при старте; переносит старый открытый ключ). */
export async function loadCloudSttKey(s: KV | null = storage()): Promise<void> {
  try {
    const raw = s?.getItem(CFG_KEY);
    const cfg = raw ? JSON.parse(raw) : null;
    if (cfg && typeof cfg.apiKey === 'string' && cfg.apiKey) {
      // миграция: ключ лежал открытым текстом
      await setSecret(STT_SECRET, cfg.apiKey);
      s?.setItem(CFG_KEY, JSON.stringify({ baseUrl: cfg.baseUrl, model: cfg.model }));
    }
    sttKey = await getSecret(STT_SECRET);
  } catch { sttKey = null; }
  sttKeyLoaded = true;
}
if (typeof window !== 'undefined') void loadCloudSttKey();

export function getCloudStt(s: KV | null = storage()): CloudSttConfig | null {
  try {
    const raw = s?.getItem(CFG_KEY);
    const cfg = raw ? JSON.parse(raw) : null;
    const baseUrl = String(cfg?.baseUrl ?? '');
    const apiKey = sttKey ?? (typeof cfg?.apiKey === 'string' && !sttKeyLoaded ? cfg.apiKey : '');
    if (!ALLOWED_STT.has(baseUrl) || !apiKey) return null;
    return { baseUrl, apiKey, model: String(cfg.model || 'whisper-1').slice(0, 60) };
  } catch { return null; }
}
export function setCloudStt(cfg: CloudSttConfig | null, s: KV | null = storage()): void {
  if (!s) return;
  if (!cfg) { s.removeItem?.(CFG_KEY); sttKey = null; void setSecret(STT_SECRET, null); return; }
  const baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
  if (!ALLOWED_STT.has(baseUrl)) throw new Error('Неизвестный сервис распознавания: разрешены только Groq и OpenAI');
  s.setItem(CFG_KEY, JSON.stringify({ baseUrl, model: cfg.model.trim() }));
  sttKey = cfg.apiKey.trim();
  void setSecret(STT_SECRET, sttKey);
}

function webRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
function recorderAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof (globalThis as any).MediaRecorder !== 'undefined';
}

export type SttMode = 'web' | 'cloud' | 'native' | 'local' | 'none';
export function sttSupport(): { web: boolean; cloud: boolean; recorder: boolean; mode: SttMode } {
  const recorder = recorderAvailable();
  const cloud = recorder && !!getCloudStt();
  // В приложении для Android всегда есть распознавание самого телефона.
  if (isAndroidApp()) return { web: false, cloud, recorder, mode: 'native' };
  const webBroken = storage()?.getItem(WEB_BROKEN_KEY) === '1';
  const web = !!webRecognitionCtor() && !webBroken;
  return { web, cloud, recorder, mode: web ? 'web' : cloud ? 'cloud' : 'none' };
}
export function resetWebStt(): void { storage()?.removeItem?.(WEB_BROKEN_KEY); }

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: any }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

/** Отправляет запись в Whisper-совместимый API и возвращает текст. */
export async function transcribe(audio: Blob, cfg: CloudSttConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  const form = new FormData();
  const ext = /wav/.test(audio.type) ? 'wav' : /mp4|m4a|aac/.test(audio.type) ? 'm4a' : /ogg/.test(audio.type) ? 'ogg' : 'webm';
  form.append('file', audio, `voice.${ext}`);
  form.append('model', cfg.model);
  form.append('language', 'ru');
  form.append('response_format', 'json');
  const res = await fetchImpl(`${cfg.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form });
  if (res.status === 401 || res.status === 403) throw new Error('Сервис распознавания отклонил ключ. Проверьте ключ в настройках голоса.');
  if (!res.ok) throw new Error(`Сервис распознавания недоступен (код ${res.status})`);
  const json = await res.json();
  return String(json?.text ?? '').trim();
}

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

export type PcmRecognizer = (pcm: Float32Array, sampleRate: number) => Promise<string>;

/**
 * Распознавание нашей же записи: на устройстве (GigaAM, звук никуда не уходит), иначе облако (Groq/OpenAI).
 * null — ни модели, ни ключа.
 */
export function recordedRecognizer(): { mode: 'local' | 'cloud'; recognize: PcmRecognizer } | null {
  if (localSttReady()) return { mode: 'local', recognize: localTranscribe };
  const cfg = getCloudStt();
  if (cfg) return { mode: 'cloud', recognize: (pcm, sr) => transcribe(pcmToWav(pcm, sr), cfg) };
  return null;
}

export interface ListenOptions {
  continuous?: boolean;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  /** Только listenRecorded: звук фразы, из которого распознан текст. Вызывается сразу перед onFinal. */
  onAudio?: (pcm: Float32Array, sampleRate: number) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}
export interface Listener { stop(): void; mode: SttMode }

const WEB_ERRORS: Record<string, string> = {
  'not-allowed': 'Нет доступа к микрофону. Разрешите микрофон в настройках.',
  'service-not-allowed': 'Встроенное распознавание недоступно в этом окне.',
  network: 'Встроенное распознавание недоступно (нужен интернет или другой браузер).',
  'no-speech': 'Не расслышала. Скажите ещё раз.',
  'audio-capture': 'Микрофон не найден.',
  aborted: '',
};

const NOT_HEARD = 'Не расслышала. Скажите ещё раз.';
const micError = (e: unknown): string =>
  /denied|allowed|permission/i.test(String((e as { message?: unknown; name?: unknown } | null)?.message ?? (e as { name?: unknown } | null)?.name ?? e))
    ? 'Нет доступа к микрофону. Разрешите микрофон в настройках.'
    : 'Микрофон недоступен.';

/** Распознавание речи телефона (приложение для Android). Одна фраза за раз, телефон сам ждёт паузу. */
function listenNative(opts: ListenOptions): Listener {
  let stopped = false;
  opts.onPartial?.('Слушаю…');
  void androidListen()
    .then(text => {
      if (text) opts.onFinal(text);
      else if (!stopped) opts.onError?.(NOT_HEARD);
    })
    .catch(e => {
      const m = typeof e === 'string' ? e : (e as { message?: unknown } | null)?.message;
      if (!stopped && m) opts.onError?.(String(m).slice(0, 300));
    })
    .finally(() => opts.onEnd?.());
  return { mode: 'native', stop: () => { stopped = true; void androidStopListening().catch(() => undefined); } };
}

function listenWeb(opts: ListenOptions): Listener {
  const Ctor = webRecognitionCtor();
  const rec = new Ctor();
  rec.lang = 'ru-RU';
  rec.interimResults = true;
  rec.continuous = !!opts.continuous;
  rec.maxAlternatives = 1;
  let stopped = false;
  rec.onresult = (event: any) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const t = String(r[0]?.transcript ?? '');
      if (r.isFinal) { if (t.trim()) opts.onFinal(t.trim()); } else interim += t;
    }
    if (interim) opts.onPartial?.(interim);
  };
  rec.onerror = (e: any) => {
    const code = String(e?.error ?? '');
    if ((code === 'network' || code === 'service-not-allowed') && getCloudStt()) storage()?.setItem(WEB_BROKEN_KEY, '1');
    const msg = WEB_ERRORS[code] ?? `Ошибка распознавания: ${code}`;
    if (msg) opts.onError?.(msg + (code === 'network' || code === 'service-not-allowed' ? (getCloudStt() ? ' Переключаюсь на облачное распознавание, нажмите ещё раз.' : ' Подключите облачное распознавание в настройках голоса.') : ''));
  };
  rec.onend = () => {
    if (opts.continuous && !stopped) { try { rec.start(); return; } catch { /* already started */ } }
    opts.onEnd?.();
  };
  rec.start();
  return { mode: 'web', stop: () => { stopped = true; try { rec.stop(); } catch { /* noop */ } } };
}

function listenCloud(opts: ListenOptions, cfg: CloudSttConfig): Listener {
  let stopped = false;
  let recorder: any = null;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const chunks: Blob[] = [];
  const cleanup = () => {
    if (timer) clearInterval(timer);
    stream?.getTracks().forEach(t => t.stop());
    void ctx?.close().catch(() => undefined);
  };
  const finish = () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stopped) { cleanup(); opts.onEnd?.(); return; }
      const MR = (globalThis as any).MediaRecorder;
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MR.isTypeSupported?.(t)) ?? '';
      recorder = new MR(stream, type ? { mimeType: type } : undefined);
      recorder.ondataavailable = (e: any) => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        cleanup();
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
          if (blob.size < 2000) { opts.onError?.(NOT_HEARD); return; }
          opts.onPartial?.('Распознаю…');
          const text = await transcribe(blob, cfg);
          if (text) opts.onFinal(text); else opts.onError?.(NOT_HEARD);
        } catch (e: any) { opts.onError?.(e?.message || 'Не удалось распознать'); } finally { opts.onEnd?.(); }
      };
      recorder.start();
      opts.onPartial?.('Слушаю…');
      // Автостоп: 1,5 с тишины после речи или 15 с максимум.
      const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      const started = Date.now();
      let spoke = false;
      let silentSince = 0;
      if (AC) {
        ctx = new AC() as AudioContext;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        timer = setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          const now = Date.now();
          if (peak > 12) { spoke = true; silentSince = 0; } else if (spoke && !silentSince) silentSince = now;
          if ((spoke && silentSince && now - silentSince > 1500) || now - started > 15000) finish();
        }, 100);
      } else {
        timer = setInterval(() => { if (Date.now() - started > 8000) finish(); }, 200);
      }
    } catch (e: any) {
      cleanup();
      opts.onError?.(micError(e));
      opts.onEnd?.();
    }
  })();

  return { mode: 'cloud', stop: () => { stopped = true; finish(); } };
}

/** Пороги детектора речи для listenRecorded. */
export const VAD = { threshold: 0.012, silenceMs: 900, maxPhraseMs: 12_000, noSpeechMs: 8_000, preRollMs: 300, minVoicedMs: 250 };
const MAX_PENDING = 2;

function concat(parts: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

/**
 * Слушать записью: микрофон → фразы по паузам → распознавание на устройстве или в облаке. Так слушает
 * телефон с записанным голосом: распознавание телефона занимает микрофон само и сверить голос не даёт.
 * Перед каждым onFinal отдаёт через onAudio именно тот звук, из которого распознан текст.
 * continuous — слушать, пока не остановят (режим «Светлана, …» без рук).
 */
export function listenRecorded(opts: ListenOptions, rec = recordedRecognizer()): Listener | null {
  if (!rec) {
    opts.onError?.('Для этого нужна модель распознавания на устройстве (Голос → настройки → «Скачать модель») или ключ Groq.');
    return null;
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { opts.onError?.('Микрофон недоступен в этом окне.'); return null; }
  const continuous = !!opts.continuous;
  let stopped = false;   // больше не слушаем
  let ended = false;     // onEnd отдан
  let pending = 0;       // фразы на распознавании
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let src: MediaStreamAudioSourceNode | null = null;
  let proc: ScriptProcessorNode | null = null;
  let sink: GainNode | null = null;
  let seg: Float32Array[] | null = null;
  let segLen = 0;
  let voicedMs = 0;
  let rate = 16000;
  let waitingSince = Date.now(); // с какого момента ждём речь (для одной команды)

  const release = () => {
    if (proc) proc.onaudioprocess = null;
    try { proc?.disconnect(); src?.disconnect(); sink?.disconnect(); } catch { /* уже отключено */ }
    proc = null; src = null; sink = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
  };
  const end = () => {
    if (ended) return;
    ended = true;
    release();
    opts.onEnd?.();
  };
  const maybeEnd = () => { if (stopped && pending === 0) end(); };

  const recognize = (pcm: Float32Array, sr: number) => {
    if (pending >= MAX_PENDING) return;
    pending++;
    opts.onPartial?.('Распознаю…');
    rec.recognize(pcm, sr)
      .then(t => {
        const text = String(t ?? '').trim();
        if (ended) return;
        if (text) { opts.onAudio?.(pcm, sr); opts.onFinal(text); }
        else if (!continuous) opts.onError?.(NOT_HEARD);
      }, e => {
        if (ended) return;
        const m = typeof e === 'string' ? e : (e as { message?: unknown } | null)?.message;
        opts.onError?.(String(m || 'Не удалось распознать').slice(0, 300));
      })
      .finally(() => {
        pending--;
        if (!continuous) stopped = true;
        else if (!stopped && !ended) opts.onPartial?.('Слушаю…');
        maybeEnd();
      });
  };

  /** Закончить текущую фразу: если в ней была речь — распознать, короткий шум — выбросить и ждать дальше. */
  const flush = () => {
    if (!seg) return;
    const pcm = concat(seg, segLen);
    const voiced = voicedMs;
    seg = null; segLen = 0; voicedMs = 0;
    if (voiced < VAD.minVoicedMs) { waitingSince = Date.now(); return; }
    if (!continuous) { stopped = true; release(); }
    recognize(pcm, rate);
  };

  (async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream = s;
      if (stopped) { end(); return; }
      const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      if (!AC) throw new Error('Браузер не умеет обрабатывать звук');
      const c: AudioContext = new AC();
      ctx = c;
      void c.resume?.().catch(() => undefined);
      rate = c.sampleRate;
      src = c.createMediaStreamSource(s);
      proc = c.createScriptProcessor(4096, 1, 1);
      sink = c.createGain();
      sink.gain.value = 0; // звук микрофона не идёт в динамик
      const pre: Float32Array[] = [];
      let preLen = 0;
      const preMax = rate * VAD.preRollMs / 1000;
      let silence = 0;
      waitingSince = Date.now();
      proc.onaudioprocess = e => {
        if (stopped || ended) return;
        const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
        let sum = 0;
        for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
        const loud = Math.sqrt(sum / Math.max(1, chunk.length)) > VAD.threshold;
        const ms = chunk.length / rate * 1000;
        if (!seg) {
          if (loud) {
            seg = [...pre, chunk]; segLen = preLen + chunk.length;
            pre.length = 0; preLen = 0; silence = 0; voicedMs = ms;
            return;
          }
          pre.push(chunk); preLen += chunk.length;
          while (pre.length > 1 && preLen - pre[0].length >= preMax) preLen -= pre.shift()!.length;
          // Одна команда: если речи нет 8 секунд (или был только короткий шум) — микрофон отпускаем.
          if (!continuous && Date.now() - waitingSince > VAD.noSpeechMs) {
            opts.onError?.(NOT_HEARD);
            stopped = true;
            maybeEnd();
          }
          return;
        }
        seg.push(chunk); segLen += chunk.length;
        if (loud) { silence = 0; voicedMs += ms; } else silence += ms;
        if (silence >= VAD.silenceMs || segLen / rate * 1000 >= VAD.maxPhraseMs) { silence = 0; flush(); maybeEnd(); }
      };
      src.connect(proc); proc.connect(sink); sink.connect(c.destination);
      opts.onPartial?.('Слушаю…');
    } catch (e) {
      if (!ended) opts.onError?.(micError(e));
      stopped = true;
      end();
    }
  })();

  return {
    mode: rec.mode,
    stop: () => {
      if (stopped) { maybeEnd(); return; }
      // Остановили посреди фразы (одна команда): распознаём сказанное, как в облачном режиме.
      if (!continuous) flush(); else { seg = null; segLen = 0; voicedMs = 0; }
      stopped = true;
      release();
      maybeEnd();
    },
  };
}

/** Начать слушать. В облачном и телефонном режиме запись останавливается сама после паузы. */
export function listen(opts: ListenOptions): Listener | null {
  if (isAndroidApp()) return listenNative({ ...opts, continuous: false });
  const s = sttSupport();
  if (s.web) return listenWeb(opts);
  const cfg = getCloudStt();
  if (s.recorder && cfg) return listenCloud({ ...opts, continuous: false }, cfg);
  opts.onError?.(s.recorder
    ? 'Встроенное распознавание речи здесь недоступно. Откройте настройки голоса и подключите бесплатный Groq — это 1 минута.'
    : 'Микрофон недоступен в этом окне.');
  return null;
}
