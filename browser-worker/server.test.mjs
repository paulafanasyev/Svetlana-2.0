import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isPotentiallyConsequentialLink } from './browser-policy.mjs';

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


test('automatic link following is limited to navigation-only links', () => {
  assert.equal(isPotentiallyConsequentialLink('More information...', 'https://www.iana.org/domains/example'), false);
  assert.equal(isPotentiallyConsequentialLink('Cancel subscription', 'https://example.com/account'), true);
  assert.equal(isPotentiallyConsequentialLink('Click here', 'https://example.com/unsubscribe?token=one-time'), true);
  assert.equal(isPotentiallyConsequentialLink('More information', 'file:///etc/passwd'), true);
});
