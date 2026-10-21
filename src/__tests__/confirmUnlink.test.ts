// Пачка 24: «Отвязать» и «Забыть код» спрашивают подтверждение.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cabinet = readFileSync(resolve(__dirname, '../pages/CabinetPage.tsx'), 'utf8');
const phone = readFileSync(resolve(__dirname, '../pages/AndroidConnectionPage.tsx'), 'utf8');

describe('confirm before unlink / forget', () => {
  it('unlink asks first', () => {
    const body = cabinet.slice(cabinet.indexOf('const onUnlink'), cabinet.indexOf('const onWipe'));
    expect(body).toContain('await askConfirm(');
    expect(body.indexOf('if (!sure) return;')).toBeLessThan(body.indexOf('unlinkLocal()'));
  });
  it('forget code asks first and announces the result', () => {
    const body = phone.slice(phone.indexOf('const handleForget'), phone.indexOf('const locked'));
    expect(body).toContain('await askConfirm(');
    expect(body.indexOf('if (!sure) return;')).toBeLessThan(body.indexOf('setSecret(CODE_SECRET, null)'));
    expect(phone).toContain('role="status"');
  });
});
