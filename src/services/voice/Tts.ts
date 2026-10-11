// Голос: озвучка ответов. Делит текст на фразы, выбирает русский женский голос, чистит эмодзи и ссылки.
import { chunkForSpeech, pickRussianVoice, speakable } from './VoiceText';

const MUTE_KEY = 'svetlana_tts_muted';

export function ttsAvailable(): boolean {
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
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

export function speakText(text: string, opts: { voice?: SpeechSynthesisVoice; onStart?: () => void; onEnd?: () => void; force?: boolean } = {}): void {
  if (!ttsAvailable() || (isMuted() && !opts.force)) { opts.onEnd?.(); return; }
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
