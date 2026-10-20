// Облачное распознавание не должно вешать кнопку микрофона: зависший запрос обрывается, ошибки — понятным текстом.
import { describe, it, expect } from 'vitest';
import { transcribe, STT_TIMEOUT_TEXT, type FetchLike } from '../services/voice/SpeechEngine';

const cfg = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_test', model: 'whisper-large-v3-turbo' };
const audio = () => new Blob([new Uint8Array(3000)], { type: 'audio/webm' });

describe('cloud speech recognition', () => {
  it('gives up on a hanging request instead of waiting forever', async () => {
    let aborted = false;
    const hang: FetchLike = (_url, init) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    });
    await expect(transcribe(audio(), cfg, hang, 30)).rejects.toThrow(STT_TIMEOUT_TEXT);
    expect(aborted).toBe(true);
  });

  it('explains a network failure without raw browser text', async () => {
    const offline: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(transcribe(audio(), cfg, offline, 1000)).rejects.toThrow(/Нет связи/);
  });

  it('returns the recognised text', async () => {
    const ok: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ text: ' привет ' }), text: async () => '' });
    expect(await transcribe(audio(), cfg, ok, 1000)).toBe('привет');
  });

  it('says the key was rejected on 401', async () => {
    const denied: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    await expect(transcribe(audio(), cfg, denied, 1000)).rejects.toThrow(/отклонил ключ/);
  });
});
