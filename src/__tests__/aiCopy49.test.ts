// Страница моделей: «Скопировано!» только после настоящего копирования, ошибка выбора модели видна.
import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { copyCommand, COPY_FAILED } from '../pages/AIProvidersPage';

const src = readFileSync(resolve('src/pages/AIProvidersPage.tsx'), 'utf8');

describe('copy command', () => {
  it('is true only when the clipboard accepted the text', async () => {
    const got: string[] = [];
    expect(await copyCommand('ollama run qwen2.5:7b', { writeText: async t => { got.push(t); } })).toBe(true);
    expect(got).toEqual(['ollama run qwen2.5:7b']);
    expect(await copyCommand('x', { writeText: async () => { throw new Error('denied'); } })).toBe(false);
    expect(await copyCommand('x', undefined)).toBe(false);
    expect(await copyCommand('x', {})).toBe(false);
  });

  it('the page shows a failure instead of a false «Скопировано!»', () => {
    expect(COPY_FAILED).toMatch(/Не скопировалось/);
    expect(src).toContain("{copied.ok ? 'Скопировано!' : COPY_FAILED}");
    expect(src).toContain('const ok = await copyCommand(command);');
    expect(src).not.toContain('.catch(() => undefined);\n    setCopiedCommand');
  });
});

describe('use a local model', () => {
  it('becomes active only after it was saved, the error is shown', () => {
    expect(src).toMatch(/await aiGateway\.updateProvider\('ollama', \{ model: modelId, enabled: true \}\);\s*aiGateway\.setActiveProvider\('ollama'\);/);
    expect(src).toContain('setUseError(`Не удалось выбрать модель: ${errorText(e)}`);');
    expect(src).toContain('data-testid="use-model-error" role="alert"');
    expect(src).not.toContain('.catch(e => console.error(e))');
  });
});
