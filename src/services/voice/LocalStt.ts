// Распознавание речи на самом компьютере (только приложение для Windows): модель GigaAM-v3, работает в нативной
// части (src-tauri/src/local_stt.rs). Используется для проверки голоса цифрами: текст распознаётся из той же
// записи, по которой сверяется голос, и запись никуда не отправляется. Модель скачивается только после
// подтверждения в нативном окне Windows и проверяется по SHA-256. В Android этой модели нет (там своё
// распознавание телефона), поэтому там всё это выключено.
import { isWindowsApp } from '../../platform';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface LocalSttStatus {
  installed: boolean;
  downloading: boolean;
  downloaded: number;
  total: number;
  error: string | null;
  sizeMb: number;
}

function invoker(): Invoke | null {
  const inv = (globalThis as any).__TAURI_INTERNALS__?.invoke;
  return typeof inv === 'function' && isWindowsApp() ? (inv as Invoke) : null;
}

function need(): Invoke {
  const inv = invoker();
  if (!inv) throw new Error('Распознавание на компьютере доступно только в приложении для Windows');
  return inv;
}

let ready = false;

/** Установлена ли модель (по последней проверке состояния). */
export function localSttReady(): boolean { return ready && isWindowsApp(); }

/** Есть ли вообще возможность распознавать на компьютере (запущено приложение для Windows). */
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

/** Скачать модель. Windows спросит подтверждение в своём окне. */
export async function localSttInstall(): Promise<void> {
  try { await need()('local_stt_install'); } finally { await localSttStatus().catch(() => null); }
}

/** Удалить модель (тоже с подтверждением в окне Windows). */
export async function localSttRemove(): Promise<void> {
  try { await need()('local_stt_remove'); } finally { await localSttStatus().catch(() => null); }
}

/** Распознать запись (моно, -1..1). */
export async function localTranscribe(pcm: Float32Array, sampleRate: number): Promise<string> {
  const text = await need()('local_stt_transcribe', { pcm: Array.from(pcm), sampleRate: Math.round(sampleRate) });
  return typeof text === 'string' ? text.slice(0, 500) : '';
}

if (typeof window !== 'undefined') void localSttStatus().catch(() => { ready = false; });
