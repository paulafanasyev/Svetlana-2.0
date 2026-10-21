// Пачка 58: кнопки под палец, читаемый текст режима голоса, прокрутка чата и возврат фокуса.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nearBottom, shouldAutoScroll } from '../services/ChatScroll';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('touch targets', () => {
  it('on touch screens every button is at least 44 px', () => {
    const css = src('index.css');
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/min-width:\s*44px/);
  });
  it('chat header and composer buttons are 44 px everywhere', () => {
    const page = src('pages/AvatarPage.tsx');
    expect(page).toContain('aria-label="Сервисы (MCP)"');
    expect((page.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
});

describe('voice mode text', () => {
  it('is not dimmed below readable contrast', () => {
    const avatar = src('components/Avatar.tsx');
    expect(avatar).not.toContain('text-[11px] text-sv-muted opacity-60');
    expect(avatar).toContain('data-testid="voice-mode"');
  });
});

describe('chat scroll', () => {
  it('follows new replies only when the reader is at the bottom', () => {
    expect(nearBottom(1000, 600, 400)).toBe(true);
    expect(nearBottom(1000, 540, 400)).toBe(true);
    expect(nearBottom(1000, 100, 400)).toBe(false);
    expect(shouldAutoScroll(false, 'svetlana')).toBe(false);
    expect(shouldAutoScroll(false, 'user')).toBe(true);
    expect(shouldAutoScroll(true, 'svetlana')).toBe(true);
  });
  it('the chat uses it and focus returns to «Сервисы» after the panel closes', () => {
    const page = src('pages/AvatarPage.tsx');
    expect(page).toContain('shouldAutoScroll(');
    expect(page).toContain('onScroll=');
    expect(page).toContain('servicesBtnRef.current?.focus()');
  });
});
