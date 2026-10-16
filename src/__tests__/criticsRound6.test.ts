import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { validateEndpoint } from '../services/AIGateway';
import { explainAiError } from '../services/AiErrors';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

describe('every cloud AI has a fixed official address', () => {
  it('accepts the official address and rejects any other', () => {
    const official: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      deepseek: 'https://api.deepseek.com/v1',
      mistral: 'https://api.mistral.ai/v1',
      gigachat: 'https://api.giga.chat/v1',
    };
    for (const [id, url] of Object.entries(official)) {
      expect(validateEndpoint({ id, type: 'online', endpoint: `${url}/` })).toBe(url);
      expect(() => validateEndpoint({ id, type: 'online', endpoint: 'https://evil.example/v1' }), id).toThrow();
    }
    // Свой ИИ есть только в приложении Android; здесь (не Android) он отклоняется.
    expect(() => validateEndpoint({ id: 'custom', type: 'online', endpoint: 'https://api.openai.com/v1' })).toThrow(/только в приложении для Android/);
    // Неизвестный облачный провайдер по-прежнему запрещён.
    expect(() => validateEndpoint({ id: 'evil-provider', type: 'online', endpoint: 'https://evil.example/v1' })).toThrow();
  });
});

describe('AI errors are explained in plain Russian', () => {
  it('maps codes and network failures', () => {
    expect(explainAiError('HTTP 401: {"error":{"message":"Invalid API key"}}')).toMatch(/не принял ключ/);
    expect(explainAiError('HTTP 402: {}')).toMatch(/токены/);
    expect(explainAiError('HTTP 429: slow down')).toMatch(/Подождите минуту/);
    expect(explainAiError('HTTP 503: upstream')).toMatch(/не отвечает/);
    expect(explainAiError('TypeError: Failed to fetch')).toMatch(/Нет связи/);
    expect(explainAiError('Отменено пользователем')).toMatch(/«Отмена»/);
    expect(explainAiError('GigaChat: закончились токены')).toBe('GigaChat: закончились токены');
    expect(explainAiError('LM Studio API error: 400 Bad Request')).toMatch(/^Ошибка ИИ: /);
    expect(explainAiError('')).toBe('Ошибка при обращении к ИИ');
  });
});

describe('no dead end without AI', () => {
  it('setup offers the free GigaChat and closing it is not «done»', () => {
    const src = read('src/components/FirstRunSetup.tsx');
    expect(src).toContain('data-testid="setup-gigachat"');
    expect(src).toContain("aiGateway.chat([{ role: 'user', content: PING }], { max_tokens: 50 }, 'gigachat')");
    expect(src).toContain('GIGACHAT_WEB_ONLY');
    expect(src).toMatch(/const close = \(\) => \{ onClose\(\); \};/);
    expect(src).toContain('onBack(close)');
    expect(src).toMatch(/onClick=\{close\}[^>]*aria-label="Закрыть"/);
  });

  it('chat shows «Подключить ИИ» and explains errors', () => {
    const page = read('src/pages/AvatarPage.tsx');
    expect(page).toContain('data-testid="connect-ai"');
    expect(page).toContain('explainAiError(');
    expect(read('src/DesktopShell.tsx')).toContain('<AvatarPage onConnectAi={() => setSetupOpen(true)} />');
  });

  it('the copy hint timer is cleaned up', () => {
    const src = read('src/pages/AIProvidersPage.tsx');
    expect(src).toContain('copyTimer.current');
    expect(src).toMatch(/useEffect\(\(\) => \(\) => \{ if \(copyTimer\.current\) clearTimeout\(copyTimer\.current\); \}, \[\]\);/);
  });

  it('clearing the browser copy of a key never throws unhandled', () => {
    expect(read('src/services/AIGateway.ts')).toContain('void Promise.resolve(setSecret(name, null)).catch(() => undefined);');
  });
});
