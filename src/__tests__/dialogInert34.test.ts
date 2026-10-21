// Панель настроек голоса (useDialogFocus) делает фон недоступным и возвращает его при закрытии.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isolateDialog } from '../components/useDialogFocus';

/** Минимальный DOM для проверки обхода: только то, чем пользуется isolateDialog. */
class El {
  attrs = new Map<string, string>();
  children: El[] = [];
  parentElement: El | null = null;
  ownerDocument: { body: El } | undefined;
  constructor(public tagName: string) {}
  add(...kids: El[]) { for (const k of kids) { k.parentElement = this; this.children.push(k); } return this; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  hasAttribute(k: string) { return this.attrs.has(k); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
}

function page() {
  const body = new El('BODY');
  const doc = { body };
  const appRoot = new El('DIV');
  const nav = new El('NAV');
  const main = new El('MAIN');
  const backdrop = new El('DIV'); backdrop.setAttribute('aria-hidden', 'true');
  const panel = new El('DIV');
  const already = new El('DIV'); already.setAttribute('inert', '');
  const script = new El('SCRIPT');
  body.add(appRoot, already, script);
  appRoot.add(nav, main);
  main.add(backdrop, panel);
  for (const e of [body, appRoot, nav, main, backdrop, panel, already, script]) e.ownerDocument = doc;
  return { body, appRoot, nav, main, backdrop, panel, already, script };
}

describe('Окно настроек: фон inert', () => {
  it('соседи на всех уровнях становятся inert, само окно и затенение нет', () => {
    const p = page();
    const release = isolateDialog(p.panel as unknown as HTMLElement);
    expect(p.nav.hasAttribute('inert')).toBe(true);
    expect(p.panel.hasAttribute('inert')).toBe(false);
    expect(p.main.hasAttribute('inert')).toBe(false);
    expect(p.appRoot.hasAttribute('inert')).toBe(false);
    expect(p.backdrop.hasAttribute('inert')).toBe(false);
    expect(p.script.hasAttribute('inert')).toBe(false);
    release();
    expect(p.nav.hasAttribute('inert')).toBe(false);
  });

  it('чужой inert после закрытия остаётся', () => {
    const p = page();
    const release = isolateDialog(p.panel as unknown as HTMLElement);
    release();
    expect(p.already.hasAttribute('inert')).toBe(true);
  });

  it('хук снимает inert до возврата фокуса', () => {
    const src = readFileSync(resolve(__dirname, '../components/useDialogFocus.ts'), 'utf8');
    expect(src).toContain('const release = isolateDialog(root);');
    expect(src.indexOf('release();')).toBeGreaterThan(0);
    expect(src.indexOf('release();')).toBeLessThan(src.indexOf('before.focus()'));
  });
});
