// Пачка 30: после окна подтверждения действия фокус возвращается туда, где был (клавиатура, экранный диктор).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, '../components/ActionConfirmHost.tsx'), 'utf8');

describe('action confirmation focus', () => {
  it('remembers the opener before focusing Cancel and restores it when the queue is empty', () => {
    const opener = src.indexOf('openerRef.current = active instanceof HTMLElement');
    const cancel = src.indexOf('cancelRef.current?.focus()');
    expect(opener).toBeGreaterThan(-1);
    expect(opener).toBeLessThan(cancel);
    expect(src).toContain('}, [open]);');
    expect(src).toContain('if (back && back.isConnected) back.focus();');
  });

  it('still makes the background inert and starts on Cancel', () => {
    expect(src).toContain("root.setAttribute('inert', '')");
    expect(src).toContain('role="alertdialog"');
  });
});
