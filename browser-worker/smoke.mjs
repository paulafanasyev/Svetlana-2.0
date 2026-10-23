import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = fileURLToPath(new URL('.', import.meta.url));
const token = randomBytes(32).toString('base64url');
const port = randomInt(31000, 48000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: here,
  env: {
    ...process.env,
    SVETLANA_BROWSER_HOST: '127.0.0.1',
    SVETLANA_BROWSER_PORT: String(port),
    SVETLANA_BROWSER_TOKEN: token,
    SVETLANA_BROWSER_ALLOWED_ORIGIN: '',
  },
  stdio: 'ignore',
});

async function request(path, { method = 'GET', body, auth = true, timeoutMs = 45_000 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

let sessionId;
try {
  let ready = false;
  for (let attempt = 0; attempt < 75; attempt++) {
    if (child.exitCode !== null) throw new Error('Browser Worker exited before readiness');
    try {
      const health = await request('/health', { auth: false, timeoutMs: 1500 });
      if (health.status === 200 && health.data.ok === true) { ready = true; break; }
    } catch { /* worker is still starting */ }
    await sleep(200);
  }
  assert.equal(ready, true, 'Browser Worker did not become ready');

  const unauthenticated = await request('/v1/status', { auth: false });
  assert.equal(unauthenticated.status, 401, 'API must reject missing bearer token');

  const status = await request('/v1/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.ok, true);

  const created = await request('/v1/sessions', { method: 'POST', body: { agentId: 'ci-smoke' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.isolated, true);
  sessionId = created.data.sessionId;

  const blank = await request(`/v1/sessions/${sessionId}/snapshot`, { method: 'POST', body: {} });
  assert.equal(blank.status, 200);
  assert.equal(blank.data.observation.url, 'about:blank');

  const navigated = await request(`/v1/sessions/${sessionId}/navigate`, {
    method: 'POST',
    body: { url: 'https://example.com' },
    timeoutMs: 60_000,
  });
  assert.equal(navigated.status, 200, JSON.stringify(navigated.data));
  assert.match(navigated.data.observation.title, /Example Domain/i);
  assert.match(navigated.data.observation.url, /^https:\/\/example\.com\/?$/i);

  const blocked = await request(`/v1/sessions/${sessionId}/navigate`, {
    method: 'POST',
    body: { url: `http://127.0.0.1:${port}/health` },
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /Private or reserved IP/i);

  const closed = await request(`/v1/sessions/${sessionId}`, { method: 'DELETE' });
  assert.equal(closed.status, 200);
  assert.equal(closed.data.closed, true);
  sessionId = undefined;
  console.log('PASS: authenticated Chromium session, navigation, observation, loopback block, cleanup');
} finally {
  if (sessionId) {
    try { await request(`/v1/sessions/${sessionId}`, { method: 'DELETE' }); } catch { /* best effort */ }
  }
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), sleep(2500)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
