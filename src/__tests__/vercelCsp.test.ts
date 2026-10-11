import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';

// CSP в заголовках хостинга должна совпадать с той, что вшивается в сборку (csp.mjs),
// плюс запрет встраивания страницы в чужие сайты (работает только заголовком).
describe('vercel.json CSP', () => {
  it('matches csp.mjs and forbids framing', async () => {
    const modPath: string = '../../csp.mjs';
    const { buildCsp } = await import(/* @vite-ignore */ modPath);
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const headers: { key: string; value: string }[] = cfg.headers[0].headers;
    const csp = headers.find(h => h.key === 'Content-Security-Policy')?.value;
    expect(csp).toBe(`${buildCsp()}; frame-ancestors 'none'`);
    expect(csp).toContain("script-src 'self'");
  });
});
