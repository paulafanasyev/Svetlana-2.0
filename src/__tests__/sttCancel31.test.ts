// Пачка 31: загрузку модели речи (около 225 МБ) можно остановить в Windows и на Android; телефон отпускает модель,
// когда экран закрыт; приложение для Windows не падает с паникой при сбое запуска.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { localSttCancelInstall } from '../services/voice/LocalStt';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const g = globalThis as any;
afterEach(() => { delete g.__TAURI_INTERNALS__; delete g.__SVETLANA_PLATFORM__; });

describe('stopping the speech model download', () => {
  it('the page calls local_stt_cancel and reports whether a download was stopped', async () => {
    const invoke = vi.fn(async (cmd: string) => (cmd === 'local_stt_cancel' ? true : { installed: false, downloading: false }));
    g.__TAURI_INTERNALS__ = { invoke };
    g.__SVETLANA_PLATFORM__ = 'android';
    expect(await localSttCancelInstall()).toBe(true);
    expect(invoke).toHaveBeenCalledWith('local_stt_cancel');
  });

  it('Windows: the command exists, is registered and is checked on every chunk', () => {
    const rs = read('src-tauri/src/local_stt.rs');
    expect(rs).toContain('pub fn local_stt_cancel() -> bool');
    expect(rs).toContain('if CANCEL.load(Ordering::SeqCst) {');
    expect(read('src-tauri/src/main.rs')).toContain('local_stt::local_stt_cancel,');
    expect(read('src-tauri/src/main.rs')).not.toContain('.expect(');
  });

  it('Android: the bridge has the command, the connection is torn down, the model is released on close', () => {
    const kt = read('android-hands/app/src/main/java/ru/svetlana/app/LocalStt.kt');
    expect(kt).toContain('fun cancelInstall(): Boolean');
    expect(kt).toContain('runCatching { activeConn?.disconnect() }');
    expect(kt).toContain('if (cancel) throw SecureAi.Fail(INSTALL_STOPPED)');
    expect(kt).toContain('fun release()');
    const bridge = read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt');
    expect(bridge).toContain('"local_stt_cancel" -> done(true, LocalStt.cancelInstall())');
    expect(bridge).toContain('Thread { LocalStt.release() }');
  });

  it('the voice settings show a stop button while downloading', () => {
    const page = read('src/components/VoiceEnroll.tsx');
    expect(page).toContain('localSttCancelInstall');
    expect(page).toContain('Остановить загрузку');
  });
});
