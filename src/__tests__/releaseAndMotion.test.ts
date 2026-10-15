import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync, existsSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

describe('avatar respects «reduce motion»', () => {
  const avatar = read('src/components/Avatar.tsx');
  it('no looping animations when the system asks for less motion', () => {
    expect(avatar).toContain('useReducedMotion');
    expect(avatar).toContain('const pulse = !still && overlay.animation');
    expect(avatar).toContain('animate={still ? { opacity: 0.5 } : { opacity: [0.3, 0.6, 0.3] }}');
    expect(avatar).toContain('{isListening && !still && (');
  });
});

describe('release and emulator workflows (mirrors for .github/workflows)', () => {
  const win = read('ci/workflows/build-windows.yml');
  const apk = read('ci/workflows/svetlana-android.yml');
  const emu = read('ci/workflows/svetlana-android-emulator.yml');

  it('every action is pinned to a full commit SHA', () => {
    for (const [name, text] of Object.entries({ win, apk, emu })) {
      const uses = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map(m => m[1]);
      expect(uses.length, name).toBeGreaterThan(0);
      for (const u of uses) expect({ name, u, pinned: /@[0-9a-f]{40}$/.test(u) }).toEqual({ name, u, pinned: true });
    }
  });

  it('only the publish job can write, and only on push to the main branches', () => {
    for (const text of [win, apk]) {
      expect(text).toMatch(/^permissions:\n  contents: read/m);
      expect(text).toMatch(/  release:\n[\s\S]*permissions:\n      contents: write/);
      expect(text).toContain("github.event_name == 'push' && (github.ref == 'refs/heads/svetlana-2.0-core-development-0416c' || github.ref == 'refs/heads/main')");
    }
    expect(emu).not.toContain('contents: write');
  });

  it('both publish jobs share one queue and one version, so they never race on the tag', () => {
    for (const text of [win, apk]) {
      expect(text).toMatch(/  release:\n[\s\S]*concurrency:\n      group: svetlana-release-\$\{\{ github\.ref \}\}\n      cancel-in-progress: false/);
      expect(text).toContain("require('./src-tauri/tauri.conf.json').version");
    }
  });

  it('publishes the same file names the site links to', () => {
    expect(win).toContain('Svetlana-2.0-Windows-setup.exe');
    expect(apk).toContain('Svetlana-2.0-Android.apk');
  });

  it('clippy runs on Windows, as a warning for now', () => {
    expect(win).toContain('cargo clippy --locked');
    expect(win).toMatch(/name: Clippy[\s\S]{0,80}continue-on-error: true/);
  });

  it('the emulator runs the smoke script from the repo', () => {
    expect(emu).toContain('bash android-hands/scripts/emulator-smoke.sh');
    expect(existsSync(resolve('android-hands/scripts/emulator-smoke.sh'))).toBe(true);
  });

  it('the release key never lives in git', () => {
    const gradle = read('android-hands/app/build.gradle.kts');
    expect(gradle).toContain('System.getenv("SVETLANA_KEYSTORE")');
    expect(apk).toContain('secrets.SVETLANA_KEYSTORE_B64');
  });
});
