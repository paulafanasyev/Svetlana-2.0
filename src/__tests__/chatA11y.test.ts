// Пачка 19: чат со Светланой для экранного диктора.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const page = readFileSync(resolve(__dirname, '../pages/AvatarPage.tsx'), 'utf8');

describe('chat accessibility', () => {
  it('the conversation is a log that announces only new messages', () => {
    expect(page).toContain('role="log"');
    expect(page).toContain('aria-relevant="additions"');
    expect(page).toContain('aria-label="Переписка со Светланой"');
  });
  it('every message says who wrote it and the thinking indicator is a status', () => {
    expect(page).toContain('<span className="sr-only">{speakerLabel(msg.role)} </span>');
    expect(page).toContain("role === 'user' ? 'Вы:' : 'Светлана:'");
    expect(page).toMatch(/role="status"[\s\S]{0,200}Светлана думает/);
  });
  it('scrolling respects reduced motion', () => {
    expect(page).toContain('prefers-reduced-motion: reduce');
    expect(page).toContain('behavior: scrollBehavior()');
  });
});
