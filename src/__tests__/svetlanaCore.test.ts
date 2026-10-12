// Единая Светлана: тело запроса и адрес только свой сервер.
import { describe, it, expect } from 'vitest';
import { toSvetlanaCoreBody, contentOf, SVETLANA_CORE_ORIGIN, SVETLANA_CORE_MODEL } from '../services/SvetlanaCore';
import { validateEndpoint, fallbackCandidates, type AIProvider } from '../services/AIGateway';

describe('Svetlana Core', () => {
  it('system отдельно, последнее сообщение пользователя — message, остальное — история', () => {
    const body = toSvetlanaCoreBody([
      { role: 'system', content: 'инструменты' },
      { role: 'user', content: 'привет' },
      { role: 'assistant', content: 'здравствуйте' },
      { role: 'user', content: 'проверь код' },
    ]);
    expect(body).toEqual({
      message: 'проверь код',
      history: [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'здравствуйте' }],
      system: 'инструменты',
    });
  });
  it('лимиты сервера: история не длиннее 10, сообщение до 16000', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
    const body = toSvetlanaCoreBody([...many, { role: 'user', content: 'x'.repeat(20000) }]);
    expect(body.history.length).toBe(10);
    expect(body.message.length).toBe(16000);
    expect(body.system).toBeUndefined();
  });
  it('без сообщения пользователя — ошибка', () => {
    expect(() => toSvetlanaCoreBody([{ role: 'system', content: 's' }])).toThrow();
  });
  it('ответ без текста — ошибка', () => {
    expect(contentOf({ site: 'svetlana2', content: 'ok' })).toBe('ok');
    expect(() => contentOf({ content: '' })).toThrow();
  });
  it('адрес — только свой сервер', () => {
    expect(validateEndpoint({ id: 'svetlana', type: 'online', endpoint: SVETLANA_CORE_ORIGIN })).toBe(SVETLANA_CORE_ORIGIN);
    expect(() => validateEndpoint({ id: 'svetlana', type: 'online', endpoint: 'https://evil.example' })).toThrow();
    expect(SVETLANA_CORE_MODEL).toBe('svetlana2');
  });
  it('локальная модель не уходит на сервер Светланы сама', () => {
    const p = (id: string, type: 'online' | 'offline'): AIProvider => ({ id, type, enabled: true, name: id, model: 'm', endpoint: type === 'offline' ? 'http://127.0.0.1:11434' : SVETLANA_CORE_ORIGIN });
    const all = [p('ollama', 'offline'), p('svetlana', 'online'), p('openai', 'online')];
    expect(fallbackCandidates(all, all[0]).map(x => x.id)).toEqual([]);
    expect(fallbackCandidates(all, all[2]).map(x => x.id)).toEqual(['svetlana']);
  });
});
