import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
// @ts-ignore
import { pathToFileURL } from 'node:url';

// CSP в заголовках хостинга должна совпадать с той, что вшивается в сборку (csp.mjs),
// плюс запрет встраивания страницы в чужие сайты (работает только заголовком).
describe('vercel.json CSP', () => {
  it('matches csp.mjs and forbids framing', async () => {
    const url: string = pathToFileURL(resolve('csp.mjs')).href;
    const { buildCsp } = await import(/* @vite-ignore */ url);
    const cfg = JSON.parse(readFileSync(resolve('vercel.json'), 'utf8'));
    const headers: { key: string; value: string }[] = cfg.headers[0].headers;
    const csp = headers.find(h => h.key === 'Content-Security-Policy')?.value;
    expect(csp).toBe(`${buildCsp()}; frame-ancestors 'none'`);
    expect(csp).toContain("script-src 'self'");
  });
});
