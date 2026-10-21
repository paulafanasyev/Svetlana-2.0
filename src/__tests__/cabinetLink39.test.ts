import { describe, it, expect, vi, beforeEach } from 'vitest';

const secrets = new Map<string, string>();
let failSet = false;
vi.mock('../services/security/SecretStore', () => ({
  getSecret: async (k: string) => secrets.get(k) ?? null,
  setSecret: async (k: string, v: string) => { if (failSet) throw new Error('disk'); secrets.set(k, v); },
  deleteSecret: async (k: string) => { secrets.delete(k); },
  secretStorageMode: async () => 'encrypted',
}));

import { linkDevice, loadMeta, sendHeartbeat, LINK_SAVE_FAILED } from '../services/cabinet/CabinetClient';

const TOKEN = 'a'.repeat(48);
const okFetch = async () => new Response(JSON.stringify({ device_token: TOKEN, device_id: 'dev1' }), { status: 200 });

function mem(failWrite = false) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { if (failWrite) throw new Error('quota'); m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

beforeEach(() => { secrets.clear(); failSet = false; });

describe('linkDevice keeps local state consistent', () => {
  it('normal link stores token and meta', async () => {
    const s = mem();
    const meta = await linkDevice({ code: 'ABCD-EFGH-JKLM', name: 'PC', fetchImpl: okFetch as any, storage: s });
    expect(meta.deviceId).toBe('dev1');
    expect(secrets.get('cabinet.device_token')).toBe(TOKEN);
    expect(loadMeta(s)?.deviceId).toBe('dev1');
  });

  it('meta write failure removes the stored token', async () => {
    const s = mem(true);
    await expect(linkDevice({ code: 'ABCD-EFGH-JKLM', name: 'PC', fetchImpl: okFetch as any, storage: s })).rejects.toThrow(LINK_SAVE_FAILED);
    expect(secrets.has('cabinet.device_token')).toBe(false);
    expect(loadMeta(s)).toBeNull();
  });

  it('secret write failure leaves nothing behind', async () => {
    failSet = true;
    const s = mem();
    await expect(linkDevice({ code: 'ABCD-EFGH-JKLM', name: 'PC', fetchImpl: okFetch as any, storage: s })).rejects.toThrow(LINK_SAVE_FAILED);
    expect(loadMeta(s)).toBeNull();
  });
});

describe('sendHeartbeat never throws', () => {
  it('network error gives error without raw text', async () => {
    const s = mem();
    await linkDevice({ code: 'ABCD-EFGH-JKLM', name: 'PC', fetchImpl: okFetch as any, storage: s });
    const bad = async () => { throw new Error('secret http://internal/xyz'); };
    const r = await sendHeartbeat({ fetchImpl: bad as any, storage: s, heartbeat: { app_version: '1', status: { bridge_v2: true, voice_enrolled: false, secrets_encrypted: true, confirm_gate: true, paired_with: null }, models: [] } });
    expect(r).toBe('error');
    expect(loadMeta(s)?.lastError).not.toContain('internal');
  });

  it('401 unlinks locally', async () => {
    const s = mem();
    await linkDevice({ code: 'ABCD-EFGH-JKLM', name: 'PC', fetchImpl: okFetch as any, storage: s });
    const r = await sendHeartbeat({ fetchImpl: (async () => new Response('', { status: 401 })) as any, storage: s, heartbeat: { app_version: '1', status: { bridge_v2: true, voice_enrolled: false, secrets_encrypted: true, confirm_gate: true, paired_with: null }, models: [] } });
    expect(r).toBe('unlinked');
    expect(loadMeta(s)).toBeNull();
    expect(secrets.has('cabinet.device_token')).toBe(false);
  });
});
