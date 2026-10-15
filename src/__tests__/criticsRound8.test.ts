import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

/** Текст триггера (push: / pull_request:) до следующего ключа того же уровня. */
function triggerSection(wf: string, trigger: string): string {
  const marker = `\n  ${trigger}\n`;
  const start = wf.indexOf(marker);
  if (start < 0) return '';
  const rest = wf.slice(start + marker.length);
  const end = rest.search(/\n(  [a-z_]+:|[a-z_]+:)/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('critics round 8', () => {
  const apk = read('ci/workflows/svetlana-android.yml');
  const emu = read('ci/workflows/svetlana-android-emulator.yml');

  it('a debug APK never reaches Releases: publish only a signed build', () => {
    expect(apk).toContain("needs.build.outputs.signed == 'true'");
    expect(apk).toContain('signed: ${{ steps.sign.outputs.signed }}');
    const releaseJob = apk.slice(apk.indexOf('\n  release:'));
    expect(releaseJob).not.toContain('apk/debug');
    expect(apk).not.toMatch(/cp [^\n]*apk\/debug[^\n]*release-apk/);
  });

  it('Android builds and the emulator run for every input of the bundled web app', () => {
    const inputs = ['android-hands/**', 'src/**', 'public/**', 'index.html', 'package.json', 'package-lock.json', 'vite.config.*', 'csp.mjs', 'src-tauri/tauri.conf.json'];
    for (const [name, wf] of Object.entries({ apk, emu })) {
      for (const trigger of ['push:', 'pull_request:']) {
        const section = triggerSection(wf, trigger);
        expect(section.length, `${name} ${trigger}`).toBeGreaterThan(0);
        for (const p of inputs) expect({ name, trigger, p, has: section.includes(`"${p}"`) }).toEqual({ name, trigger, p, has: true });
      }
    }
  });

  it('the smoke test fails if it cannot read the screen or the app is not in front', () => {
    const smoke = read('android-hands/scripts/emulator-smoke.sh');
    expect(smoke).toContain('if [ "$dumped" != 1 ]; then');
    expect(smoke).toContain('grep -q "package=\\"$PKG\\"" "$OUT/ui.xml"');
    expect(smoke).not.toContain('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true');
    expect(emu).toContain(`grep -q 'package="ru.svetlana.app"' smoke/ui.xml`);
  });

  it('Android version comes from the same tauri.conf.json as the release tag', () => {
    const gradle = read('android-hands/app/build.gradle.kts');
    expect(gradle).toContain('File(repoRoot, "src-tauri/tauri.conf.json")');
    expect(gradle).toContain('versionCode = appVersionCode');
    expect(gradle).toContain('versionName = appVersion');
    expect(gradle).not.toMatch(/versionCode = \d+/);
    const version: string = JSON.parse(read('src-tauri/tauri.conf.json')).version;
    const [a, b, c] = version.split('.').map(Number);
    expect(a * 10000 + b * 100 + c).toBeGreaterThan(210); // выше уже выпущенного versionCode
  });

  it('reduced motion also covers the emotion controls entrance', () => {
    const avatar = read('src/components/Avatar.tsx');
    expect(avatar).toContain('initial={still ? false : { opacity: 0, y: 10 }}');
    expect(avatar).toContain('animate={still ? { opacity: 1 } : { opacity: 1, y: 0 }}');
  });
});
