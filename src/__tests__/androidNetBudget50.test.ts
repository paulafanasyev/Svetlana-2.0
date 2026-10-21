// Android: один общий срок 150 с на весь запрос к облаку, как NET_BUDGET в secure_ai.rs (Windows).
import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const kt = readFileSync(resolve('android-hands/app/src/main/java/ru/svetlana/app/SecureAi.kt'), 'utf8');
const rs = readFileSync(resolve('src-tauri/src/secure_ai.rs'), 'utf8');

describe('cloud request budget on the phone', () => {
  it('is 150 seconds, the same as on Windows', () => {
    expect(kt).toContain('const val NET_BUDGET_MS = 150_000L');
    expect(rs).toMatch(/NET_BUDGET[^\n]*150/);
  });

  it('starts after the confirmation and covers every step', () => {
    expect(kt).toMatch(/val deadline = now\(\) \+ NET_BUDGET_MS\s*if \(p == CUSTOM\) return postCustom\([^\n]*deadline\)\s*return post\([^\n]*deadline\)/);
    expect(kt).toContain('private fun gigachatToken(key: String, gen: Long, deadline: Long): String');
    expect(kt).toContain('exchange(GIGACHAT_CHAT, headers, body, gen, MAX_RESPONSE, deadline)');
  });

  it('timeouts never exceed what is left, and a watchdog cuts a trickling answer', () => {
    expect(kt).toContain('c.readTimeout = minOf(120_000L, left)');
    expect(kt).toContain('watchdog.schedule({ runCatching { c.disconnect() } }, left, TimeUnit.MILLISECONDS)');
    expect(kt).toContain('guard.cancel(false)');
    expect(kt).toContain('if (now() >= deadline) throw Fail(NET_TIMEOUT)');
  });
});
