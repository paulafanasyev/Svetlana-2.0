// Страницы «Бизнес» и «Запись» не показывают сырые технические ошибки: всё через safeErrorText.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { safeErrorText } from '../services/safeErrorText';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('Бизнес и запись: текст ошибок', () => {
  for (const [file, min] of [['pages/BizPage.tsx', 9], ['pages/BookingPage.tsx', 6]] as const) {
    it(`${file}: нет ?.message, ошибки через safeErrorText`, () => {
      const src = read(file);
      expect(src).not.toMatch(/\?\.message/);
      expect(src).not.toMatch(/catch \((e|err): any\)/);
      expect(src.split('safeErrorText(').length - 1).toBeGreaterThanOrEqual(min);
    });
  }

  it('русские сообщения хранилища показываются, технические заменяются', () => {
    expect(safeErrorText(new Error('Сумма должна быть больше нуля'), 'x')).toBe('Сумма должна быть больше нуля');
    expect(safeErrorText(new Error("QuotaExceededError: Failed to execute 'setItem' on 'Storage'"), 'Не удалось сохранить')).toBe('Не удалось сохранить');
    expect(safeErrorText(new TypeError("Cannot read properties of undefined (reading 'x')"), 'Не удалось')).toBe('Не удалось');
  });
});
