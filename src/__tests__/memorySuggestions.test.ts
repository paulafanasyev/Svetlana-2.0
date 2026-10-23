import { describe, expect, it } from 'vitest';
import { suggestMemoryCandidates } from '../services/MemorySuggestions';

describe('local reviewable memory suggestions', () => {
  it('suggests stable preference statements from the user message', () => {
    expect(suggestMemoryCandidates('Я предпочитаю короткие ответы и таблицы.')).toEqual([
      'Я предпочитаю короткие ответы и таблицы.',
    ]);
    expect(suggestMemoryCandidates('Please always respond in Russian.')).toEqual([
      'Please always respond in Russian.',
    ]);
  });

  it('does not turn ordinary or temporary requests into memory', () => {
    expect(suggestMemoryCandidates('Расскажи прогноз погоды на завтра.')).toEqual([]);
    expect(suggestMemoryCandidates('Сделай этот ответ короче.')).toEqual([]);
    expect(suggestMemoryCandidates('Мне нравится')).toEqual([]);
  });

  it('filters likely sensitive personal context and credential-bearing text', () => {
    expect(suggestMemoryCandidates('Мне нравится лечение без лекарств.')).toEqual([]);
    expect(suggestMemoryCandidates('Я предпочитаю использовать api_key=top-secret-value.')).toEqual([]);
    expect(suggestMemoryCandidates('Я предпочитаю этот сайт https://example.com')).toEqual([]);
  });

  it('filters duplicate suggestions regardless of case', () => {
    expect(suggestMemoryCandidates('Я предпочитаю короткие ответы.', ['я предпочитаю КОРОТКИЕ ответы.'])).toEqual([]);
  });

  it('does not produce an unbounded candidate from a long message', () => {
    expect(suggestMemoryCandidates('Я предпочитаю ' + 'подробные '.repeat(40) + 'ответы.')).toEqual([]);
  });
});
