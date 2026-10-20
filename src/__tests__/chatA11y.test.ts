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
    // Текст «Светлана думает» лежит внутри того же блока, что и role="status".
    const start = page.indexOf('role="status"');
    expect(start).toBeGreaterThan(-1);
    const block = page.slice(start, page.indexOf('</motion.div>', start));
    expect(block).toContain('Светлана думает');
  });
  it('scrolling respects reduced motion', () => {
    expect(page).toContain('prefers-reduced-motion: reduce');
    expect(page).toContain('behavior: scrollBehavior()');
  });
});
