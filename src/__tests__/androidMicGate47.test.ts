// Android: микрофон страницы (WebView getUserMedia) не включается в фоне, а первый раз за запуск только по нажатию.
// Ушли с экрана: распознавание телефона прерывается, старое нажатие не действует.
import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const main = read('android-hands/app/src/main/java/ru/svetlana/app/MainActivity.kt');
const bridge = read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt');

describe('page microphone on the phone', () => {
  it('is denied in the background and without a first tap', () => {
    expect(main).toContain('if (!resumed || !(micSession || activatedRecently())) {');
    expect(main).toContain('micSession = true');
    expect(main).toMatch(/override fun onResume\(\) \{[\s\S]*?resumed = true/);
  });

  it('the tap check for the microphone does not use up the tap', () => {
    expect(main).toMatch(/private fun activatedRecently\(\): Boolean \{[\s\S]*?return t > 0/);
    expect(main).toMatch(/fun touchedRecently\(\): Boolean \{\s*val ok = activatedRecently\(\)\s*if \(ok\) lastTouchAt = 0L\s*return ok\s*\}/);
  });
});

describe('leaving the screen', () => {
  it('stops phone listening and forgets the last tap', () => {
    expect(main).toMatch(/override fun onPause\(\) \{\s*resumed = false[\s\S]*?lastTouchAt = 0L\s*bridge\?\.pause\(\)/);
    expect(bridge).toMatch(/fun pause\(\) \{\s*runCatching \{ voice\.stopListening\(\) \}/);
  });
});
