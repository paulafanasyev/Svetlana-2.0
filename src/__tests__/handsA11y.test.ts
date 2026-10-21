// Пачка 23: «Руки» Android — подпись поля, понятные ошибки, журнал.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const page = readFileSync(resolve(__dirname, '../pages/AndroidHandsPage.tsx'), 'utf8');

describe('hands page accessibility', () => {
  it('the command field has a real label', () => {
    expect(page).toContain('htmlFor="hands-cmd"');
    expect(page).toContain('id="hands-cmd"');
  });
  it('errors go through safeErrorText and the log announces only new lines', () => {
    expect(page).toContain('safeErrorText(e, HANDS_ERROR)');
    expect(page).not.toContain('String(e ??');
    expect(page).toContain('role="log"');
    expect(page).toContain('aria-relevant="additions"');
  });
});
