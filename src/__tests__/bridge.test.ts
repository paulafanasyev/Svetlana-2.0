// Tests for the Svetlana-home HTTP bridge client (HTTPHands + read_contacts tool), protocol v2.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HTTPHands } from '../services/HTTPHands';
import { handsManager } from '../services/HandsManager';
import { readContactsTool } from '../services/RealTools';
import { deriveBridgeKey, sealRequest, requestAad, responseAad, validateBridgeEndpoint, BAD_REPLY } from '../services/security/BridgeCrypto';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const SALT = 'AAECAwQFBgcICQoLDA0ODw==';

function json(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Phone emulator: speaks protocol v2 exactly like BridgeSecure.kt. */
function fakePhone(code: string, routes: Record<string, unknown>, opts: { legacy?: boolean; impostor?: boolean } = {}) {
  const keyP = deriveBridgeKey(code, SALT);
  const seen = new Set<string>();
  const log: { url: string; body?: string; headers?: any; plain?: any }[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const entry: { url: string; body?: string; headers?: any; plain?: any } = { url, body: init.body as string, headers: init.headers };
    log.push(entry);
    if (url.endsWith('/health')) return json(opts.legacy ? { ok: true, service: 'svetlana-home' } : { ok: true, service: 'svetlana-home', v: 2, salt: SALT });
    const route = url.split('/api/')[1];
    const o = JSON.parse(String(init.body));
    if (o.v !== 2) return json({ success: false, error: 'UPGRADE_REQUIRED', message: 'upgrade' }, 426);
    if (seen.has(o.nonce)) return json({ success: false, error: 'REPLAY', message: 'Повтор запроса отклонён' }, 409);
    const key = await keyP;
    let plain: string;
    try {
      plain = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: enc.encode(requestAad(route, o.ts, o.nonce)) }, key, unb64(o.ct)));
    } catch {
      return json({ success: false, error: 'UNAUTHORIZED', message: 'Неверный код подключения' }, 401);
    }
    seen.add(o.nonce);
    entry.plain = JSON.parse(plain);
    const reply = JSON.stringify({ success: true, data: routes[route] ?? null, timestamp: 1 });
    const sealKey = opts.impostor ? await deriveBridgeKey('ZZZZ-ZZZZ', SALT) : key;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(responseAad(route, o.nonce)) }, sealKey, enc.encode(reply)));
    return json({ v: 2, iv: b64(iv), ct: b64(ct) });
  };
  return { fetchImpl, log };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HTTPHands ↔ Svetlana-home bridge (protocol v2)', () => {
  it('never sends the pairing code and encrypts every request', async () => {
    const phone = fakePhone('ABCD-EFGH', { 'device/info': { platform: 'android', model: 'POCO X3' } });
    vi.stubGlobal('fetch', phone.fetchImpl);
    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080/', token: 'ABCD-EFGH' });
    await hands.connect();

    expect(phone.log[0].url).toBe('http://192.168.1.20:8080/health');
    expect(phone.log[1].url).toBe('http://192.168.1.20:8080/api/device/info');
    const wire = JSON.stringify(phone.log);
    expect(wire).not.toContain('ABCD');
    expect(wire).not.toContain('Bearer');
    expect(phone.log[1].body).not.toContain('params');
    expect(await hands.isConnected()).toBe(true);
  });

  it('reports a wrong pairing code and stays disconnected', async () => {
    vi.stubGlobal('fetch', fakePhone('ABCD-EFGH', {}).fetchImpl);
    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'WRON-GCOD' });
    await expect(hands.connect()).rejects.toThrow('Неверный код подключения');
    expect(await hands.isConnected()).toBe(false);
  });

  it('rejects a device that answers without the shared key (impostor on the Wi-Fi)', async () => {
    vi.stubGlobal('fetch', fakePhone('ABCD-EFGH', { 'device/info': { model: 'fake' } }, { impostor: true }).fetchImpl);
    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' });
    await expect(hands.connect()).rejects.toThrow(BAD_REPLY);
  });

  it('rejects unencrypted success replies and old phones', async () => {
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/health')
      ? json({ ok: true, service: 'svetlana-home', v: 2, salt: SALT })
      : json({ success: true, data: { model: 'plain' } }));
    await expect(new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' }).connect()).rejects.toThrow(BAD_REPLY);

    vi.stubGlobal('fetch', fakePhone('ABCD-EFGH', {}, { legacy: true }).fetchImpl);
    await expect(new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' }).connect()).rejects.toThrow('Обновите Svetlana-home');
  });

  it('a captured request cannot be replayed', async () => {
    const phone = fakePhone('ABCD-EFGH', { 'device/info': { model: 'X' } });
    vi.stubGlobal('fetch', phone.fetchImpl);
    await new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' }).connect();
    const replay = await phone.fetchImpl('http://192.168.1.20:8080/api/device/info', { method: 'POST', body: phone.log[1].body });
    expect(replay.status).toBe(409);
  });

  it('lists contacts with query and paging params', async () => {
    const phone = fakePhone('ABCD-EFGH', {
      'device/info': { platform: 'android' },
      'contacts/list': { total: 1, offset: 0, contacts: [{ id: '1', name: 'Анна', phones: ['+84 90 000 0000'] }] },
    });
    vi.stubGlobal('fetch', phone.fetchImpl);
    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' });
    await hands.connect();
    const page = await hands.listContacts({ query: 'Ан', limit: 50 });
    expect(page.total).toBe(1);
    expect(page.contacts[0].name).toBe('Анна');
    expect(phone.log[2].plain.params).toEqual({ query: 'Ан', limit: 50 });
  });

  it('accepts only home-network addresses', () => {
    expect(validateBridgeEndpoint('http://192.168.1.20:8080/')).toBe('http://192.168.1.20:8080');
    expect(validateBridgeEndpoint('http://10.0.0.5:8080')).toBe('http://10.0.0.5:8080');
    expect(() => validateBridgeEndpoint('http://8.8.8.8:8080')).toThrow();
    expect(() => validateBridgeEndpoint('http://evil.com:8080')).toThrow();
    expect(() => validateBridgeEndpoint('http://user@192.168.1.20:8080')).toThrow();
    expect(() => validateBridgeEndpoint('http://172.32.0.1:8080')).toThrow();
    expect(() => new HTTPHands({ transport: 'http', endpoint: 'http://1.2.3.4:8080', token: 'ABCD-EFGH' })).toThrow();
  });

  it('matches the Kotlin test vector byte for byte', async () => {
    const key = await deriveBridgeKey('ABCD-EFGH', SALT);
    const r = await sealRequest(key, 'device/info', '{"params":{}}', { ts: 1760000000000, nonce: new Uint8Array(16).fill(7), iv: new Uint8Array(12).fill(9) });
    expect(r.body).toBe('{"v":2,"ts":1760000000000,"nonce":"BwcHBwcHBwcHBwcHBwcHBw==","iv":"CQkJCQkJCQkJCQkJ","ct":"w/IG3LsfvEi6pZsEIe/f2V9TnyBoZPuJl/Tm8DY="}');
  });

  it('refuses unencrypted WebSocket to the phone', async () => {
    await expect(handsManager.connect({ transport: 'websocket', endpoint: 'ws://192.168.1.20:8080', token: 'ABCD-EFGH' })).rejects.toThrow('WebSocket');
  });
});

describe('read_contacts tool', () => {
  it('returns contacts from the connected phone', async () => {
    vi.stubGlobal('fetch', fakePhone('ABCD-EFGH', {
      'device/info': { platform: 'android' },
      'contacts/list': { total: 2, offset: 0, contacts: [
        { id: '1', name: 'Анна', phones: ['1'] },
        { id: '2', name: 'Борис', phones: ['2', '3'] },
      ] },
    }).fetchImpl);
    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' });
    await hands.connect();
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue(hands);

    const result = await readContactsTool.execute({});
    expect(result.success).toBe(true);
    expect(result.data.count).toBe(2);
    expect(await readContactsTool.verify!({}, result)).toBe(true);
  });

  it('explains when the connected device is not the Svetlana-home bridge', async () => {
    vi.spyOn(handsManager, 'isConnected').mockResolvedValue(true);
    vi.spyOn(handsManager, 'getHands').mockReturnValue({} as any);
    const result = await readContactsTool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Svetlana-home');
  });

  it('is unavailable without a connection', async () => {
    expect(await readContactsTool.isAvailable()).toBe(false);
  });
});
