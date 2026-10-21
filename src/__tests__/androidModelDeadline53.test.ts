// Пачка 53: загрузка модели распознавания в Android ограничена общим сроком (медленный сервер не держит её вечно).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, '../../android-hands/app/src/main/java/ru/svetlana/app/LocalStt.kt'), 'utf8');

describe('android model download deadline', () => {
  it('has one overall deadline for the whole download', () => {
    expect(src).toContain('MAX_DOWNLOAD_MS = 60L * 60 * 1000');
    expect(src).toContain('val deadline = System.currentTimeMillis() + MAX_DOWNLOAD_MS');
    expect(src).toContain('const val DOWNLOAD_TIMEOUT');
  });
  it('caps every read by the time left and reports the timeout plainly', () => {
    expect(src).toContain('conn.readTimeout = min(READ_TIMEOUT_MS, timeLeft(deadline)).toInt()');
    expect(src).toContain('conn.connectTimeout = min(20_000L, left).toInt()');
    expect(src).toMatch(/if \(System\.currentTimeMillis\(\) >= deadline\) throw SecureAi\.Fail\(DOWNLOAD_TIMEOUT\)/);
  });
  it('keeps the existing safety checks', () => {
    expect(src).toContain('allowedHost(url.host.lowercase())');
    expect(src).toContain('MODEL_SHA256');
    expect(src).toContain('if (cancel) throw SecureAi.Fail(INSTALL_STOPPED)');
  });
});
