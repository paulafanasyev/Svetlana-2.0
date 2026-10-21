// Распознавание речи на самом устройстве (приложения для Windows и Android): модель GigaAM-v3 в нативной части
// (Windows: src-tauri/src/local_stt.rs, Android: LocalStt.kt). Используется для проверки голоса цифрами и
// для команд на телефоне: текст распознаётся из той же записи, по которой сверяется голос, и запись никуда
// не отправляется. Модель скачивается только после подтверждения в нативном окне и проверяется по SHA-256;
// загрузку можно остановить (local_stt_cancel). На сайте модели нет.
import { isAndroidApp, isWindowsApp } from '../../platform';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface LocalSttStatus {
  installed: boolean;
  downloading: boolean;
  downloaded: number;
  total: number;
  error: string | null;
  sizeMb: number;
}

const nativeApp = (): boolean => isWindowsApp() || isAndroidApp();

function invoker(): Invoke | null {
  const inv = (globalThis as any).__TAURI_INTERNALS__?.invoke;
  return typeof inv === 'function' && nativeApp() ? (inv as Invoke) : null;
}

function need(): Invoke {
  const inv = invoker();
  if (!inv) throw new Error('Распознавание на устройстве есть только в приложениях для Windows и Android');
  return inv;
}

let ready = false;

/** Установлена ли модель (по последней проверке состояния). */
export function localSttReady(): boolean { return ready && nativeApp(); }

/** Есть ли возможность распознавать на устройстве (запущено приложение для Windows или Android). */
export function localSttAvailable(): boolean { return invoker() !== null; }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export async function localSttStatus(): Promise<LocalSttStatus | null> {
  const inv = invoker();
  if (!inv) { ready = false; return null; }
  const s = (await inv('local_stt_status')) as Record<string, unknown> | null;
  const status: LocalSttStatus = {
    installed: s?.installed === true,
    downloading: s?.downloading === true,
    downloaded: num(s?.downloaded),
    total: num(s?.total),
    error: typeof s?.error === 'string' ? s.error.slice(0, 300) : null,
    sizeMb: num(s?.sizeMb) || 225,
  };
  ready = status.installed;
  return status;
}

/** Скачать модель. Приложение спросит подтверждение в своём окне. */
export async function localSttInstall(): Promise<void> {
  try { await need()('local_stt_install'); } finally { await localSttStatus().catch(() => null); }
}

/** Остановить идущую загрузку модели. true — загрузка шла и останавливается. */
export async function localSttCancelInstall(): Promise<boolean> {
  try { return (await need()('local_stt_cancel')) === true; } finally { await localSttStatus().catch(() => null); }
}

/** Удалить модель (тоже с подтверждением в окне приложения). */
export async function localSttRemove(): Promise<void> {
  try { await need()('local_stt_remove'); } finally { await localSttStatus().catch(() => null); }
}

/** Запасной путь для очень высокой частоты записи: уменьшить до 16 кГц, чтобы запись прошла через мост. */
export function to16k(pcm: Float32Array, sampleRate: number): { pcm: Float32Array; sampleRate: number } {
  const rate = Math.round(sampleRate);
  if (!(rate > 16000)) return { pcm, sampleRate: rate };
  const ratio = rate / 16000;
  const n = Math.floor(pcm.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(pcm.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let s = 0;
    for (let j = a; j < b; j++) s += pcm[j];
    out[i] = s / (b - a);
  }
  return { pcm: out, sampleRate: 16000 };
}

/** PCM (-1..1) → 16 бит little-endian в base64: так запись идёт в нативную часть Android. */
export function pcm16Base64(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const v = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i] || 0));
    v.setInt16(i * 2, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(s);
}

/** Как в нативной части (LocalStt.kt): не длиннее 15 секунд. */
export const MAX_SECONDS = 15;
/** Частота, до которой запись уходит как есть (ресемплинг делает нативная часть, как в Windows); 15 с при 48 кГц — около 2 МБ. */
const MAX_DIRECT_RATE = 48_000;

/** Распознать запись (моно, -1..1). */
export async function localTranscribe(pcm: Float32Array, sampleRate: number): Promise<string> {
  const inv = need();
  let text: unknown;
  if (isAndroidApp()) {
    const rate = Math.round(sampleRate);
    const r = rate > MAX_DIRECT_RATE ? to16k(pcm, rate) : { pcm, sampleRate: rate };
    const max = r.sampleRate * MAX_SECONDS;
    const clip = r.pcm.length > max ? r.pcm.subarray(r.pcm.length - max) : r.pcm;
    text = await inv('local_stt_transcribe', { pcm16: pcm16Base64(clip), sampleRate: r.sampleRate });
  } else {
    text = await inv('local_stt_transcribe', { pcm: Array.from(pcm), sampleRate: Math.round(sampleRate) });
  }
  return typeof text === 'string' ? text.slice(0, 500) : '';
}

if (typeof window !== 'undefined') void localSttStatus().catch(() => { ready = false; });
