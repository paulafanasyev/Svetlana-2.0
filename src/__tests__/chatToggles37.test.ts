// Чат: кнопки, которые раскрывают панели, сообщают диктору «развёрнуто / свёрнуто» и какую панель открывают.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const page = readFileSync(resolve(__dirname, '../pages/AvatarPage.tsx'), 'utf8');

describe('Чат: кнопки панелей', () => {
  it('«Сервисы» — aria-expanded и aria-controls на панель, без aria-pressed', () => {
    expect(page).toContain('aria-expanded={showServices}');
    expect(page).toContain('aria-controls="chat-services-panel"');
    expect(page).toContain('id="chat-services-panel"');
    expect(page).not.toContain('aria-pressed={showServices}');
  });

  it('«Настройки голоса» указывают на свою панель', () => {
    expect(page).toContain('aria-controls="chat-voice-settings"');
    expect(page).toContain('id="chat-voice-settings"');
  });
});
