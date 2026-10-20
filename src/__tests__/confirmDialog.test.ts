// Подтверждения — в окне Светланы, а не системными окнами браузера (в WebView приложений они могут молча отвечать «нет»).
import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { askConfirm } from '../components/ConfirmDialog';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

const PAGES = ['src/components/VoiceEnroll.tsx', 'src/pages/CabinetPage.tsx', 'src/pages/CRMPage.tsx', 'src/pages/BizPage.tsx'];

describe('in-app confirmation', () => {
  it('pages do not use browser confirm/prompt windows', () => {
    for (const f of PAGES) {
      const src = read(f);
      expect({ f, confirm: src.includes('window.confirm('), prompt: src.includes('window.prompt(') }).toEqual({ f, confirm: false, prompt: false });
    }
  });

  it('wiping all data still requires a real click before the dialog', () => {
    const src = read('src/pages/CabinetPage.tsx');
    expect(src).toContain('!userGesture(e.nativeEvent)');
    expect(src.indexOf('!userGesture(e.nativeEvent)')).toBeLessThan(src.indexOf('askConfirm(`'));
  });

  it('CRM restore asks before replacing data, inside an async handler', () => {
    const src = read('src/pages/CRMPage.tsx');
    expect(src).toContain('(text: string) => string | Promise<string>');
    expect(src).toContain('setMessage(await handler(');
    expect(src.indexOf('askConfirm(\'Заменить все данные CRM')).toBeLessThan(src.indexOf('crmStore.importJSON(text)'));
  });

  it('business profile does not turn typed numbers into 0 silently', () => {
    const src = read('src/pages/BizPage.tsx');
    expect(src).not.toContain('Number(e.target.value) || 0');
    expect(src).toContain('укажите число цифрами');
  });

  it('answers “yes” only after the person presses the button', async () => {
    const p = askConfirm('Удалить тест?', { okText: 'Удалить тест' });
    if (typeof document === 'undefined') { expect(await p).toBe(false); return; }
    let ok: HTMLButtonElement | undefined;
    for (let i = 0; i < 100 && !ok; i++) {
      await new Promise(r => setTimeout(r, 10));
      ok = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Удалить тест') as HTMLButtonElement | undefined;
    }
    expect(ok).toBeTruthy();
    ok!.click();
    expect(await p).toBe(true);
  });
});
