// Android: микрофон распознавания телефона включается только по настоящему нажатию (как буфер обмена).
// Клавиатура и экранный диктор (TalkBack) тоже считаются нажатием: иначе незрячий не смог бы говорить.
import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const bridge = read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt');
const main = read('android-hands/app/src/main/java/ru/svetlana/app/MainActivity.kt');

describe('android microphone needs a real tap', () => {
  it('voice_listen is refused without a recent tap', () => {
    expect(bridge).toContain('"voice_listen" -> if (!act.touchedRecently()) done(false, LISTEN_TAP) else voice.listen(done)');
    expect(bridge).toContain('const val LISTEN_TAP =');
    // копирование по-прежнему только по нажатию
    expect(bridge).toContain('!act.touchedRecently() ->');
  });

  it('keyboard and TalkBack count as a tap, an overlay window does not', () => {
    expect(main).toContain('FLAG_WINDOW_IS_OBSCURED');
    expect(main).toContain('override fun dispatchKeyEvent(ev: KeyEvent): Boolean');
    expect(main).toContain('KeyEvent.KEYCODE_ENTER');
    expect(main).toContain('isTouchExplorationEnabled');
    expect(main).toContain('return ok || screenReaderOn()');
  });

  it('the page calls the microphone only from a button press', () => {
    const engine = read('src/services/voice/SpeechEngine.ts');
    expect(engine).toContain('if (isAndroidApp()) return listenNative({ ...opts, continuous: false });');
    const avatar = read('src/components/Avatar.tsx');
    // без записанного голоса режима «без рук» на телефоне нет: слушает только кнопка
    expect(avatar).toContain('((support.web && !android) || phoneVerified)');
  });
});
