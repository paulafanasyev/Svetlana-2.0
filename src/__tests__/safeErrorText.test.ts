// Технические ошибки не показываются человеку как есть; Кабинет не зависает при ошибке связи.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { safeErrorText } from '../services/safeErrorText';

const FB = 'Не получилось';

describe('safeErrorText', () => {
  it('keeps our own Russian messages', () => {
    expect(safeErrorText(new Error('Код устарел, получите новый'), FB)).toBe('Код устарел, получите новый');
    expect(safeErrorText('Отменено пользователем', FB)).toBe('Отменено пользователем');
  });
  it('replaces technical, English, empty and secret-looking errors', () => {
    expect(safeErrorText(new TypeError("Cannot read properties of undefined (reading 'x')"), FB)).toBe(FB);
    expect(safeErrorText(new Error('Failed to fetch'), FB)).toBe(FB);
    expect(safeErrorText(new Error('Ошибка ключа sk-abcdefghijklmnopqrstuvwxyz123456'), FB)).toBe(FB);
    expect(safeErrorText(new Error('Ошибка https://example.com/x'), FB)).toBe(FB);
    expect(safeErrorText(null, FB)).toBe(FB);
    expect(safeErrorText({}, FB)).toBe(FB);
    expect(safeErrorText('я'.repeat(400), FB)).toBe(FB);
  });
  it('cabinet buttons are released after a network error', () => {
    const page = readFileSync(resolve(__dirname, '../pages/CabinetPage.tsx'), 'utf8');
    const sync = page.slice(page.indexOf('const onSync'), page.indexOf('const onUnlink'));
    expect(sync).toContain('catch');
    expect(sync).toContain('finally');
    expect(page).not.toContain('e?.message');
  });
});
