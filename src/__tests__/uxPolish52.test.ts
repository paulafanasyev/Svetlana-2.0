// Пачка 52: голосовые ошибки по-русски, кнопки не меньше 44 px, «занято» на кнопках, статус ИИ для диктора.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { explainVoiceError } from '../services/AiErrors';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('ux polish 52', () => {
  it('voice errors are plain Russian without raw server text', () => {
    const key = explainVoiceError('HTTP 401: {"error":"invalid_api_key"}');
    expect(key).toMatch(/ключ/);
    expect(key).not.toContain('invalid');
    expect(explainVoiceError('HTTP 403: Permission denied')).toMatch(/ключ/);
    expect(explainVoiceError('not-allowed')).toMatch(/микрофон/i);
    expect(explainVoiceError('no-speech')).toMatch(/услышала/);
    expect(explainVoiceError('TypeError: Failed to fetch')).toMatch(/интернет/);
    expect(explainVoiceError('Something weird happened')).not.toContain('weird');
    expect(explainVoiceError('Не расслышала цифры (SocketTimeoutException)')).toBe('Не расслышала цифры');
    expect(explainVoiceError('')).toMatch(/Попробуйте/);
  });

  it('voice UI maps errors before showing them', () => {
    expect(read('components/Avatar.tsx')).toContain('setError(explainVoiceError(m))');
    expect(read('components/VoiceButton.tsx')).toContain('error: explainVoiceError(m)');
  });

  it('touch targets are at least 44 px', () => {
    expect(read('components/Avatar.tsx')).not.toContain('w-8 h-8 rounded-full flex');
    expect(read('components/Avatar.tsx')).toContain('w-11 h-11 rounded-full flex');
  });
});
