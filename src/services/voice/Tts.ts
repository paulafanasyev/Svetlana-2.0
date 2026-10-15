// Голос: озвучка ответов. Делит текст на фразы, выбирает русский женский голос, чистит эмодзи и ссылки.
// В приложении для Android говорит синтез речи самого телефона (в Android WebView speechSynthesis нет).
import { chunkForSpeech, pickRussianVoice, speakable } from './VoiceText';
import { isAndroidApp } from '../../platform';
import { androidSpeak, androidStopSpeaking } from '../AndroidBridge';

const MUTE_KEY = 'svetlana_tts_muted';
/** После конца озвучки на телефоне ещё немного считаем, что она говорит: микрофон не ловит хвост своей речи. */
const TAIL_MS = 500;
let androidActive = 0;
let androidQuietAt = 0;

export function ttsAvailable(): boolean {
  if (isAndroidApp()) return true;
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}
export function isMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
export function setMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* privacy mode */ }
  if (muted) stopSpeaking();
}
export function stopSpeaking(): void {
  if (isAndroidApp()) { void androidStopSpeaking().catch(() => undefined); return; }
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

/** Говорит ли Светлана сейчас (чтобы не слушать саму себя) — на всех платформах. */
export function speakingNow(): boolean {
  if (isAndroidApp()) return androidActive > 0 || Date.now() < androidQuietAt;
  return typeof window !== 'undefined' && !!window.speechSynthesis?.speaking;
}

export function speakText(text: string, opts: { voice?: SpeechSynthesisVoice; onStart?: () => void; onEnd?: () => void; force?: boolean } = {}): void {
  if (!ttsAvailable() || (isMuted() && !opts.force)) { opts.onEnd?.(); return; }
  if (isAndroidApp()) {
    const clean = speakable(text).trim();
    if (!clean) { opts.onEnd?.(); return; }
    androidActive++;
    opts.onStart?.();
    void androidSpeak(clean).catch(() => undefined).finally(() => {
      androidActive = Math.max(0, androidActive - 1);
      androidQuietAt = Date.now() + TAIL_MS;
      opts.onEnd?.();
    });
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const chunks = chunkForSpeech(speakable(text));
  if (!chunks.length) { opts.onEnd?.(); return; }
  const voice = opts.voice ?? pickRussianVoice(synth.getVoices());
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = 'ru-RU';
    u.rate = 1;
    u.pitch = 1.1;
    if (voice) u.voice = voice;
    if (i === 0) u.onstart = () => opts.onStart?.();
    if (i === chunks.length - 1) u.onend = () => opts.onEnd?.();
    u.onerror = () => opts.onEnd?.();
    synth.speak(u);
  });
}
