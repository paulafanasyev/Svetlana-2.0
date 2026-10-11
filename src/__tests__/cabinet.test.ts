// Личный кабинет: привязка по коду, пульс по белому списку, отключение, удаление всех данных.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { normalizeLinkCode, assertCabinetOrigin, linkDevice, sendHeartbeat, collectHeartbeat, loadMeta, unlinkLocal, CABINET_ORIGINS } from '../services/cabinet/CabinetClient';
import { getSecret, setSecret, clearAllSecrets, __setKeyProviderForTests } from '../services/security/SecretStore';
import { wipeAllLocalData } from '../services/security/WipeAll';
import { getDadataKey } from '../services/biz/Counterparty';

function kv(init: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(init));
  return {
    m,
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
const TOKEN = 'A'.repeat(43);
function fakeFetch(handler: (url: string, init: any) => { status: number; body?: unknown }) {
  const calls: { url: string; init: any }[] = [];
  const f = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  };
  return { f, calls };
}
const testKey = () => globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;

describe('cabinet link code', () => {
  it('normalizes case, spaces and dashes', () => {
    expect(normalizeLinkCode(' abcd efgh-jkmn ')).toBe('ABCD-EFGH-JKMN');
  });
  it('rejects wrong length and ambiguous symbols', () => {
    expect(() => normalizeLinkCode('ABCD-EFGH')).toThrow();
    expect(() => normalizeLinkCode('ABCD-EFGH-IJK0')).toThrow();
    expect(() => normalizeLinkCode('<script>alert(1)')).toThrow();
  });
  it('accepts only the site origins', () => {
    expect(assertCabinetOrigin(CABINET_ORIGINS[0])).toBe(CABINET_ORIGINS[0]);
    expect(() => assertCabinetOrigin('https://evil.example')).toThrow();
    expect(() => assertCabinetOrigin('http://xn----8sba1acxdkgqms3b9euc.xn--p1ai')).toThrow();
  });
});

describe('cabinet link + heartbeat', () => {
  beforeEach(async () => { __setKeyProviderForTests(testKey); await unlinkLocal(null); });
  afterAll(() => __setKeyProviderForTests(null));

  it('links with a whitelisted body and keeps the token only in the secret store', async () => {
    const s = kv();
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { device_id: 'dev1', device_token: TOKEN } }));
    const meta = await linkDevice({ code: 'abcd-efgh-jkmn', name: 'ПК', fetchImpl: f, storage: s });
    expect(meta.deviceId).toBe('dev1');
    expect(calls[0].url).toBe(`${CABINET_ORIGINS[0]}/api/v1/devices/link`);
    expect(Object.keys(JSON.parse(calls[0].init.body)).sort()).toEqual(['app_version', 'code', 'name', 'platform']);
    expect(JSON.parse(calls[0].init.body).platform).toBe('windows');
    expect(calls[0].init.credentials).toBe('omit');
    expect([...s.m.values()].join('')).not.toContain(TOKEN);
    expect(await getSecret('cabinet.device_token')).toBe(TOKEN);
  });
  it('surfaces the server message and stores nothing on a bad code', async () => {
    const s = kv();
    const { f } = fakeFetch(() => ({ status: 401, body: { message: 'Код неверный или устарел' } }));
    await expect(linkDevice({ code: 'ABCD-EFGH-JKMN', name: 'x', fetchImpl: f, storage: s })).rejects.toThrow('Код неверный');
    expect(loadMeta(s)).toBeNull();
  });
  it('rejects a malformed token from the server', async () => {
    const { f } = fakeFetch(() => ({ status: 200, body: { device_id: 'd', device_token: 'short' } }));
    await expect(linkDevice({ code: 'ABCD-EFGH-JKMN', name: 'x', fetchImpl: f, storage: kv() })).rejects.toThrow();
  });
  it('sends only version, security flags and catalog models', async () => {
    const s = kv();
    const link = fakeFetch(() => ({ status: 200, body: { device_id: 'dev1', device_token: TOKEN } }));
    await linkDevice({ code: 'ABCD-EFGH-JKMN', name: 'ПК', fetchImpl: link.f, storage: s });
    const { f, calls } = fakeFetch((url) => url.includes('11434')
      ? { status: 200, body: { models: [{ name: 'qwen3:4b', size: 2_500_000_000 }, { name: 'my-secret-client-model', size: 1 }] } }
      : { status: 200, body: { ok: true } });
    expect(await sendHeartbeat({ fetchImpl: f, storage: s })).toBe('ok');
    const hbCall = calls.find(c => c.url.endsWith('/heartbeat'))!;
    expect(hbCall.init.headers.authorization).toBe(`Device ${TOKEN}`);
    const body = JSON.parse(hbCall.init.body);
    expect(Object.keys(body).sort()).toEqual(['app_version', 'models', 'status']);
    expect(Object.keys(body.status).sort()).toEqual(['bridge_v2', 'confirm_gate', 'paired_with', 'secrets_encrypted', 'voice_enrolled']);
    expect(body.models).toEqual([{ id: 'qwen3-4b-q4km', size_mb: 2500 }]);
    expect(hbCall.init.body).not.toContain('my-secret-client-model');
    expect(loadMeta(s)?.lastOk).toBeGreaterThan(0);
  });
  it('forgets the link when the cabinet revoked the device', async () => {
    const s = kv();
    const link = fakeFetch(() => ({ status: 200, body: { device_id: 'dev1', device_token: TOKEN } }));
    await linkDevice({ code: 'ABCD-EFGH-JKMN', name: 'ПК', fetchImpl: link.f, storage: s });
    const { f } = fakeFetch(() => ({ status: 401 }));
    const hb = await collectHeartbeat({ fetchImpl: null, storage: null });
    expect(await sendHeartbeat({ fetchImpl: f, storage: s, heartbeat: hb })).toBe('unlinked');
    expect(loadMeta(s)).toBeNull();
    expect(await getSecret('cabinet.device_token')).toBeNull();
  });
  it('does nothing when not linked', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200 }));
    expect(await sendHeartbeat({ fetchImpl: f, storage: kv() })).toBe('not_linked');
    expect(calls.length).toBe(0);
  });
});

describe('wipe all data', () => {
  beforeEach(() => __setKeyProviderForTests(testKey));
  afterAll(() => __setKeyProviderForTests(null));

  it('removes every svetlana key and the secrets, keeps foreign keys', async () => {
    const s = kv({ svetlana_crm_v1: '{}', svetlana_biz_v1: '{}', svetlana_voiceprint_v1: '{}', other_app: 'x' });
    await setSecret('ai.openai', 'sk-1', s as any);
    const n = await wipeAllLocalData(s);
    expect(n).toBe(4);
    expect([...s.m.keys()]).toEqual(['other_app']);
    expect(await getSecret('ai.openai', s as any)).toBeNull();
  });
  it('clearAllSecrets also drops in-memory copies', async () => {
    __setKeyProviderForTests(async () => null);
    await setSecret('stt.apikey', 'k', null);
    await clearAllSecrets(null);
    expect(await getSecret('stt.apikey', null)).toBeNull();
  });
});

describe('DaData key at rest', () => {
  beforeEach(() => __setKeyProviderForTests(testKey));
  afterAll(() => __setKeyProviderForTests(null));
  it('migrates a legacy plain-text key into the secret store and erases it', async () => {
    const s = kv({ svetlana_dadata_key: 'dadata-plain-123' });
    expect(await getDadataKey(s)).toBe('dadata-plain-123');
    expect(s.m.has('svetlana_dadata_key')).toBe(false);
  });
});
