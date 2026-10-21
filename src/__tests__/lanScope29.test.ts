// Пачка 29: разрешение домашней сети на Android выдаётся на устройство и раздел API, а не на всё устройство сразу.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const lan = readFileSync(resolve(__dirname, '../../android-hands/app/src/main/java/ru/svetlana/app/LanHttp.kt'), 'utf8');

describe('android LAN approval scope', () => {
  it('the approval key is device plus API section', () => {
    expect(lan).toContain('val key: String get() = "$hostPort$scope"');
    expect(lan).toContain("substringBefore('?').trimStart('/').substringBefore('/')");
    expect(lan).toContain('allowed(ctx, t.key)');
    expect(lan).toContain('allow(ctx, t.key)');
  });

  it('dot segments and encoded dots or slashes are refused', () => {
    expect(lan).toContain('DOT_SEGMENT.containsMatchIn(path)');
    for (const s of ['%2e', '%2f', '%5c']) expect(lan).toContain(`low.contains("${s}")`);
  });

  it('the Host header is the device, not the approval key', () => {
    expect(lan).toContain('.append("Host: ").append(t.hostPort)');
  });
});
