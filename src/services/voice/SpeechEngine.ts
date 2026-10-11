// Голос: распознавание речи. Web Speech API там, где он работает (Chrome, Edge, Android Chrome),
// иначе — запись с микрофона и облачное распознавание (Whisper-совместимый API: Groq бесплатно, OpenAI).
// В окне приложения на Windows (WebView2) и в Android WebView встроенное распознавание обычно недоступно,
// поэтому при ошибке «network»/«not-allowed» переключаемся на облако, если оно настроено.

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

export function getCloudStt(s: KV | null = storage()): CloudSttConfig | null {
  try {
    const raw = s?.getItem(CFG_KEY);
    const cfg = raw ? JSON.parse(raw) : null;
    return cfg && cfg.baseUrl && cfg.apiKey ? { baseUrl: String(cfg.baseUrl), apiKey: String(cfg.apiKey), model: String(cfg.model || 'whisper-1') } : null;
  } catch { return null; }
}
export function setCloudStt(cfg: CloudSttConfig | null, s: KV | null = storage()): void {
  if (!s) return;
  if (!cfg) { s.removeItem?.(CFG_KEY); return; }
  s.setItem(CFG_KEY, JSON.stringify({ baseUrl: cfg.baseUrl.trim().replace(/\/+$/, ''), apiKey: cfg.apiKey.trim(), model: cfg.model.trim() }));
}

function webRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
function recorderAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof (globalThis as any).MediaRecorder !== 'undefined';
}

export type SttMode = 'web' | 'cloud' | 'none';
export function sttSupport(): { web: boolean; cloud: boolean; recorder: boolean; mode: SttMode } {
  const webBroken = storage()?.getItem(WEB_BROKEN_KEY) === '1';
  const web = !!webRecognitionCtor() && !webBroken;
  const recorder = recorderAvailable();
  const cloud = recorder && !!getCloudStt();
  return { web, cloud, recorder, mode: web ? 'web' : cloud ? 'cloud' : 'none' };
}
export function resetWebStt(): void { storage()?.removeItem?.(WEB_BROKEN_KEY); }

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: any }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

/** Отправляет запись в Whisper-совместимый API и возвращает текст. */
export async function transcribe(audio: Blob, cfg: CloudSttConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  const form = new FormData();
  const ext = /mp4|m4a|aac/.test(audio.type) ? 'm4a' : /ogg/.test(audio.type) ? 'ogg' : 'webm';
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

export interface ListenOptions {
  continuous?: boolean;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
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
          if (blob.size < 2000) { opts.onError?.('Не расслышала. Скажите ещё раз.'); return; }
          opts.onPartial?.('Распознаю…');
          const text = await transcribe(blob, cfg);
          if (text) opts.onFinal(text); else opts.onError?.('Не расслышала. Скажите ещё раз.');
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
      opts.onError?.(/denied|allowed|permission/i.test(String(e?.message ?? e?.name)) ? 'Нет доступа к микрофону. Разрешите микрофон в настройках.' : 'Микрофон недоступен.');
      opts.onEnd?.();
    }
  })();

  return { mode: 'cloud', stop: () => { stopped = true; finish(); } };
}

/** Начать слушать. В облачном режиме запись останавливается сама после паузы. */
export function listen(opts: ListenOptions): Listener | null {
  const s = sttSupport();
  if (s.web) return listenWeb(opts);
  const cfg = getCloudStt();
  if (s.recorder && cfg) return listenCloud({ ...opts, continuous: false }, cfg);
  opts.onError?.(s.recorder
    ? 'Встроенное распознавание речи здесь недоступно. Откройте настройки голоса и подключите бесплатный Groq — это 1 минута.'
    : 'Микрофон недоступен в этом окне.');
  return null;
}
