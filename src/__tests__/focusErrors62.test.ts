import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { safeErrorText } from '../services/safeErrorText';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('CRM window opened by a link', () => {
  const src = read('components/CRMLauncher.tsx');

  it('returns focus to the CRM button after closing', () => {
    expect(src).toContain("openedBy.current === 'biz' ? bizRef.current : crmRef.current");
  });

  it('does not steal focus on page load', () => {
    expect(src).toContain('if (!wasOpen.current) return;');
    expect(src).toContain('wasOpen.current = true');
  });
});

describe('speech model errors', () => {
  const src = read('components/VoiceEnroll.tsx');

  it('native status errors go through safeErrorText', () => {
    expect(src).toContain('safeErrorText(status.error, MODEL_ERROR)');
    expect(src).not.toMatch(/\{err \|\| status\.error\}/);
  });

  it('technical native text becomes a plain phrase, our Russian text stays', () => {
    expect(safeErrorText('java.net.SocketTimeoutException: timeout', 'x')).toBe('x');
    expect(safeErrorText('Модель не скачалась за 60 минут', 'x')).toBe('Модель не скачалась за 60 минут');
  });
});
