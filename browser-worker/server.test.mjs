import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('worker refuses to start without a strong bearer token', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "process.env.SVETLANA_BROWSER_TOKEN='short'; await import('./server.mjs')"],
    { cwd: new URL('.', import.meta.url), encoding: 'utf8', timeout: 3000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /SVETLANA_BROWSER_TOKEN/);
});

test('worker binds to loopback only', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "process.env.SVETLANA_BROWSER_TOKEN='x'.repeat(40); process.env.SVETLANA_BROWSER_HOST='0.0.0.0'; await import('./server.mjs')"],
    { cwd: new URL('.', import.meta.url), encoding: 'utf8', timeout: 3000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /loopback only/);
});
