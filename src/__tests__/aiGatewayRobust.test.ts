// Шлюз ИИ не выдаёт пустой ответ за нормальный и откатывает изменение, если ключ не сохранился.
import { describe, it, expect, afterEach } from 'vitest';
import { aiGateway, textOrFail } from '../services/AIGateway';

describe('AI gateway robustness', () => {
  afterEach(() => { delete (globalThis as any).__TAURI_INTERNALS__; });

  it('an empty model reply is an error, not an empty answer', () => {
    expect(() => textOrFail('Ollama', '')).toThrow(/пустой ответ/);
    expect(() => textOrFail('Ollama', '   ')).toThrow(/пустой ответ/);
    expect(() => textOrFail('Ollama', undefined)).toThrow(/пустой ответ/);
    expect(() => textOrFail('Ollama', { text: 'x' })).toThrow(/пустой ответ/);
    expect(textOrFail('Ollama', 'Привет')).toBe('Привет');
  });

  it('a key change cancelled in the native window rolls the provider back', async () => {
    await aiGateway.ready;
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === 'secret_set') throw new Error('Отменено пользователем');
        if (cmd === 'secret_has') return false;
        return null;
      },
    };
    const before = aiGateway.getProvider('ollama')!.model;
    await expect(aiGateway.updateProvider('ollama', { model: 'other:latest', apiKey: 'k-1234567890' })).rejects.toThrow(/Отменено/);
    expect(aiGateway.getProvider('ollama')?.model).toBe(before);
    expect(aiGateway.getProvider('ollama')?.apiKey).toBeUndefined();
  });
});
