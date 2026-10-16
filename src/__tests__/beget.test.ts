import { describe, it, expect, afterEach } from 'vitest';
import { BegetConnection, begetRequest, begetDnsRecords, parseBegetCredentials } from '../services/mcp/BegetTools';
import { mcpServer, MCP_ORIGINS } from '../services/mcp/McpCatalog';
import { mcpManager, runMcpActions, parseMcpActions, __setMcpFactoryForTests } from '../services/mcp/McpManager';
import { setActionConfirmer, resetActionGate, needsConfirmation, summarizeAction, type ActionSummary } from '../services/security/ActionGate';

const CREDS = 'mylogin:p@ss:w0rd&x';

type Sent = { url: string; init: RequestInit; form: URLSearchParams };

function fakeBeget(answer: (path: string, data: any) => unknown) {
  const sent: Sent[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body ?? ''));
    sent.push({ url, init, form });
    const path = url.replace('https://api.beget.com/api/', '');
    const data = form.get('input_data') ? JSON.parse(form.get('input_data')!) : undefined;
    return new Response(JSON.stringify(answer(path, data)), { headers: { 'content-type': 'application/json' } });
  };
  return { sent, fetchImpl };
}

const ok = (result: unknown) => ({ status: 'success', answer: { status: 'success', result } });

describe('Beget catalog and credentials', () => {
  it('is a built-in adapter with a fixed https address allowed by CSP', () => {
    const s = mcpServer('beget')!;
    expect(s.kind).toBe('rest');
    expect(s.url).toBe('https://api.beget.com/api');
    expect(MCP_ORIGINS).toContain('https://api.beget.com');
    expect(s.tokenLabel).toMatch(/логин:пароль/);
  });

  it('reads login:password, keeps colons in the password and rejects junk', () => {
    expect(parseBegetCredentials(' mylogin:a:b ')).toEqual({ login: 'mylogin', password: 'a:b' });
    expect(() => parseBegetCredentials('nopassword')).toThrow(/через двоеточие/);
    expect(() => parseBegetCredentials(':pass')).toThrow(/через двоеточие/);
    expect(() => parseBegetCredentials('bad login:pass')).toThrow(/через двоеточие/);
    expect(() => parseBegetCredentials('login:pa\nss')).toThrow(/через двоеточие/);
  });
});

describe('Beget requests', () => {
  it('maps tools to fixed API methods with checked values', () => {
    expect(begetRequest('list_sites', {})).toEqual({ path: 'site/getList' });
    expect(begetRequest('get_dns', { fqdn: 'Example.RU.' })).toEqual({ path: 'dns/getData', data: { fqdn: 'example.ru' } });
    expect(begetRequest('link_domain', { domain_id: 5, site_id: 7 })).toEqual({ path: 'site/linkDomain', data: { domain_id: 5, site_id: 7 } });
    expect(() => begetRequest('get_dns', { fqdn: '../user/delete' })).toThrow(/неверный домен/);
    expect(() => begetRequest('link_domain', { domain_id: '5', site_id: 7 })).toThrow(/domain_id/);
    expect(() => begetRequest('site_delete', {})).toThrow(/нет инструмента/);
  });

  it('changes A/MX/TXT only all together, so nothing is wiped by accident', () => {
    expect(() => begetDnsRecords({ fqdn: 'a.ru', a: ['1.2.3.4'] })).toThrow(/все три списка/);
    expect(() => begetDnsRecords({ fqdn: 'a.ru', a: [], ns: ['ns1.x.ru'] })).toThrow(/ровно одну группу/);
    expect(begetDnsRecords({ a: ['1.2.3.4'], mx: ['10 mx1.beget.ru', '20 mx2.beget.ru'], txt: ['v=spf1 -all'] })).toEqual({
      A: [{ priority: 0, value: '1.2.3.4' }],
      MX: [{ priority: 10, value: 'mx1.beget.ru' }, { priority: 20, value: 'mx2.beget.ru' }],
      TXT: [{ priority: 10, value: 'v=spf1 -all' }],
    });
    expect(begetDnsRecords({ cname: 'Site.RU' })).toEqual({ CNAME: [{ priority: 10, value: 'site.ru' }] });
    expect(() => begetDnsRecords({ a: ['999.1.1.1'], mx: [], txt: [] })).toThrow(/неверный IP/);
    expect(() => begetDnsRecords({ a: [], mx: ['mx1.beget.ru'], txt: [] })).toThrow(/приоритет сервер/);
    expect(() => begetDnsRecords({ a: Array(11).fill('1.1.1.1'), mx: [], txt: [] })).toThrow(/не больше 10/);
    expect(() => begetDnsRecords({ ns: [] })).toThrow(/хотя бы одна/);
  });

  it('sends credentials only in the POST body, never in the address', async () => {
    const srv = fakeBeget(path => path === 'user/getAccountInfo' ? ok({ plan_name: 'Blog' }) : ok(true));
    const c = new BegetConnection(CREDS, srv.fetchImpl);
    await c.initialize();
    const r = await c.callTool('change_dns', { fqdn: 'site.ru', a: ['1.2.3.4'], mx: [], txt: [] });
    expect(r).toEqual({ text: 'true', isError: false });
    expect(srv.sent.map(s => s.url)).toEqual(['https://api.beget.com/api/user/getAccountInfo', 'https://api.beget.com/api/dns/changeRecords']);
    for (const s of srv.sent) {
      expect(s.url).not.toContain('passwd');
      expect(s.init.method).toBe('POST');
      expect(s.init.redirect).toBe('error');
      expect(s.init.credentials).toBe('omit');
      expect(s.form.get('login')).toBe('mylogin');
      expect(s.form.get('passwd')).toBe('p@ss:w0rd&x');
    }
    expect(JSON.parse(srv.sent[1].form.get('input_data')!)).toEqual({ fqdn: 'site.ru', records: { A: [{ priority: 0, value: '1.2.3.4' }], MX: [], TXT: [] } });
  });

  it('reports a bad password as an auth error with the next step and hides the password in replies', async () => {
    const denied = fakeBeget(() => ({ status: 'error', error_code: 'AUTH_ERROR', error_text: 'Auth failed' }));
    await expect(new BegetConnection(CREDS, denied.fetchImpl).initialize()).rejects.toThrow(/логин или пароль API/);
    const echo = fakeBeget(path => path === 'user/getAccountInfo' ? ok({}) : { status: 'success', answer: { status: 'error', errors: [{ error_code: 'INVALID_DATA', error_text: 'bad p@ss:w0rd&x' }] } });
    const c = new BegetConnection(CREDS, echo.fetchImpl);
    const r = await c.callTool('get_dns', { fqdn: 'site.ru' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('INVALID_DATA');
    expect(r.text).not.toContain('p@ss:w0rd&x');
    expect(r.text).toContain('[пароль скрыт]');
  });

  it('treats a false result of a change as an error', async () => {
    const srv = fakeBeget(path => path === 'user/getAccountInfo' ? ok({}) : ok(false));
    const c = new BegetConnection(CREDS, srv.fetchImpl);
    expect((await c.callTool('link_domain', { domain_id: 1, site_id: 2 })).isError).toBe(true);
  });
});

describe('Beget in the chat', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  async function connect(answer: (path: string, data: any) => unknown = path => path === 'user/getAccountInfo' ? ok({}) : ok(true)) {
    const srv = fakeBeget(answer);
    __setMcpFactoryForTests((_s, t) => new BegetConnection(t ?? '', srv.fetchImpl));
    expect(await mcpManager.connect('beget', CREDS)).toBe(8);
    return srv;
  }

  it('every call waits for confirmation, even reads; reading without a dialog cannot be turned on', async () => {
    await connect();
    mcpManager.setAutoRead('beget', true);
    expect(mcpManager.status().find(s => s.server.id === 'beget')?.canAutoRead).toBe(false);
    expect(needsConfirmation('mcp_beget__list_sites', 'llm', {})).toBe(true);
    expect(needsConfirmation('mcp_beget__change_dns', 'llm', {})).toBe(true);
  });

  it('warns that DNS is replaced as a whole; reads carry no scary warning', async () => {
    await connect();
    expect(summarizeAction({ tool: 'mcp_beget__change_dns', args: { fqdn: 'site.ru', a: [], mx: [], txt: [] }, source: 'llm' }).warning).toMatch(/заменит ВСЕ DNS-записи/);
    expect(summarizeAction({ tool: 'mcp_beget__get_dns', args: { fqdn: 'site.ru' }, source: 'llm' }).warning ?? null).toBeNull();
    expect(summarizeAction({ tool: 'mcp_beget__change_dns', args: {}, source: 'llm' }).title).toMatch(/изменит данные/);
  });

  it('list arguments from the model pass through without loss and reach Beget only after approval', async () => {
    const srv = await connect();
    const p = parseMcpActions('[MCP: {"tool":"mcp_beget__change_dns","args":{"fqdn":"site.ru","a":["1.2.3.4"],"mx":["10 mx1.beget.ru"],"txt":[]}}]');
    expect(p.actions).toHaveLength(1);
    const dialogs: ActionSummary[] = [];
    setActionConfirmer(async (_r, s) => { dialogs.push(s); return false; });
    await runMcpActions(p.actions);
    expect(srv.sent.some(s => s.url.endsWith('dns/changeRecords'))).toBe(false);
    setActionConfirmer(async () => true);
    const r = await runMcpActions(p.actions);
    expect(r.lines[0]).toMatch(/^✅ Beget: Изменить DNS/);
    expect(srv.sent.filter(s => s.url.endsWith('dns/changeRecords'))).toHaveLength(1);
  });

  it('a wrong password on connect explains where to fix it', async () => {
    __setMcpFactoryForTests((_s, t) => new BegetConnection(t ?? '', fakeBeget(() => ({ status: 'error', error_code: 'AUTH_ERROR' })).fetchImpl));
    await expect(mcpManager.connect('beget', CREDS)).rejects.toThrow(/настройки API в панели Beget/);
    await expect(mcpManager.connect('beget', 'no-colon')).rejects.toThrow(/через двоеточие/);
  });
});

describe('Beget confirmation text', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  it('says in plain words which records will remain', async () => {
    const srv = fakeBeget(path => path === 'user/getAccountInfo' ? ok({}) : ok(true));
    __setMcpFactoryForTests((_s, t) => new BegetConnection(t ?? '', srv.fetchImpl));
    await mcpManager.connect('beget', CREDS);
    const s = summarizeAction({ tool: 'mcp_beget__change_dns', args: { fqdn: 'site.ru', a: ['1.2.3.4'], mx: [], txt: ['v=spf1 -all'] }, source: 'llm' });
    expect(s.lines[0]).toBe('Что будет: Beget: у домена site.ru останутся только эти записи. A (IP сайта): 1.2.3.4; MX (почта): нет (будут удалены); TXT: v=spf1 -all');
    expect(summarizeAction({ tool: 'mcp_beget__link_domain', args: { domain_id: 5, site_id: 7 }, source: 'llm' }).lines[0]).toBe('Что будет: Beget: привязать домен №5 к сайту №7');
  });
});

describe('Beget mistakes do not break the connection', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  it('wrong arguments or a refusal come back as an error result, tools stay in the chat', async () => {
    const srv = fakeBeget(path => path === 'user/getAccountInfo' ? ok({}) : { status: 'error', error_code: 'INCORRECT_REQUEST', error_text: 'bad' });
    __setMcpFactoryForTests((_s, t) => new BegetConnection(t ?? '', srv.fetchImpl));
    await mcpManager.connect('beget', CREDS);
    setActionConfirmer(async () => true);
    const r1 = await runMcpActions([{ tool: 'mcp_beget__change_dns', args: { fqdn: 'site.ru', a: ['1.2.3.4'] }, source: 'llm' }]);
    expect(r1.lines[0]).toMatch(/все три списка/);
    const r2 = await runMcpActions([{ tool: 'mcp_beget__get_dns', args: { fqdn: 'site.ru' }, source: 'llm' }]);
    expect(r2.lines[0]).toMatch(/INCORRECT_REQUEST/);
    expect(mcpManager.activeTools().length).toBe(8);
    expect(mcpManager.status().find(s => s.server.id === 'beget')?.verified).toBe(true);
  });
});
