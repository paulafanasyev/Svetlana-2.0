import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../platform', () => ({ isAndroidApp: () => false, isWindowsApp: () => true }));

import { localTranscribe, finitePcm, LOCAL_STT_TIMEOUT_TEXT, LOCAL_STT_BAD_AUDIO } from '../services/voice/LocalStt';

const g = globalThis as any;
afterEach(() => { delete g.__TAURI_INTERNALS__; });

describe('localTranscribe', () => {
  it('зависшая нативная часть даёт понятную ошибку, а не вечное ожидание', async () => {
    g.__TAURI_INTERNALS__ = { invoke: () => new Promise(() => undefined) };
    await expect(localTranscribe(new Float32Array(10), 16000, 20)).rejects.toThrow(LOCAL_STT_TIMEOUT_TEXT);
  });

  it('запись с NaN не уходит в нативную часть', async () => {
    const invoke = vi.fn(async () => 'x');
    g.__TAURI_INTERNALS__ = { invoke };
    const pcm = new Float32Array([0, Number.NaN, 0.1]);
    await expect(localTranscribe(pcm, 16000)).rejects.toThrow(LOCAL_STT_BAD_AUDIO);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('обычная запись распознаётся', async () => {
    g.__TAURI_INTERNALS__ = { invoke: async () => 'привет' };
    expect(await localTranscribe(new Float32Array(10), 16000)).toBe('привет');
  });

  it('finitePcm', () => {
    expect(finitePcm(new Float32Array([0, 1, -1]))).toBe(true);
    expect(finitePcm(new Float32Array([Infinity]))).toBe(false);
  });
});
