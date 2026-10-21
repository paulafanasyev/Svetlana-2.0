import { describe, it, expect, vi, beforeEach } from 'vitest';

const secrets = new Map<string, string>();
vi.mock('../services/security/SecretStore', () => ({
  getSecret: async (k: string) => secrets.get(k) ?? null,
  setSecret: async (k: string, v: string) => { secrets.set(k, v); },
  deleteSecret: async (k: string) => { secrets.delete(k); },
  secretStorageMode: async () => 'encrypted',
}));

import { linkDevice, loadMeta, sendHeartbeat, unlinkLocal } from '../services/cabinet/CabinetClient';
import { parse1C } from '../services/biz/BankStatement';

const TOKEN = 'b'.repeat(48);
const okFetch = async () => new Response(JSON.stringify({ device_token: TOKEN, device_id: 'dev2' }), { status: 200 });
const hb = { app_version: '1', status: { bridge_v2: true, voice_enrolled: false, secrets_encrypted: true, confirm_gate: true, paired_with: null }, models: [] };
function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

beforeEach(() => { secrets.clear(); });

describe('пульс не возвращает снятую привязку', () => {
  it('отвязка во время запроса: описание не восстанавливается', async () => {
    const s = mem();
    await linkDevice({ code: 'ABCD-EFGH-JKLM', name: 'PC', fetchImpl: okFetch as any, storage: s });
    const slow = async () => { await unlinkLocal(s); return new Response('', { status: 200 }); };
    const r = await sendHeartbeat({ fetchImpl: slow as any, storage: s, heartbeat: hb });
    expect(r).toBe('not_linked');
    expect(loadMeta(s)).toBeNull();
  });

  it('обычный пульс отмечает lastOk', async () => {
    const s = mem();
    await linkDevice({ code: 'ABCD-EFGH-JKLM', name: 'PC', fetchImpl: okFetch as any, storage: s });
    const r = await sendHeartbeat({ fetchImpl: (async () => new Response('', { status: 200 })) as any, storage: s, heartbeat: hb });
    expect(r).toBe('ok');
    expect(typeof loadMeta(s)?.lastOk).toBe('number');
  });
});

describe('даты выписки', () => {
  const doc = (date: string) => `1CClientBankExchange\nРасчСчет=1\nСекцияДокумент=Платежное поручение\nДата=${date}\nСумма=10\nКонецДокумента\n`;
  it('несуществующая дата не переезжает на другой день', () => {
    expect(parse1C(doc('31.02.2025')).docs[0].date).toBeUndefined();
    expect(parse1C(doc('00.01.2025')).docs[0].date).toBeUndefined();
  });
  it('настоящая дата разбирается', () => {
    const t = parse1C(doc('28.02.2025')).docs[0].date as number;
    expect(new Date(t).getDate()).toBe(28);
    expect(new Date(t).getMonth()).toBe(1);
  });
});
