import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const wf = readFileSync(resolve('ci/workflows/svetlana-android-keygen.yml'), 'utf8');

describe('Android signing key generator workflow', () => {
  it('runs only by hand, with a typed confirmation, on the main branches', () => {
    expect(wf).toMatch(/^on:\n  workflow_dispatch:\n/m);
    expect(wf).not.toMatch(/^  (push|pull_request|schedule):/m);
    expect(wf).toContain('[ "$CONFIRM" != "СОЗДАТЬ" ]');
    expect(wf).toContain("github.ref == 'refs/heads/svetlana-2.0-core-development-0416c'");
  });

  it('never writes to the repo and never checks out code', () => {
    expect(wf).toMatch(/^permissions:\n  contents: read/m);
    expect(wf).not.toContain('contents: write');
    expect(wf).not.toContain('actions/checkout');
  });

  it('refuses to replace an existing key and needs a strong archive password', () => {
    expect(wf).toContain('EXISTING_KEY: ${{ secrets.SVETLANA_KEYSTORE_B64 }}');
    expect(wf).toContain('if [ -n "$EXISTING_KEY" ]; then');
    expect(wf).toMatch(/wc -m\)" -lt 20/);
  });

  it('the key leaves the runner only encrypted, with hidden file names, for one day', () => {
    expect(wf).toContain('7z a -t7z -mhe=on');
    expect(wf).toContain('-p"$PASSPHRASE"');
    expect(wf).toContain('7z t -p"$PASSPHRASE"');
    expect(wf).toContain('shred -u');
    expect(wf).toContain('echo "::add-mask::$store_pass"');
    expect(wf).toMatch(/path: out\/svetlana-android-key\.7z\n[\s\S]{0,60}retention-days: 1\n/);
    // пароль хранилища никогда не печатается в лог
    expect(wf).not.toMatch(/echo "\$store_pass"/);
  });

  it('every action is pinned to a full commit SHA', () => {
    const uses = [...wf.matchAll(/uses:\s*([^\s#]+)/g)].map(m => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});
