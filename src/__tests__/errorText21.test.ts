// Пачка 21: страница «Банк и ИНН» не показывает технические тексты ошибок.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { safeErrorText } from '../services/safeErrorText';

const page = readFileSync(resolve(__dirname, '../pages/BankInnPage.tsx'), 'utf8');

describe('bank page error text', () => {
  it('every catch goes through safeErrorText', () => {
    expect(page).not.toContain('?.message');
    expect(page.match(/safeErrorText\(/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
  it('network errors become a clear phrase, our own messages stay', () => {
    const fallback = 'Проверка не удалась';
    expect(safeErrorText(new TypeError('Failed to fetch'), fallback)).toBe(fallback);
    expect(safeErrorText(new Error('Банк с таким БИК не найден'), fallback)).toBe('Банк с таким БИК не найден');
  });
});
