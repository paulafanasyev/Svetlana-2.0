// Всё, что есть на сайте и в Windows, работает и в приложении для Android: домашняя сеть (Ollama/LM Studio
// на компьютере, Svetlana-home), контакты, печать, копирование, распознавание речи на устройстве, голос.
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { isLanUrl, androidLanFetch, androidListContacts } from '../services/AndroidFiles';
import { localTranscribe, pcm16Base64, to16k } from '../services/voice/LocalStt';
import { speakText, speakingNow } from '../services/voice/Tts';
import { recordedRecognizer, listenRecorded } from '../services/voice/SpeechEngine';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const g = globalThis as any;

function setAndroid(invoke: (...a: any[]) => Promise<unknown>) {
  g.__TAURI_INTERNALS__ = { invoke };
  g.__SVETLANA_PLATFORM__ = 'android';
}

afterEach(() => {
  delete g.__TAURI_INTERNALS__;
  delete g.__SVETLANA_PLATFORM__;
});

describe('home network over http (Ollama on the PC, Svetlana-home)', () => {
  it('only private IP addresses go through the phone', () => {
    for (const u of ['http://192.168.1.10:11434/api/tags', 'http://127.0.0.1:8080', 'http://10.0.0.5/', 'http://172.20.1.1:1234/v1/models', 'http://localhost:11434']) {
      expect({ u, lan: isLanUrl(u) }).toEqual({ u, lan: true });
    }
    for (const u of ['https://192.168.1.10', 'http://8.8.8.8', 'http://example.com', 'http://192.168.1.10.evil.com/', 'http://172.32.0.1', 'http://localhost.evil.com']) {
      expect({ u, lan: isLanUrl(u) }).toEqual({ u, lan: false });
    }
  });

  it('behaves like fetch', async () => {
    const invoke = vi.fn(async (..._a: unknown[]) => ({ status: 200, body: '{"models":[{"name":"qwen"}]}' }));
    const r = await androidLanFetch('http://192.168.1.10:11434/api/chat', { method: 'POST', body: '{"a":1}' }, invoke);
    expect(invoke).toHaveBeenCalledWith('lan_http', { url: 'http://192.168.1.10:11434/api/chat', method: 'POST', body: '{"a":1}' });
    expect(r.ok).toBe(true);
    expect(await r.json()).toEqual({ models: [{ name: 'qwen' }] });
    await expect(androidLanFetch('http://8.8.8.8/', {}, invoke)).rejects.toBeInstanceOf(TypeError);
    await expect(androidLanFetch('http://10.0.0.2/', { method: 'PUT' }, invoke)).rejects.toBeInstanceOf(TypeError);
    expect(invoke).toHaveBeenCalledTimes(1);
    const cancelled = vi.fn(async (..._a: unknown[]) => { throw 'Отменено пользователем'; });
    await expect(androidLanFetch('http://10.0.0.2/', { method: 'POST', body: '{}' }, cancelled)).rejects.toThrow(/Отменено/);
  });

  it('the page patches fetch, print and clipboard on Android only', () => {
    const files = read('src/services/AndroidFiles.ts');
    expect(files).toContain('window.fetch =');
    expect(files).toContain('w.print = ');
    expect(files).toContain("'writeText'");
    expect(files).toContain('if (installed || !isAndroidApp()');
  });
});

describe('phone contacts', () => {
  it('reads only names and phones, with limits', async () => {
    setAndroid(vi.fn(async () => ({ contacts: [
      { id: 1, name: 'Мама', phones: ['+7 999 000-00-00', 5] },
      { id: 2, name: '' },
      'junk',
    ] })));
    expect(await androidListContacts()).toEqual([{ id: '1', name: 'Мама', phones: ['+7 999 000-00-00'] }]);
  });
});

describe('on-device speech model (GigaAM) on the phone', () => {
  it('sends 16-bit audio at 16 kHz', async () => {
    const invoke = vi.fn(async (..._a: unknown[]) => 'три пять семь' as unknown);
    setAndroid(invoke);
    expect(await localTranscribe(new Float32Array([0, 0.5, -1, 2]), 16000)).toBe('три пять семь');
    const [cmd, args] = invoke.mock.calls[0] as [string, { pcm16: string; sampleRate: number }];
    expect(cmd).toBe('local_stt_transcribe');
    expect(args.sampleRate).toBe(16000);
    const bin = atob(args.pcm16);
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    expect([0, 1, 2, 3].map(i => v.getInt16(i * 2, true))).toEqual([0, 16384, -32768, 32767]);
  });

  it('downsamples 48 kHz to 16 kHz', () => {
    const r = to16k(new Float32Array(4800).fill(0.25), 48000);
    expect(r.sampleRate).toBe(16000);
    expect(r.pcm.length).toBe(1600);
    expect(r.pcm[100]).toBeCloseTo(0.25);
    expect(pcm16Base64(new Float32Array(0))).toBe('');
  });
});

describe('voice on the phone', () => {
  it('knows when the phone itself is speaking', async () => {
    let finish: (() => void) | null = null;
    const invoke = vi.fn((cmd: string) => (cmd === 'tts_speak' ? new Promise<null>(r => { finish = () => r(null); }) : Promise.resolve(null)));
    setAndroid(invoke);
    expect(speakingNow()).toBe(false);
    const done = new Promise<void>(r => speakText('Привет', { force: true, onEnd: () => r() }));
    expect(speakingNow()).toBe(true);
    for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
    expect(finish).toBeTruthy();
    finish!();
    await done;
    expect(speakingNow()).toBe(true); // короткий хвост: микрофон не ловит конец своей фразы
  });

  it('without a model or a key the recorded listener refuses (no silent fallback)', () => {
    setAndroid(vi.fn(async () => null));
    expect(recordedRecognizer()).toBeNull();
    const errors: string[] = [];
    expect(listenRecorded({ onFinal: () => undefined, onError: m => errors.push(m) })).toBeNull();
    expect(errors[0]).toMatch(/модель|Groq/);
  });

  it('voice commands go through the owner check on the phone once the voice is enrolled', () => {
    const avatar = read('src/components/Avatar.tsx');
    expect(avatar).toContain('if (isAndroidApp() && !verifiedVoiceReady()) return listen(opts);');
    expect(avatar).toContain('phoneVerified');
    expect(read('src/services/voice/VoiceGuard.ts')).toContain('isAndroidApp() ? listenRecorded(o) : listen(o)');
    const button = read('src/components/VoiceButton.tsx');
    expect(button).toContain('<VoiceEnroll />');
    expect(button).not.toMatch(/android \? \(/);
  });
});

describe('native parts for the same features', () => {
  it('the bridge has every command', () => {
    const bridge = read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt');
    for (const c of ['print_html', 'clipboard_set', 'contacts_list', 'lan_http', 'local_stt_status', 'local_stt_install', 'local_stt_remove', 'local_stt_transcribe']) {
      expect({ c, found: bridge.includes(`"${c}"`) }).toEqual({ c, found: true });
    }
    expect(bridge).toContain('LanHttp.forgetAll');
    expect(read('android-hands/app/src/main/AndroidManifest.xml')).toContain('android.permission.READ_CONTACTS');
    expect(read('android-hands/app/build.gradle.kts')).toContain('onnxruntime-android');
  });
});
