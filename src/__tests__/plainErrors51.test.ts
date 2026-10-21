// Ошибки ИИ и мастера настройки: без сырого текста сервера и технических хвостов.
import { describe, it, expect } from 'vitest';
import { explainAiError, AI_ERROR_GENERIC } from '../services/AiErrors';
import { explainServerError, explainKeySaveError } from '../components/FirstRunSetup';

describe('plain errors', () => {
  it('raw server text is not shown, the code is', () => {
    const r = explainAiError('LM Studio API error: 400 Bad Request {"error":"context length"}');
    expect(r).toBe(`Ошибка ИИ: ${AI_ERROR_GENERIC} (код 400)`);
    expect(r).not.toContain('Bad Request');
    expect(explainAiError('something odd happened')).toBe(`Ошибка ИИ: ${AI_ERROR_GENERIC}`);
  });

  it('russian messages lose the technical tail', () => {
    expect(explainAiError('Нет связи с сервером, проверьте интернет (error sending request: SocketTimeoutException)'))
      .toBe('Нет связи с сервером, проверьте интернет');
    expect(explainAiError('GigaChat: закончились токены')).toBe('GigaChat: закончились токены');
  });

  it('the setup wizard never shows raw text', () => {
    expect(explainServerError('HTTP 418: {"teapot":true}')).not.toContain('teapot');
    expect(explainServerError('weird failure')).toContain(AI_ERROR_GENERIC);
    expect(explainKeySaveError('Error: keyring blew up')).not.toContain('keyring');
    expect(explainKeySaveError('Некорректный ключ')).toBe('Ключ не сохранён: Некорректный ключ');
  });
});
