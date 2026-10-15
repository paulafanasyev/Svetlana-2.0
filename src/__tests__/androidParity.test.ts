import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { appPlatform, isAndroidApp, isWindowsApp } from '../platform';
import { extractActions, quickActions, HANDS_SYSTEM_PROMPT, MAX_ACTIONS } from '../services/AndroidBridge';
import { localSttAvailable } from '../services/voice/LocalStt';
import { sttSupport, listen } from '../services/voice/SpeechEngine';
import { ttsAvailable, speakText } from '../services/voice/Tts';
import { NATIVE_KEY_PLACEHOLDER } from '../services/security/NativeBridge';
import { ANDROID_APK_URL, WINDOWS_SETUP_URL } from '../pages/DownloadPage';
import { keyStorageHint } from '../components/FirstRunSetup';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const g = globalThis as any;

type AnyInvoke = (...args: any[]) => Promise<unknown>;

function asAndroid(invoke: AnyInvoke = vi.fn(async () => null)): AnyInvoke {
  g.__TAURI_INTERNALS__ = { invoke };
  g.__SVETLANA_PLATFORM__ = 'android';
  return invoke;
}

afterEach(() => {
  delete g.__TAURI_INTERNALS__;
  delete g.__SVETLANA_PLATFORM__;
});

// Один интерфейс на сайте, в Windows и в Android: платформа определяется по нативному мосту.
describe('platform', () => {
  it('detects web, windows and android', () => {
    expect(appPlatform()).toBe('web');
    g.__TAURI_INTERNALS__ = { invoke: async () => null };
    expect(appPlatform()).toBe('windows');
    expect(isWindowsApp()).toBe(true);
    g.__SVETLANA_PLATFORM__ = 'android';
    expect(appPlatform()).toBe('android');
    expect(isAndroidApp()).toBe(true);
    expect(isWindowsApp()).toBe(false);
  });

  it('does not trust the android flag without the native bridge', () => {
    g.__SVETLANA_PLATFORM__ = 'android';
    expect(appPlatform()).toBe('web');
  });

  it('hides the Windows-only speech model on Android', () => {
    g.__TAURI_INTERNALS__ = { invoke: async () => null };
    expect(localSttAvailable()).toBe(true);
    asAndroid();
    expect(localSttAvailable()).toBe(false);
  });

  it('says where the key is stored on each platform', () => {
    expect(NATIVE_KEY_PLACEHOLDER).not.toMatch(/Windows/);
    expect(keyStorageHint('android')).toContain('телефона');
    expect(keyStorageHint('android')).not.toMatch(/Windows/);
    expect(keyStorageHint('windows')).toContain('Windows');
  });

  it('the site offers both apps from the same release', () => {
    expect(ANDROID_APK_URL).toMatch(/Svetlana-2\.0\/releases\/download\/app-v[\d.]+\/Svetlana-2\.0-Android\.apk$/);
    expect(WINDOWS_SETUP_URL.replace('Windows-setup.exe', '')).toBe(ANDROID_APK_URL.replace('Android.apk', ''));
  });
});

describe('android voice', () => {
  it('listens with the phone recognizer', async () => {
    const invoke = asAndroid(vi.fn(async (cmd: string) => (cmd === 'voice_listen' ? 'открой телеграм' : null)));
    expect(sttSupport().mode).toBe('native');
    const finals: string[] = [];
    await new Promise<void>(done => {
      const l = listen({ onFinal: t => { finals.push(t); }, onEnd: () => done() });
      expect(l?.mode).toBe('native');
    });
    expect(invoke).toHaveBeenCalledWith('voice_listen');
    expect(finals).toEqual(['открой телеграм']);
  });

  it('speaks with the phone voice', async () => {
    const invoke = asAndroid();
    expect(ttsAvailable()).toBe(true);
    await new Promise<void>(done => speakText('Привет!', { force: true, onEnd: () => done() }));
    expect(invoke).toHaveBeenCalledWith('tts_speak', { text: expect.stringContaining('Привет') });
  });

  it('never touches window.speechSynthesis on Android', () => {
    const avatar = read('src/components/Avatar.tsx');
    expect(avatar).toMatch(/if \(isAndroidApp\(\) \|\| !ttsAvailable\(\)/);
    expect(read('src/components/VoiceButton.tsx')).toContain('listenCommand');
  });
});

describe('android hands', () => {
  it('extracts only allowed steps and clamps values', () => {
    const reply = 'Открываю.\n```json\n{"actions":[{"type":"open_app","name":"Telegram"},{"type":"shell","cmd":"rm -rf"},{"type":"wait","ms":999999},{"type":"scroll","direction":"sideways"},{"type":"home"}]}\n```';
    const r = extractActions(reply);
    expect(r.text).toBe('Открываю.');
    expect(r.actions).toEqual([
      { type: 'open_app', name: 'Telegram' },
      { type: 'wait', ms: 5000 },
      { type: 'scroll', direction: 'down' },
      { type: 'home' },
    ]);
  });

  it('ignores broken or missing blocks and caps the number of steps', () => {
    expect(extractActions('просто текст').actions).toEqual([]);
    expect(extractActions('```json\n{"actions": [}\n```').actions).toEqual([]);
    const many = JSON.stringify({ actions: Array.from({ length: 40 }, () => ({ type: 'back' })) });
    expect(extractActions('```json\n' + many + '\n```').actions).toHaveLength(MAX_ACTIONS);
  });

  it('understands quick commands without AI', () => {
    expect(quickActions('Света, открой Telegram')).toEqual([{ type: 'open_app', name: 'telegram' }]);
    expect(quickActions('назад')).toEqual([{ type: 'back' }]);
    expect(quickActions('пролистай вверх')).toEqual([{ type: 'scroll', direction: 'up' }]);
    expect(quickActions('напечатай Привет, мама!')).toEqual([{ type: 'type', text: 'Привет, мама!' }]);
    expect(quickActions('расскажи анекдот')).toBeNull();
    expect(HANDS_SYSTEM_PROMPT).toContain('"actions"');
  });
});

// Нативные части Windows (Rust) и Android (Kotlin) должны защищать одинаково.
describe('windows and android native parts stay identical', () => {
  const rust = read('src-tauri/src/secure_ai.rs');
  const kt = read('android-hands/app/src/main/java/ru/svetlana/app/SecureAi.kt');

  it('same providers', () => {
    const r = /PROVIDERS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rust)?.[1] ?? '';
    const k = /PROVIDERS = listOf\(([^)]+)\)/.exec(kt)?.[1] ?? '';
    const names = (s: string) => (s.match(/"[a-z]+"/g) ?? []).map(x => x.slice(1, -1));
    expect(names(r).length).toBeGreaterThan(5);
    expect(names(k)).toEqual(names(r));
  });

  it('same fixed endpoints', () => {
    const urls = (rust.match(/\.post\("https:\/\/[^"]+"\)/g) ?? []).map(x => x.slice(7, -2));
    expect(urls.length).toBeGreaterThanOrEqual(6);
    for (const u of urls) expect(kt).toContain(`"${u}"`);
    const core = /SVETLANA_CORE: &str = "([^"]+)"/.exec(rust)?.[1];
    expect(core).toBeTruthy();
    expect(kt).toContain(`"${core}"`);
    expect(kt).toContain('https://generativelanguage.googleapis.com/v1beta/models/');
  });

  it('same limits', () => {
    for (const name of ['MAX_SECRET', 'MAX_MESSAGES', 'MAX_TEXT', 'SVETLANA_MAX_HISTORY', 'CHAT_PER_MINUTE', 'SECRET_WRITES_PER_MINUTE', 'CONSENT_MAX_USES', 'MAX_CONVERSATIONS', 'CONVERSATIONS_PER_MINUTE']) {
      const r = new RegExp(`const ${name}: \\w+ = ([\\d_]+);`).exec(rust)?.[1];
      const k = new RegExp(`const val ${name} = ([\\d_]+)\\b`).exec(kt)?.[1];
      expect({ name, value: k }).toEqual({ name, value: r });
    }
    expect(kt).toContain('MAX_BODY = 2 * 1024 * 1024');
    expect(kt).toContain('MAX_RESPONSE = 8 * 1024 * 1024');
    const unknown = /CONVERSATION_UNKNOWN: &str = "([^"]+)"/.exec(rust)?.[1];
    expect(kt).toContain(`"${unknown}"`);
  });

  it('android host is locked down', () => {
    const main = read('android-hands/app/src/main/java/ru/svetlana/app/MainActivity.kt');
    const bridge = read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt');
    const steps = read('android-hands/app/src/main/java/ru/svetlana/app/Steps.kt');
    expect(main).toContain('MIXED_CONTENT_NEVER_ALLOW');
    expect(main).toContain('allowFileAccess = false');
    expect(main).toContain('isMainFrame');
    expect(main).toContain('setWebContentsDebuggingEnabled(false)');
    expect(main).toContain('filterTouchesWhenObscured = true');
    expect(bridge).toContain('Команда недоступна на Android');
    expect(bridge).toContain('__TAURI_INTERNALS__');
    expect(bridge).toContain('Steps.resolveApps');
    expect(steps).toContain('ctx.packageName');
    expect(steps).toContain('на экране другое приложение');
    expect(read('android-hands/app/build.gradle.kts')).not.toContain('"bash"');
  });

  it('the android tab exists only in the app, dev tab is hidden there', () => {
    const shell = read('src/DesktopShell.tsx');
    expect(shell).toMatch(/id: 'hands'[^\n]*androidOnly: true/);
    expect(shell).toMatch(/id: 'dev'[^\n]*notOnAndroid: true/);
  });
});
