// Всё, что есть на сайте и в Windows, работает и в приложении для Android: домашняя сеть (Ollama/LM Studio
// на компьютере, Svetlana-home), контакты, печать, копирование, распознавание речи на устройстве, голос.
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';
import { isLanUrl, androidLanFetch, androidListContacts, fetchRoute, lanInitFrom, userJustActed } from '../services/AndroidFiles';
import { localTranscribe, pcm16Base64, to16k } from '../services/voice/LocalStt';
import { speakText, speakingNow } from '../services/voice/Tts';
import { recordedRecognizer, listenRecorded } from '../services/voice/SpeechEngine';
import { createVoiceGuard, type GuardDeps } from '../services/voice/VoiceGuard';
import { makeChallenge, VoiceLockout, VoiceTrust } from '../services/voice/Liveness';
import type { VoiceTemplate } from '../services/voice/VoicePrint';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const g = globalThis as any;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

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

  it('the page may fetch only https, blob/data and the home network', () => {
    expect(fetchRoute('/images/a.png')).toBe('web');
    expect(fetchRoute('https://api.groq.com/openai/v1')).toBe('web');
    expect(fetchRoute('data:text/plain,hi')).toBe('web');
    expect(fetchRoute('http://192.168.1.10:11434/api/tags')).toBe('lan');
    for (const u of ['http://8.8.8.8/', 'http://example.com/', 'file:///sdcard/a.txt', 'content://contacts/people', 'ftp://10.0.0.1/']) {
      expect({ u, route: fetchRoute(u) }).toEqual({ u, route: null });
    }
  });

  it('fetch(Request) keeps the method and the body', async () => {
    const req = new Request('http://192.168.1.10:11434/api/chat', { method: 'POST', body: '{"model":"qwen"}' });
    const init = await lanInitFrom(req);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"model":"qwen"}');
    expect((await lanInitFrom(new Request('http://10.0.0.2/api/tags'))).body).toBeNull();
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

  it('copying needs a real tap, in the page and in the native part', () => {
    expect(userJustActed()).toBe(false); // нет нажатия — нет копирования
    const bridge = read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt');
    expect(bridge).toContain('!act.touchedRecently() ->');
    const main = read('android-hands/app/src/main/java/ru/svetlana/app/MainActivity.kt');
    expect(main).toContain('FLAG_WINDOW_IS_OBSCURED');
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
  it('sends 16-bit audio as is (the native part resamples, like Windows)', async () => {
    const invoke = vi.fn(async (..._a: unknown[]) => 'три пять семь' as unknown);
    setAndroid(invoke);
    expect(await localTranscribe(new Float32Array([0, 0.5, -1, 2]), 48000)).toBe('три пять семь');
    const [cmd, args] = invoke.mock.calls[0] as [string, { pcm16: string; sampleRate: number }];
    expect(cmd).toBe('local_stt_transcribe');
    expect(args.sampleRate).toBe(48000);
    const bin = atob(args.pcm16);
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    expect([0, 1, 2, 3].map(i => v.getInt16(i * 2, true))).toEqual([0, 16384, -32768, 32767]);
  });

  it('keeps at most 15 seconds, like the native part', async () => {
    const invoke = vi.fn(async (..._a: unknown[]) => '' as unknown);
    setAndroid(invoke);
    await localTranscribe(new Float32Array(16000 * 20), 16000);
    const [, args] = invoke.mock.calls[0] as [string, { pcm16: string; sampleRate: number }];
    expect(atob(args.pcm16).length).toBe(16000 * 15 * 2);
  });

  it('downsamples very high rates to 16 kHz', () => {
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

  it('the voice is checked on the very audio the text was recognized from (one microphone)', async () => {
    const TPL: VoiceTemplate = { version: 1, mean: [0], sd: [1], distThreshold: 1.5, samples: 5, createdAt: 1 };
    const run = (level: number) => {
      let captures = 0;
      const spoken: string[] = [];
      const events: string[] = [];
      const store = new Map<string, string>();
      const deps: GuardDeps = {
        listen: o => {
          queueMicrotask(() => { o.onAudio?.(new Float32Array([level]), 16000); o.onFinal('выставь счёт'); o.onEnd?.(); });
          return { mode: 'local', stop: () => undefined };
        },
        listenGivesAudio: () => true,
        startCapture: async () => { captures++; return { take: () => ({ pcm: new Float32Array([0]), sampleRate: 16000 }), stop: () => undefined }; },
        speak: t => { spoken.push(t); },
        stopSpeaking: () => undefined,
        loadTemplate: () => TPL,
        computePrint: pcm => ({ v: [pcm[0]], frames: 50 }),
        verify: (p, t) => (p.v[0] <= t.distThreshold ? { ok: true, score: p.v[0] } : { ok: false, score: p.v[0], reason: 'чужой' }),
        generate: () => makeChallenge([7, 4, 2]),
        cloudTranscribe: () => null,
        localTranscribe: () => async () => '742',
        trust: new VoiceTrust(120_000, 600_000, () => 0),
        lockout: new VoiceLockout({ getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } }, () => 1_000_000),
        setTimeout: () => 0,
        clearTimeout: () => undefined,
      };
      createVoiceGuard(deps)({ onFinal: t => events.push('RUN ' + t), onError: m => events.push('ERR ' + m), onEnd: () => events.push('END') });
      return { captures: () => captures, spoken, events };
    };
    const owner = run(0.2);
    await flush();
    expect(owner.captures()).toBe(0);            // вторая запись для фразы не открывалась
    expect(owner.spoken[0]).toContain('цифры'); // голос узнан — дальше проверка цифрами
    const stranger = run(9);
    await flush();
    expect(stranger.captures()).toBe(0);
    expect(stranger.spoken).toEqual([]);
    expect(stranger.events).toEqual(['ERR чужой', 'END']);
  });

  it('voice commands go through the owner check on the phone once the voice is enrolled', () => {
    const avatar = read('src/components/Avatar.tsx');
    expect(avatar).toContain('if (isAndroidApp() && !verifiedVoiceReady()) return listen(opts);');
    expect(avatar).toContain('phoneVerified');
    const guard = read('src/services/voice/VoiceGuard.ts');
    expect(guard).toContain('isAndroidApp() ? listenRecorded(o) : listen(o)');
    expect(guard).toContain('listenGivesAudio: () => isAndroidApp()');
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
    const lan = read('android-hands/app/src/main/java/ru/svetlana/app/LanHttp.kt');
    expect(lan).toContain('MAX_RESPONSE = 8 * 1024 * 1024');
    expect(lan).toContain('toLongOrNull(16)');
  });
});
