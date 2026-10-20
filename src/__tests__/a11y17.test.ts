// Пачка 17, доступность: окно настроек голоса модальное, ошибка страницы получает фокус, анимации уважают
// «Уменьшить движение».
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('доступность, пачка 17', () => {
  it('voice settings is a real modal dialog with a focus trap', () => {
    const vb = src('components/VoiceButton.tsx');
    expect(vb).toContain('aria-modal="true"');
    expect(vb).toContain('useDialogFocus(panelRef, onClose, closeRef)');
    const hook = src('components/useDialogFocus.ts');
    expect(hook).toContain("e.key === 'Escape'");
    expect(hook).toContain("e.key !== 'Tab'");
    expect(hook).toContain('before.focus()');
  });

  it('the page crash message takes focus', () => {
    const eb = src('components/ErrorBoundary.tsx');
    expect(eb).toContain('tabIndex={-1}');
    expect(eb).toContain('this.box.current?.focus()');
  });

  it('animations respect reduced motion', () => {
    const main = src('main.tsx');
    expect(main).toContain('<MotionConfig reducedMotion="user">');
    expect(main).toContain('./reducedMotion.css');
    expect(src('reducedMotion.css')).toContain('prefers-reduced-motion: reduce');
  });
});
