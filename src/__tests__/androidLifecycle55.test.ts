// Пачка 55: Android. В фоне распознавание отменяется (а не дослушивается), очередь моста ограничена,
// зависшая озвучка завершается сторожем.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dir = resolve(__dirname, '../../android-hands/app/src/main/java/ru/svetlana/app');
const voice = readFileSync(resolve(dir, 'NativeVoice.kt'), 'utf8');
const bridge = readFileSync(resolve(dir, 'Bridge.kt'), 'utf8');

describe('android lifecycle and limits', () => {
  it('pause cancels recognition instead of finishing it', () => {
    expect(voice).toMatch(/\n    fun cancelListening\(\) \{[\s\S]*?recognizer\?\.cancel\(\)[\s\S]*?d\?\.invoke\(true, ""\)/);
    expect(bridge).toContain('runCatching { voice.cancelListening() }');
    expect(bridge).not.toMatch(/fun pause\(\) \{\s*runCatching \{ voice\.stopListening/);
  });

  it('bridge work has a bounded queue and answers busy when full', () => {
    expect(bridge).not.toContain('Executors.newFixedThreadPool');
    expect(bridge).toContain('ThreadPoolExecutor(4, 4, 30L, TimeUnit.SECONDS, ArrayBlockingQueue(MAX_QUEUED))');
    expect(bridge).toMatch(/catch \(e: RejectedExecutionException\) \{\s*done\(false, BUSY\)/);
  });

  it('a stalled text-to-speech engine cannot hang the page', () => {
    expect(voice).toContain('act.main.postDelayed(watch, SPEAK_BASE_MS + clean.length * SPEAK_PER_CHAR_MS)');
    expect(voice).toMatch(/private fun finish\(id: String\?\) \{[\s\S]*?clearWatch\(id\)/);
    expect(voice).toMatch(/private fun releaseSpeaking\(\) \{\s*speakWatch\.values\.forEach/);
  });
});
