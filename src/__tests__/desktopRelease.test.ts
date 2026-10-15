import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { APP_VERSION } from '../version';
import { listOllamaModels, pickOllamaModel, errorText, explainServerError } from '../components/FirstRunSetup';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

// Сборка для Windows: одна версия везде, фронтенд собирается самим Tauri (без веб-CSP, которая блокирует ipc:),
// установщик по-русски.
describe('Windows desktop release', () => {
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));

  it('has one version everywhere', () => {
    const pkg = JSON.parse(read('package.json'));
    const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    expect(tauri.version).toBe(APP_VERSION);
    expect(pkg.version).toBe(APP_VERSION);
    expect(cargo).toBe(APP_VERSION);
    expect(read('CHANGELOG.md')).toContain(`## [${APP_VERSION}]`);
  });

  it('lets Tauri build the frontend so the web CSP meta tag is not baked in', () => {
    expect(tauri.build.beforeBuildCommand).toBe('npm run build');
    expect(tauri.build.frontendDist).toBe('../dist');
    const vite = read('vite.config.js');
    expect(vite).toContain('TAURI_ENV_PLATFORM');
    expect(vite).toMatch(/if \(!isDesktopBuild\(\)\) tags\.unshift/);
    expect(tauri.app.security.csp).toContain('ipc: http://ipc.localhost');
  });

  it('ships a Russian installer that bootstraps WebView2', () => {
    expect(tauri.bundle.windows.nsis.languages).toEqual(['Russian']);
    expect(tauri.bundle.windows.webviewInstallMode.type).toBe('downloadBootstrapper');
  });
});

describe('first-run setup helpers', () => {
  it('lists only sane Ollama model names', async () => {
    const f = (async () => ({ ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen2.5:7b' }, { name: 'bad name; rm' }, { name: 'gemma:2b' }, {}] }) })) as unknown as typeof fetch;
    expect(await listOllamaModels('http://127.0.0.1:11434', 1000, f)).toEqual(['qwen2.5:7b', 'gemma:2b']);
  });

  it('reports Ollama errors instead of pretending it works', async () => {
    const f = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(listOllamaModels('http://127.0.0.1:11434', 1000, f)).rejects.toThrow('500');
  });

  it('prefers Svetlana, then good Russian models', () => {
    expect(pickOllamaModel(['llama3.2:3b', 'qwen2.5:7b'])).toBe('qwen2.5:7b');
    expect(pickOllamaModel(['qwen2.5:7b', 'svetlana:latest'])).toBe('svetlana:latest');
    expect(pickOllamaModel(['mistral:7b'])).toBe('mistral:7b');
    expect(pickOllamaModel([])).toBeNull();
  });

  it('turns native string errors into readable text', () => {
    expect(errorText('Отменено пользователем')).toBe('Отменено пользователем');
    expect(errorText(new Error('x'))).toBe('x');
    expect(errorText(null)).toBe('Неизвестная ошибка');
  });

  it('explains common server errors in plain Russian', () => {
    expect(explainServerError('Отменено пользователем')).toContain('Повторить проверку');
    expect(explainServerError('HTTP 401: {"message":"bad key"}')).toContain('не принял ключ');
    expect(explainServerError('Светлана 403: Forbidden')).toContain('не принял ключ');
    expect(explainServerError('HTTP 502: Bad Gateway')).toContain('502');
    expect(explainServerError('error sending request')).toContain('интернет');
    expect(explainServerError('что-то другое')).toBe('что-то другое');
  });
});
