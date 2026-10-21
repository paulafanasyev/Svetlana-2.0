// Панель настроек голоса (useDialogFocus) делает фон недоступным и возвращает его при закрытии.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isolateDialog } from '../components/useDialogFocus';

/** Минимальный DOM для проверки обхода: только то, чем пользуется isolateDialog. */
type Doc = { body: El };
interface El {
  tagName: string;
  attrs: Map<string, string>;
  children: El[];
  parentElement: El | null;
  ownerDocument?: Doc;
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  hasAttribute(k: string): boolean;
  getAttribute(k: string): string | null;
}

function el(tagName: string): El {
  const attrs = new Map<string, string>();
  return {
    tagName, attrs, children: [], parentElement: null,
    setAttribute: (k, v) => { attrs.set(k, v); },
    removeAttribute: k => { attrs.delete(k); },
    hasAttribute: k => attrs.has(k),
    getAttribute: k => attrs.get(k) ?? null,
  };
}

function add(parent: El, ...kids: El[]) {
  for (const k of kids) { k.parentElement = parent; parent.children.push(k); }
}

function page() {
  const body = el('BODY');
  const doc: Doc = { body };
  const appRoot = el('DIV');
  const nav = el('NAV');
  const main = el('MAIN');
  const backdrop = el('DIV'); backdrop.setAttribute('aria-hidden', 'true');
  const panel = el('DIV');
  const already = el('DIV'); already.setAttribute('inert', '');
  const script = el('SCRIPT');
  add(body, appRoot, already, script);
  add(appRoot, nav, main);
  add(main, backdrop, panel);
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
