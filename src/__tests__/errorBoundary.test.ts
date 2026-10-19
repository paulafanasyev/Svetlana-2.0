import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах
 import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import ErrorBoundary, { PAGE_CRASH_TEXT } from '../components/ErrorBoundary';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

describe('page crash does not blank the whole app', () => {
  it('switches to the fallback after an error', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    expect(PAGE_CRASH_TEXT).toContain('данные не потеряны');
  });

  it('every tab of the main window is wrapped and reset on tab change', () => {
    const shell = read('src/DesktopShell.tsx');
    expect(shell).toContain("import ErrorBoundary from './components/ErrorBoundary'");
    expect(shell).toContain('<ErrorBoundary key={tab}');
    expect(shell).toContain('aria-current={tab === t.id ? \'page\' : undefined}');
  });

  it('does not print the error text (it may contain a key)', () => {
    const src = read('src/components/ErrorBoundary.tsx');
    expect(src).not.toMatch(/console\.error\([^)]*error\.message/);
  });
});
