// Настройки ИИ: вкладки — полный шаблон (стрелки, tabpanel), окно настройки делает фон недоступным.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nextTab } from '../pages/AIProvidersPage';

const src = readFileSync(resolve(__dirname, '../pages/AIProvidersPage.tsx'), 'utf8');

describe('AIProvidersPage: вкладки', () => {
  it('стрелки ходят по кругу, Home/End — к краям, прочие клавиши не трогаем', () => {
    expect(nextTab('offline', 'ArrowRight')).toBe('online');
    expect(nextTab('online', 'ArrowRight')).toBe('offline');
    expect(nextTab('offline', 'ArrowLeft')).toBe('online');
    expect(nextTab('online', 'Home')).toBe('offline');
    expect(nextTab('offline', 'End')).toBe('online');
    expect(nextTab('offline', 'Enter')).toBeNull();
  });

  it('у вкладок есть панели, неактивная вкладка вне порядка Tab', () => {
    for (const t of ['offline', 'online']) {
      expect(src).toContain(`id="ai-tab-${t}"`);
      expect(src).toContain(`aria-controls="ai-panel-${t}"`);
      expect(src).toContain(`role="tabpanel" id="ai-panel-${t}" aria-labelledby="ai-tab-${t}"`);
      expect(src).toContain(`tabIndex={tab === '${t}' ? 0 : -1}`);
    }
    expect(src).toContain('onKeyDown={onTabKeyDown}');
  });

  it('окно настройки: фон inert и снимается до возврата фокуса', () => {
    expect(src).toContain('const release = root ? isolateDialog(root) : () => undefined;');
    expect(src.indexOf('release();')).toBeLessThan(src.indexOf('opener.focus()'));
  });
});
