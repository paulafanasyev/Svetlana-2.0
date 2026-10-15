import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(p), 'utf8');
const bridge = read('android-hands/app/src/main/java/ru/svetlana/app/Bridge.kt');
const main = read('android-hands/app/src/main/java/ru/svetlana/app/MainActivity.kt');

describe('speech model download on the phone', () => {
  it('runs once at a time on its own background thread', () => {
    expect(bridge).toContain('if (!installBusy.compareAndSet(false, true)) { done(false, INSTALL_BUSY); return }');
    expect(bridge).toContain('isDaemon = true');
    expect(bridge).toContain('installer.shutdown()');
    expect(bridge).not.toMatch(/"local_stt_install" -> Thread \{/);
  });

  it('the model is not removed while it is downloading', () => {
    expect(bridge).toMatch(/"local_stt_remove" -> \{\s*\/\/[^\n]*\n\s*if \(installBusy\.get\(\)\) done\(false, INSTALL_BUSY\)/);
  });
});

describe('printing on the phone', () => {
  it('frees the document WebView when the print window closes', () => {
    expect(main).toContain('private class ReleasingAdapter(');
    expect(main).toContain('ReleasingAdapter(view.createPrintDocumentAdapter(job)) { main.post { release() } }');
    expect(main).toMatch(/override fun onFinish\(\) \{\s*try \{\s*inner\.onFinish\(\)\s*\} finally \{\s*onFinished\(\)/);
  });

  it('one print window at a time, and a stuck document gives up', () => {
    expect(main).toContain('if (printView != null) { done(false, PRINT_BUSY); return }');
    expect(main).toContain('PRINT_LOAD_TIMEOUT_MS = 15_000L');
    expect(main).not.toContain('printView?.destroy()');
  });

  it('the print WebView is destroyed exactly once, also on app close', () => {
    expect(main).toContain('releasePrint = release');
    expect(main).toMatch(/override fun onDestroy\(\) \{[\s\S]*releasePrint\?\.invoke\(\)[\s\S]*super\.onDestroy\(\)/);
  });

  it('the print document stays locked down', () => {
    expect(main).toContain('ps.javaScriptEnabled = false');
    expect(main).toContain('ps.blockNetworkLoads = true');
  });
});
