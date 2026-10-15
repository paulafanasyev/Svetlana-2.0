import { describe, it, expect, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { validateEndpoint, normalizeGigachatKey, gigachatTemperature, GIGACHAT_WEB_ONLY } from '../services/AIGateway';
import { NATIVE_KEY_PROVIDERS } from '../services/security/WipeAll';
import { GIGACHAT_KEY_HINT } from '../pages/AIProvidersPage';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const g = globalThis as any;
afterEach(() => { delete g.__TAURI_INTERNALS__; delete g.__SVETLANA_PLATFORM__; });

const rust = read('src-tauri/src/secure_ai.rs');
const kt = read('android-hands/app/src/main/java/ru/svetlana/app/SecureAi.kt');

// GigaChat (Сбер): бесплатный тариф, только через нативную часть приложений Windows и Android.
describe('gigachat in both apps', () => {
  it('same fixed addresses, scope and token lifetime in Windows and Android', () => {
    for (const name of ['GIGACHAT_OAUTH', 'GIGACHAT_CHAT', 'GIGACHAT_SCOPE', 'GIGACHAT_BAD_KEY', 'GIGACHAT_NO_TOKENS']) {
      const r = new RegExp(`const ${name}: &str = "([^"]+)";`).exec(rust)?.[1];
      expect(r, name).toBeTruthy();
      expect(kt).toContain(`const val ${name} = "${r}"`);
    }
    expect(rust).toContain('const GIGACHAT_OAUTH: &str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";');
    expect(rust).toContain('const GIGACHAT_CHAT: &str = "https://api.giga.chat/v1/chat/completions";');
    expect(rust).toContain('Duration::from_secs(25 * 60)');
    expect(kt).toContain('GIGACHAT_TOKEN_TTL_MS = 25 * 60 * 1000L');
    expect(rust).toContain('const MAX_TOKEN_RESPONSE: usize = 64 * 1024;');
    expect(kt).toContain('const val MAX_TOKEN_RESPONSE = 64 * 1024');
  });

  it('the key must be a clean base64 authorization key on both sides', () => {
    expect(rust).toContain('fn valid_gigachat_key');
    expect(kt).toContain('fun validGigachatKey');
    expect(rust).toMatch(/provider == "gigachat" && !valid_gigachat_key\(v\)/);
    expect(kt).toMatch(/provider == "gigachat" && !validGigachatKey\(v\)/);
    expect(normalizeGigachatKey('  Basic  MDE5YWJj\nZGUtZjAx==  ')).toBe('MDE5YWJjZGUtZjAx==');
    expect(normalizeGigachatKey('basic abc')).toBe('abc');
  });

  it('temperature is never 0 for gigachat', () => {
    expect(gigachatTemperature(0)).toBe(0.1);
    expect(gigachatTemperature(0.7)).toBe(0.7);
    expect(gigachatTemperature(5)).toBe(2);
    expect(gigachatTemperature(undefined)).toBe(0.7);
    expect(rust).toContain('let t_min = if provider == "gigachat" { 0.01 } else { 0.0 };');
    expect(kt).toContain('if (provider == "gigachat") 0.01 else 0.0');
  });

  it('the token is forgotten on key change and on full wipe', () => {
    expect((rust.match(/forget_giga_token\(\);/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(kt).toMatch(/generation\+\+\s+gigaToken = null/);
    expect(kt).toMatch(/it\.keyHash == h && it\.gen == gen/);
  });

  it('the Russian root certificate is the same file in both apps and trusted only for GigaChat', () => {
    const a = read('src-tauri/certs/russian_trusted_root_ca.pem');
    const b = read('android-hands/app/src/main/res/raw/russian_trusted_root_ca.pem');
    expect(a).toBe(b);
    expect(a.startsWith('-----BEGIN CERTIFICATE-----\nMIIFwjCCA6qgAwIBAgICEAAw')).toBe(true);
    expect(a.trim().endsWith('-----END CERTIFICATE-----')).toBe(true);
    expect(rust).toContain('include_str!("../certs/russian_trusted_root_ca.pem")');
    // В Windows сертификат добавлен только в отдельный клиент GigaChat.
    expect((rust.match(/add_root_certificate/g) ?? []).length).toBe(1);
    expect(rust).toMatch(/fn gigachat_client\(\)[\s\S]*?add_root_certificate[\s\S]*?Policy::none\(\)|fn gigachat_client\(\)[\s\S]*?Policy::none\(\)[\s\S]*?add_root_certificate/);
    const nsc = read('android-hands/app/src/main/res/xml/network_security_config.xml');
    expect(nsc).toContain('<base-config cleartextTrafficPermitted="false">');
    const domainBlock = /<domain-config[\s\S]*?<\/domain-config>/.exec(nsc)?.[0] ?? '';
    expect(domainBlock).toContain('@raw/russian_trusted_root_ca');
    expect(domainBlock).toContain('ngw.devices.sberbank.ru');
    expect(domainBlock).toContain('api.giga.chat');
    expect(domainBlock).not.toContain('includeSubdomains="true"');
    const base = /<base-config[\s\S]*?<\/base-config>/.exec(nsc)?.[0] ?? '';
    expect(base).not.toContain('russian_trusted_root_ca');
    expect(base).not.toContain('src="user"');
    const manifest = read('android-hands/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
  });

  it('wipe knows every native provider', () => {
    const r = /PROVIDERS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rust)?.[1] ?? '';
    expect([...NATIVE_KEY_PROVIDERS]).toEqual((r.match(/"[a-z]+"/g) ?? []).map(x => x.slice(1, -1)));
    expect(NATIVE_KEY_PROVIDERS).toContain('gigachat');
  });

  it('only the official address, never through the browser or a proxy', () => {
    expect(validateEndpoint({ id: 'gigachat', type: 'online', endpoint: 'https://api.giga.chat/v1/' })).toBe('https://api.giga.chat/v1');
    expect(() => validateEndpoint({ id: 'gigachat', type: 'online', endpoint: 'https://evil.example/v1' })).toThrow();
    const gw = read('src/services/AIGateway.ts');
    // Проверка «только приложения» стоит ДО прокси.
    expect(gw.indexOf("if (provider.id === 'gigachat') {")).toBeGreaterThan(0);
    expect(gw.indexOf("if (provider.id === 'gigachat') {")).toBeLessThan(gw.indexOf('const proxy = this.getProxyUrl();'));
    expect(GIGACHAT_WEB_ONLY).toMatch(/Windows и Android/);
    expect(GIGACHAT_KEY_HINT).toContain('developers.sber.ru/studio');
  });
});
