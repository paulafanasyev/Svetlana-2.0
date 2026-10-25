import { describe, expect, it } from 'vitest';
import { pickRussianVoice } from '../VoiceText';

describe('pickRussianVoice', () => {
  it('prefers an installed natural/neural Russian female voice over a generic system voice', () => {
    const generic = { name: 'Google русский', lang: 'ru-RU' };
    const neural = { name: 'ru-RU-SvetlanaNeural', lang: 'ru-RU' };
    expect(pickRussianVoice([generic, neural])).toBe(neural);
  });

  it('never selects a non-Russian voice when a Russian voice is available', () => {
    const english = { name: 'Microsoft Aria Online (Natural)', lang: 'en-US' };
    const russian = { name: 'Google русский', lang: 'ru-RU' };
    expect(pickRussianVoice([english, russian])).toBe(russian);
  });

  it('falls back to any available Russian voice if no preferred name exists', () => {
    const fallback = { name: 'System Russian', lang: 'ru-RU' };
    expect(pickRussianVoice([fallback])).toBe(fallback);
  });

  it('returns undefined when the device has no Russian voice', () => {
    expect(pickRussianVoice([{ name: 'Microsoft Aria', lang: 'en-US' }])).toBeUndefined();
  });
});
