// Мастер первого запуска: фон inert, снимается до возврата фокуса.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, '../components/FirstRunSetup.tsx'), 'utf8');

describe('FirstRunSetup: фон недоступен', () => {
  it('isolateDialog из useDialogFocus', () => {
    expect(src).toContain("import { isolateDialog } from './useDialogFocus';");
    expect(src).toContain('const release = root ? isolateDialog(root) : () => undefined;');
  });
  it('inert снимается до возврата фокуса', () => {
    expect(src.indexOf('release();')).toBeGreaterThan(0);
    expect(src.indexOf('release();')).toBeLessThan(src.indexOf('opener.focus()'));
  });
});
