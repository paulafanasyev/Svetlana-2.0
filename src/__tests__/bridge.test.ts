// Tests for the Svetlana-home HTTP bridge client (HTTPHands + read_contacts tool)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HTTPHands } from '../services/HTTPHands';
import { handsManager } from '../services/HandsManager';
import { readContactsTool } from '../services/RealTools';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HTTPHands ↔ Svetlana-home bridge', () => {
  it('sends the pairing code as a Bearer token and verifies it on connect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, service: 'svetlana-home' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { platform: 'android', model: 'POCO X3' } }));
    vi.stubGlobal('fetch', fetchMock);

    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080/', token: 'ABCD-EFGH' });
    await hands.connect();

    expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.20:8080/health');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://192.168.1.20:8080/api/device/info');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ABCD-EFGH' });
    expect(await hands.isConnected()).toBe(true);
  });

  it('reports a wrong pairing code and stays disconnected', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'UNAUTHORIZED', message: 'Нужен код подключения' }, 401)));

    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'WRON-GCOD' });
    await expect(hands.connect()).rejects.toThrow('Нужен код подключения');
    expect(await hands.isConnected()).toBe(false);
  });

  it('lists contacts with query and paging params', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { platform: 'android' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { total: 1, offset: 0, contacts: [{ id: '1', name: 'Анна', phones: ['+84 90 000 0000'] }] } }));
    vi.stubGlobal('fetch', fetchMock);

    const hands = new HTTPHands({ transport: 'http', endpoint: 'http://192.168.1.20:8080', token: 'ABCD-EFGH' });
    await hands.connect();
    const page = await hands.listContacts({ query: 'Ан', limit: 50 });

    expect(page.total).toBe(1);
    expect(page.contacts[0].name).toBe('Анна');
    const body = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string);
    expect(body.params).toEqual({ query: 'Ан', limit: 50 });
  });
});

describe('read_contacts tool', () => {
  it('returns contacts from the connected phone', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { platform: 'android' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { total: 2, offset: 0, contacts: [
        { id: '1', name: 'Анна', phones: ['1'] },
        { id: '2', name: 'Борис', phones: ['2', '3'] },
      ] } })));
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
