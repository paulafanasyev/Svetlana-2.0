// Кабинет: пока проверки защиты идут, не показываем пять ложных «не включено».
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, '../pages/CabinetPage.tsx'), 'utf8');

describe('CabinetPage: состояние проверок', () => {
  it('до ответа — «Проверяю защиту…», при сбое — «Не удалось проверить»', () => {
    expect(src).toContain("useState<CheckState>('loading')");
    expect(src).toContain('checks === \'failed\' ? CABINET_CHECK_FAILED : CABINET_CHECKING');
    expect(src).toContain("setChecks(s => (s === 'ready' ? 'ready' : 'failed'))");
  });

  it('«не включено» показывается только по настоящему ответу проверок', () => {
    expect(src).not.toContain('hb ? !!hb.status[k] : false');
    expect(src).toContain('{hb ? (');
  });
});
