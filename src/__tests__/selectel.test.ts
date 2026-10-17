import { describe, it, expect, afterEach } from 'vitest';
import { SelectelConnection, parseSelectelCredentials, selectelRecord, sameContent, SELECTEL_NS } from '../services/mcp/SelectelTools';
import { mcpServer, MCP_ORIGINS } from '../services/mcp/McpCatalog';
import { mcpManager, runMcpActions, __setMcpFactoryForTests } from '../services/mcp/McpManager';
import { setActionConfirmer, resetActionGate, needsConfirmation, summarizeAction } from '../services/security/ActionGate';
import { regruNss, RegruConnection } from '../services/mcp/RegruTools';

const CREDS = '123456:my-project:svetlana:p@ss:w0rd';
const ZONE = { id: 'z-1', name: 'site.ru.' };

type Sent = { url: string; method: string; headers: Record<string, string>; body: any };

function fakeSelectel(opts: { rrsets?: any[]; identity?: (body: any) => Response; api?: (url: string, method: string, body: any) => Response | null } = {}) {
  const sent: Sent[] = [];
  let rrsets = opts.rrsets ?? [];
  let n = 0;
  const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const method = init.method ?? 'GET';
    sent.push({ url, method, headers, body });
    if (url === 'https://cloud.api.selcloud.ru/identity/v3/auth/tokens') {
      if (opts.identity) return opts.identity(body);
      n++;
      return json({ token: { expires_at: new Date(Date.now() + 86_400_000).toISOString() } }, 201, { 'x-subject-token': `tok-${body.auth.scope.project ? 'p' : 'a'}-${n}-abcdefghijklmnop` });
    }
    const custom = opts.api?.(url, method, body);
    if (custom) return custom;
    if (url.endsWith('/v3/balances')) return json({ status: 'ok', data: { settings: { currency: 'rub' }, billings: [{ billing_type: 'primary', final_sum: 1500, debt_sum: 0 }], debt_status: 'none' } });
    if (url.includes('/rrset?')) return json({ count: rrsets.length, next_offset: 0, result: rrsets });
    if (url.includes('/zones?')) return json({ count: 1, next_offset: 0, result: [ZONE] });
    if (method === 'POST' && url.endsWith('/rrset')) { rrsets = [...rrsets, { id: 'r-new', ...body }]; return json({ id: 'r-new', ...body }, 201); }
    if (method === 'PATCH') return new Response(null, { status: 204 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return json({ error: 'not found' }, 404);
  };
  return { sent, fetchImpl };
}

describe('Selectel catalog and credentials', () => {
  it('is a built-in adapter; both the API and the sign-in server are allowed by CSP', () => {
    const s = mcpServer('selectel')!;
    expect(s.kind).toBe('rest');
    expect(s.tokenLabel).toBe('аккаунт:проект:пользователь:пароль');
    expect(MCP_ORIGINS).toContain('https://api.selectel.ru');
    expect(MCP_ORIGINS).toContain('https://cloud.api.selcloud.ru');
  });

  it('reads account:project:user:password, keeps colons in the password and rejects junk', () => {
    expect(parseSelectelCredentials(` ${CREDS} `)).toEqual({ account: '123456', project: 'my-project', user: 'svetlana', password: 'p@ss:w0rd' });
    expect(() => parseSelectelCredentials('user:pass')).toThrow(/номер_аккаунта:проект:пользователь:пароль/);
    expect(() => parseSelectelCredentials('abc:p:u:pw')).toThrow(/номер_аккаунта/);
    expect(() => parseSelectelCredentials('123:p:u:pa\nss')).toThrow(/номер_аккаунта/);
  });
});

describe('Selectel records', () => {
  it('builds Selectel content: FQDN with a dot, MX with priority, TXT in quotes', () => {
    const a = selectelRecord({ domain: 'Site.RU', subdomain: '@', type: 'A', value: '1.2.3.4' });
    expect([a.fqdn, a.content]).toEqual(['site.ru.', '1.2.3.4']);
    const mx = selectelRecord({ domain: 'site.ru', subdomain: '@', type: 'mx', value: 'MX1.Beget.com.', priority: 20 });
    expect([mx.fqdn, mx.content, mx.priority]).toEqual(['site.ru.', '20 mx1.beget.com.', 20]);
    const txt = selectelRecord({ domain: 'site.ru', subdomain: '_dmarc', type: 'TXT', value: 'v=DMARC1; p=none' });
    expect([txt.fqdn, txt.content]).toEqual(['_dmarc.site.ru.', '"v=DMARC1; p=none"']);
    const idn = selectelRecord({ domain: 'тест.рф', subdomain: 'www', type: 'CNAME', value: 'тест.рф' });
    expect([idn.fqdn, idn.content]).toEqual(['www.xn--e1aybc.xn--p1ai.', 'xn--e1aybc.xn--p1ai.']);
    expect(() => selectelRecord({ domain: 'site.ru', subdomain: '@', type: 'TXT', value: 'a"b' })).toThrow(/кавычек/);
    expect(() => selectelRecord({ domain: '../x', subdomain: '@', type: 'A', value: '1.1.1.1' })).toThrow(/неверный домен/);
    expect(() => selectelRecord({ domain: 'site.ru', subdomain: '@', type: 'NS', value: 'x.ru' })).toThrow(/тип записи/);
    expect(sameContent('TXT', '"v=spf1 -all"', 'v=spf1 -all')).toBe(true);
    expect(sameContent('MX', '10 MX1.beget.com.', '10 mx1.beget.com')).toBe(true);
  });

  it('Selectel NS are recognised by the REG.RU NS check', () => {
    expect(regruNss([...SELECTEL_NS])).toEqual(['a.ns.selectel.ru', 'b.ns.selectel.ru', 'c.ns.selectel.ru', 'd.ns.selectel.ru']);
  });
});

describe('Selectel connection', () => {
  it('signs in with the service user only in the POST body and uses the token as X-Auth-Token', async () => {
    const srv = fakeSelectel();
    const c = new SelectelConnection(CREDS, srv.fetchImpl);
    await c.initialize();
    const id = srv.sent[0];
    expect(id.method).toBe('POST');
    expect(id.url).not.toContain('p@ss');
    expect(id.body.auth.identity.password.user).toEqual({ name: 'svetlana', domain: { name: '123456' }, password: 'p@ss:w0rd' });
    expect(id.body.auth.scope).toEqual({ project: { name: 'my-project', domain: { name: '123456' } } });
    const r = await c.callTool('get_balance', {});
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).billings[0].final_sum).toBe(1500);
    const bal = srv.sent.find(s => s.url.endsWith('/v3/balances'))!;
    expect(bal.headers['x-auth-token']).toMatch(/^tok-a-/); // баланс — с токеном на аккаунт
    expect(srv.sent.find(s => s.body?.auth?.scope?.domain)?.body.auth.scope).toEqual({ domain: { name: '123456' } });
  });

  it('adds a record to an existing set, keeps the others, and creates a new set when needed', async () => {
    const srv = fakeSelectel({ rrsets: [{ id: 'r-1', name: 'site.ru.', type: 'TXT', ttl: 600, records: [{ content: '"google-site-verification=x"' }] }] });
    const c = new SelectelConnection(CREDS, srv.fetchImpl);
    expect((await c.callTool('add_record', { domain: 'site.ru', subdomain: '@', type: 'TXT', value: 'v=spf1 -all' })).isError).toBe(false);
    const patch = srv.sent.find(s => s.method === 'PATCH')!;
    expect(patch.url).toBe('https://api.selectel.ru/domains/v2/zones/z-1/rrset/r-1');
    expect(patch.body).toEqual({ ttl: 600, records: [{ content: '"google-site-verification=x"', disabled: false }, { content: '"v=spf1 -all"', disabled: false }] });
    expect((await c.callTool('add_record', { domain: 'site.ru', subdomain: 'www', type: 'A', value: '1.2.3.4' })).isError).toBe(false);
    const post = srv.sent.find(s => s.method === 'POST' && s.url.endsWith('/rrset'))!;
    expect(post.body).toEqual({ name: 'www.site.ru.', type: 'A', ttl: 3600, records: [{ content: '1.2.3.4', disabled: false }] });
  });

  it('removes only the exact record; an empty set is deleted', async () => {
    const srv = fakeSelectel({ rrsets: [
      { id: 'r-1', name: 'site.ru.', type: 'MX', ttl: 600, records: [{ content: '10 mx1.beget.com.' }, { content: '20 mx2.beget.com.' }] },
      { id: 'r-2', name: 'www.site.ru.', type: 'A', ttl: 600, records: [{ content: '1.2.3.4' }] },
    ] });
    const c = new SelectelConnection(CREDS, srv.fetchImpl);
    expect((await c.callTool('remove_record', { domain: 'site.ru', subdomain: '@', type: 'MX', value: 'mx2.beget.com', priority: 20 })).isError).toBe(false);
    expect(srv.sent.find(s => s.method === 'PATCH')!.body.records).toEqual([{ content: '10 mx1.beget.com.', disabled: false }]);
    expect((await c.callTool('remove_record', { domain: 'site.ru', subdomain: 'www', type: 'A', value: '1.2.3.4' })).isError).toBe(false);
    expect(srv.sent.find(s => s.method === 'DELETE')!.url).toBe('https://api.selectel.ru/domains/v2/zones/z-1/rrset/r-2');
    const miss = await c.callTool('remove_record', { domain: 'site.ru', subdomain: 'www', type: 'A', value: '9.9.9.9' });
    expect(miss.isError).toBe(true);
    expect(miss.text).toMatch(/такой записи нет/);
  });

  it('refreshes an expired token once and hides secrets from replies', async () => {
    let first = true;
    const srv = fakeSelectel({ api: (url) => {
      if (url.includes('/zones?') && first) { first = false; return new Response('{}', { status: 401 }); }
      if (url.includes('/rrset?')) return new Response(JSON.stringify({ error: 'bad p@ss:w0rd' }), { status: 422 });
      return null;
    } });
    const c = new SelectelConnection(CREDS, srv.fetchImpl);
    expect((await c.callTool('list_zones', {})).isError).toBe(false);
    expect(srv.sent.filter(s => s.url.includes('identity')).length).toBe(2);
    const r = await c.callTool('get_dns', { domain: 'site.ru' });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain('p@ss:w0rd');
  });

  it('reads every page of zones and record sets', async () => {
    const page = (items: any[], next: number) => new Response(JSON.stringify({ count: 1500, next_offset: next, result: items }), { headers: { 'content-type': 'application/json' } });
    const srv = fakeSelectel({ api: (url) => {
      if (url.includes('/zones?') && url.includes('offset=0')) return page([{ id: 'z-0', name: 'other.ru.' }], 1000);
      if (url.includes('/zones?') && url.includes('offset=1000')) return page([ZONE], 0);
      if (url.includes('/rrset?') && url.includes('offset=0')) return page([{ id: 'r-a', name: 'a.site.ru.', type: 'A', ttl: 60, records: [{ content: '1.1.1.1' }] }], 1000);
      if (url.includes('/rrset?') && url.includes('offset=1000')) return page([{ id: 'r-b', name: 'b.site.ru.', type: 'A', ttl: 60, records: [{ content: '2.2.2.2' }] }], 0);
      return null;
    } });
    const r = await new SelectelConnection(CREDS, srv.fetchImpl).callTool('get_dns', { domain: 'site.ru' });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).map((x: any) => x.name)).toEqual(['a.site.ru', 'b.site.ru']);
  });

  it('a wrong password is an auth error with the next step', async () => {
    const srv = fakeSelectel({ identity: () => new Response('{}', { status: 401 }) });
    await expect(new SelectelConnection(CREDS, srv.fetchImpl).initialize()).rejects.toThrow(/Сервисные пользователи/);
    const hidden = fakeSelectel({ identity: () => new Response('{}', { status: 201 }) });
    await expect(new SelectelConnection(CREDS, hidden.fetchImpl).initialize()).rejects.toThrow(/ответ сервера входа/);
  });
});

describe('Selectel in the chat', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  it('every call is confirmed and the change is explained in plain words', async () => {
    const srv = fakeSelectel();
    __setMcpFactoryForTests((_s, t) => new SelectelConnection(t ?? '', srv.fetchImpl));
    expect(await mcpManager.connect('selectel', CREDS)).toBe(5);
    expect(needsConfirmation('mcp_selectel__get_dns', 'llm', {})).toBe(true);
    const s = summarizeAction({ tool: 'mcp_selectel__add_record', args: { domain: 'тест.рф', subdomain: 'www', type: 'A', value: '1.2.3.4' }, source: 'llm' });
    expect(s.lines[0]).toBe('Что будет: Selectel: добавить запись A для www.xn--e1aybc.xn--p1ai (тест.рф): 1.2.3.4. Остальные записи не изменятся.');
    expect(s.warning).toMatch(/a\.ns\.selectel\.ru/);
    const say = (args: Record<string, unknown>, tool = 'add_record') => summarizeAction({ tool: `mcp_selectel__${tool}`, args: { domain: 'site.ru', subdomain: '@', ...args }, source: 'llm' }).lines[0];
    expect(say({ type: 'MX', value: 'mx1.beget.com', priority: 20 })).toBe('Что будет: Selectel: добавить запись MX для site.ru: 20 mx1.beget.com.. Остальные записи не изменятся.');
    expect(say({ type: 'TXT', value: 'v=spf1 -all' })).toContain(': "v=spf1 -all".');
    expect(say({ type: 'CNAME', subdomain: 'www', value: 'Site.ru' }, 'remove_record')).toBe('Что будет: Selectel: удалить запись CNAME у www.site.ru: site.ru.. Остальные записи не изменятся.');
    setActionConfirmer(async () => false);
    await runMcpActions([{ tool: 'mcp_selectel__add_record', args: { domain: 'site.ru', subdomain: 'www', type: 'A', value: '1.2.3.4' }, source: 'llm' }]);
    expect(srv.sent.some(x => x.method === 'POST' && x.url.endsWith('/rrset'))).toBe(false);
    setActionConfirmer(async () => true);
    const bad = await runMcpActions([{ tool: 'mcp_selectel__add_record', args: { domain: 'site.ru', subdomain: '@', type: 'A', value: 'x' }, source: 'llm' }]);
    expect(bad.lines[0]).toMatch(/IPv4/);
    expect(mcpManager.status().find(x => x.server.id === 'selectel')?.verified).toBe(true);
  });

  it('REG.RU confirmation tags Selectel name servers', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ result: 'success', answer: {} }), { headers: { 'content-type': 'application/json' } });
    __setMcpFactoryForTests((_s, t) => new RegruConnection(t ?? '', fetchImpl));
    await mcpManager.connect('regru', 'me@mail.ru:pw');
    const s = summarizeAction({ tool: 'mcp_regru__set_nss', args: { domain: 'site.ru', nss: [...SELECTEL_NS] }, source: 'llm' });
    expect(s.lines[0]).toMatch(/DNS-серверы \(Selectel\)/);
  });
});
