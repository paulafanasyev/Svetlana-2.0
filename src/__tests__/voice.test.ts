// Svetlana: голосовые команды — разбор речи, озвучка, облачное распознавание
import { describe, it, expect } from 'vitest';
import { wordsToNumbers, normalizeSpoken, speakable, chunkForSpeech, hasWakeWord, pickRussianVoice } from '../services/voice/VoiceText';
import { transcribe, type FetchLike } from '../services/voice/SpeechEngine';
import { detectBizIntent } from '../services/biz/BizTools';

describe('речь → команда', () => {
  it('turns Russian number words into digits', () => {
    expect(wordsToNumbers('получил пять тысяч')).toBe('получил 5000');
    expect(wordsToNumbers('сто двадцать три тысячи четыреста пятьдесят шесть')).toBe('123456');
    expect(wordsToNumbers('полторы тысячи')).toBe('1500');
    expect(wordsToNumbers('двести пятьдесят на такси')).toBe('250 на такси');
    expect(wordsToNumbers('тысяча рублей')).toBe('1000 рублей');
    expect(wordsToNumbers('пятнадцать тридцать')).toBe('15 30');
  });

  it('strips the wake word and normalizes time and money', () => {
    expect(normalizeSpoken('Светлана, получил пять тысяч рублей от Петрова за урок')).toBe('Получил 5000 от Петрова за урок');
    expect(normalizeSpoken('светлана запиши Иванову на стрижку завтра в пятнадцать тридцать')).toBe('Запиши Иванову на стрижку завтра в 15:30');
    expect(normalizeSpoken('запиши на завтра в девять ноль ноль')).toBe('Запиши на завтра в 9:00');
    expect(normalizeSpoken('получил 5 000 рублей')).toBe('Получил 5000');
    expect(normalizeSpoken('Светофор пять')).toBe('Светофор 5');
    expect(hasWakeWord('Светлана, привет')).toBe(true);
    expect(hasWakeWord('эй Света что у меня завтра')).toBe(true);
    expect(hasWakeWord('Светофор')).toBe(false);
  });

  it('feeds normalized speech into business commands', () => {
    expect(detectBizIntent(normalizeSpoken('Светлана, получил пять тысяч от Петрова за урок'))).toEqual({
      tool: 'biz_add_income', args: { amount: 5000, client: 'Петрова', description: 'урок' },
    });
    expect(detectBizIntent(normalizeSpoken('потратил полторы тысячи на рекламу'))).toEqual({ tool: 'biz_add_expense', args: { amount: 1500, description: 'рекламу' } });
  });
});

describe('озвучка', () => {
  it('makes replies pleasant to listen to', () => {
    const s = speakable('✅ Доход 5 000 ₽ от Петрова записан.\n🧾 Чек № 3: https://lknpd.nalog.ru');
    expect(s).toBe('Доход 5 000 рублей от Петрова записан. Чек номер 3: ссылка на экране');
    expect(speakable('В 15:00 стрижка')).toBe('В 15 ноль ноль стрижка');
    expect(speakable('а. '.repeat(400), 100).endsWith('Остальное на экране.')).toBe(true);
  });

  it('splits long text into short phrases', () => {
    const parts = chunkForSpeech(`${'а'.repeat(120)}. ${'б'.repeat(120)}. в.`, 180);
    expect(parts).toHaveLength(2);
    expect(parts.every(p => p.length <= 180)).toBe(true);
  });

  it('prefers a Russian female voice', () => {
    const v = pickRussianVoice([{ lang: 'en-US', name: 'Zira' }, { lang: 'ru-RU', name: 'Microsoft Pavel' }, { lang: 'ru-RU', name: 'Microsoft Irina' }]);
    expect(v?.name).toBe('Microsoft Irina');
    expect(pickRussianVoice([{ lang: 'en-US', name: 'Zira' }])).toBeUndefined();
  });
});

describe('облачное распознавание', () => {
  it('posts audio to a Whisper-compatible API', async () => {
    const calls: { url: string; auth: string; model: unknown; lang: unknown }[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization, model: init.body.get('model'), lang: init.body.get('language') });
      return { ok: true, status: 200, json: async () => ({ text: ' Что у меня завтра ' }), text: async () => '' };
    };
    const text = await transcribe(new Blob([new Uint8Array(4000)], { type: 'audio/webm' }), { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'whisper-large-v3-turbo' }, f);
    expect(text).toBe('Что у меня завтра');
    expect(calls[0]).toEqual({ url: 'https://api.groq.com/openai/v1/audio/transcriptions', auth: 'Bearer k', model: 'whisper-large-v3-turbo', lang: 'ru' });
  });

  it('explains a rejected key', async () => {
    const f: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    let msg = '';
    try { await transcribe(new Blob(['x']), { baseUrl: 'u', apiKey: 'bad', model: 'm' }, f); } catch (e: any) { msg = e.message; }
    expect(msg).toContain('ключ');
  });
});
