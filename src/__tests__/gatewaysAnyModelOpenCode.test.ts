// AnyModel и OpenCode Zen: фиксированные официальные адреса на всех платформах (сайт, Windows, Android).
import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { validateEndpoint, GATEWAY_CHAT_URLS } from '../services/AIGateway';
import { NATIVE_KEY_PROVIDERS } from '../services/security/WipeAll';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

describe('AnyModel и OpenCode Zen', () => {
  it('accept only the official base address', () => {
    expect(validateEndpoint({ id: 'anymodel', type: 'online', endpoint: 'https://anymodel.org/v1/' })).toBe('https://anymodel.org/v1');
    expect(validateEndpoint({ id: 'opencode', type: 'online', endpoint: 'https://opencode.ai/zen/v1' })).toBe('https://opencode.ai/zen/v1');
    expect(() => validateEndpoint({ id: 'anymodel', type: 'online', endpoint: 'https://evil.example/v1' })).toThrow();
    expect(() => validateEndpoint({ id: 'opencode', type: 'online', endpoint: 'https://opencode.ai/inference/custom/x' })).toThrow();
  });

  it('the same chat address is used on the site, Windows and Android', () => {
    expect(GATEWAY_CHAT_URLS.anymodel.url).toBe('https://anymodel.org/v1/chat/completions');
    expect(GATEWAY_CHAT_URLS.opencode.url).toBe('https://opencode.ai/zen/v1/chat/completions');
    const rs = read('src-tauri/src/secure_ai.rs');
    const kt = read('android-hands/app/src/main/java/ru/svetlana/app/SecureAi.kt');
    for (const { url } of Object.values(GATEWAY_CHAT_URLS)) {
      expect(rs).toContain(`"${url}"`);
      expect(kt).toContain(`"${url}"`);
    }
  });

  it('keys are wiped and the site may reach them', () => {
    expect(NATIVE_KEY_PROVIDERS).toContain('anymodel');
    expect(NATIVE_KEY_PROVIDERS).toContain('opencode');
    const vercel = read('vercel.json');
    expect(vercel).toContain('https://anymodel.org');
    expect(vercel).toContain('https://opencode.ai');
  });

  it('cards are on the AI models page', () => {
    const page = read('src/pages/AIProvidersPage.tsx');
    expect(page).toContain("id: 'anymodel'");
    expect(page).toContain("id: 'opencode'");
  });
});
