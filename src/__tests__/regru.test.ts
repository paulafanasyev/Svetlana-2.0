import { describe, it, expect, afterEach } from 'vitest';
import { RegruConnection, regruRequest, regruRecord, parseRegruCredentials } from '../services/mcp/RegruTools';
import { mcpServer, MCP_ORIGINS } from '../services/mcp/McpCatalog';
import { mcpManager, runMcpActions, parseMcpActions, __setMcpFactoryForTests } from '../services/mcp/McpManager';
import { setActionConfirmer, resetActionGate, needsConfirmation, summarizeAction } from '../services/security/ActionGate';

const CREDS = 'me@mail.ru:p@ss:w0rd&x';

type Sent = { url: string; init: RequestInit; form: URLSearchParams; data: any };

function fakeRegru(answer: (path: string, data: any) => unknown) {
  const sent: Sent[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body ?? ''));
    const data = JSON.parse(form.get('input_data') ?? '{}');
    sent.push({ url, init, form, data });
    return new Response(JSON.stringify(answer(url.replace('https://api.reg.ru/api/regru2/', ''), data)), { headers: { 'content-type': 'application/json' } });
  };
  return { sent, fetchImpl };
}

const ok = (answer: unknown = {}) => ({ result: 'success', answer });
const okDomain = (dname = 'site.ru') => ok({ domains: [{ dname, result: 'success' }] });

describe('REG.RU catalog and credentials', () => {
  it('is a built-in adapter with a fixed https address allowed by CSP', () => {
    const s = mcpServer('regru')!;
    expect(s.kind).toBe('rest');
    expect(s.url).toBe('https://api.reg.ru/api/regru2');
    expect(MCP_ORIGINS).toContain('https://api.reg.ru');
    expect(s.tokenLabel).toMatch(/логин:пароль/);
    expect(s.tokenHint).toMatch(/IP-адрес/);
  });

  it('accepts an e-mail login, keeps colons in the password and rejects junk', () => {
    expect(parseRegruCredentials(' me@mail.ru:a:b ')).toEqual({ login: 'me@mail.ru', password: 'a:b' });
    expect(() => parseRegruCredentials('nopassword')).toThrow(/через двоеточие/);
    expect(() => parseRegruCredentials('bad login:x')).toThrow(/через двоеточие/);
    expect(() => parseRegruCredentials('login:a\nb')).toThrow(/через двоеточие/);
  });
});

describe('REG.RU requests', () => {
  it('maps tools to fixed API functions with checked values', () => {
    expect(regruRequest('get_balance', {})).toEqual({ path: 'user/get_balance', data: { currency: 'RUR' } });
    expect(regruRequest('get_dns', { domain: 'Site.RU.' })).toEqual({ path: 'zone/get_resource_records', data: { domains: [{ dname: 'site.ru' }] } });
    expect(regruRequest('add_record', { domain: 'site.ru', subdomain: '@', type: 'A', value: '1.2.3.4' }))
      .toEqual({ path: 'zone/add_alias', data: { domains: [{ dname: 'site.ru' }], subdomain: '@', ipaddr: '1.2.3.4' } });
    expect(regruRequest('add_record', { domain: 'site.ru', subdomain: '@', type: 'mx', value: 'mx1.beget.ru' }).data)
      .toEqual({ domains: [{ dname: 'site.ru' }], subdomain: '@', mail_server: 'mx1.beget.ru', priority: 10 });
    expect(regruRequest('add_record', { domain: 'site.ru', subdomain: '_dmarc', type: 'TXT', value: 'v=DMARC1; p=none' }).path).toBe('zone/add_txt');
    expect(regruRequest('remove_record', { domain: 'site.ru', subdomain: 'www', type: 'CNAME', value: 'site.ru' }).data)
      .toEqual({ domains: [{ dname: 'site.ru' }], subdomain: 'www', record_type: 'CNAME', content: 'site.ru' });
  });

  it('removes a record with the value exactly as get_dns showed it', () => {
    const d = regruRequest('remove_record', { domain: 'site.ru', subdomain: 'www', type: 'CNAME', value: ' Target.Example.RU. ' }).data!;
    expect(d.content).toBe('Target.Example.RU.');
    expect(d.record_type).toBe('CNAME');
    expect(regruRequest('remove_record', { domain: 'site.ru', subdomain: '@', type: 'TXT', value: ' v=spf1 -all ' }).data!.content).toBe(' v=spf1 -all ');
  });

  it('explains how to recover after an IP block without asking for a new password', async () => {
    const srv = fakeRegru(() => ok());
    __setMcpFactoryForTests((_s, t) => new RegruConnection(t ?? '', srv.fetchImpl));
    await mcpManager.connect('regru', CREDS);
    __setMcpFactoryForTests((_s, t) => new RegruConnection(t ?? '', fakeRegru(() => ({ result: 'error', error_code: 'ACCESS_DENIED_FROM_IP' })).fetchImpl));
    await expect(mcpManager.refresh('regru')).rejects.toThrow(/IP-адрес/);
    const err = mcpManager.status().find(s => s.server.id === 'regru')?.error ?? '';
    expect(err).toMatch(/нажмите «Обновить»/);
    expect(err).not.toMatch(/Сменить данные/);
    __setMcpFactoryForTests(null); mcpManager.reset();
  });

  it('refuses bad values and never removes records without an exact value', () => {
    expect(() => regruRequest('get_dns', { domain: '../user/delete' })).toThrow(/неверный домен/);
    expect(() => regruRecord({ domain: 'site.ru', subdomain: 'www', type: 'A', value: '999.1.1.1' })).toThrow(/IPv4/);
    expect(() => regruRecord({ domain: 'site.ru', subdomain: 'w w', type: 'A', value: '1.1.1.1' })).toThrow(/поддомен/);
    expect(() => regruRecord({ domain: 'site.ru', subdomain: '@', type: 'NS', value: 'ns1.x.ru' })).toThrow(/тип записи/);
    expect(() => regruRecord({ domain: 'site.ru', subdomain: '@', type: 'MX', value: 'mx.x.ru', priority: 70000 })).toThrow(/приоритет/);
    expect(() => regruRequest('remove_record', { domain: 'site.ru', subdomain: '@', type: 'TXT' })).toThrow(/значение/);
    expect(() => regruRequest('domain_delete', {})).toThrow(/нет инструмента/);
  });

  it('sends credentials only in the POST body, never inside input_data or the address', async () => {
    const srv = fakeRegru(path => path === 'user/nop' ? ok() : okDomain());
    const c = new RegruConnection(CREDS, srv.fetchImpl);
    await c.initialize();
    const r = await c.callTool('add_record', { domain: 'site.ru', subdomain: '@', type: 'A', value: '1.2.3.4' });
    expect(r.isError).toBe(false);
    expect(srv.sent.map(s => s.url)).toEqual(['https://api.reg.ru/api/regru2/user/nop', 'https://api.reg.ru/api/regru2/zone/add_alias']);
    for (const s of srv.sent) {
      expect(s.url).not.toContain('password');
      expect(s.init.method).toBe('POST');
      expect(s.init.redirect).toBe('error');
      expect(s.init.credentials).toBe('omit');
      expect(s.form.get('username')).toBe('me@mail.ru');
      expect(s.form.get('password')).toBe('p@ss:w0rd&x');
      expect(JSON.stringify(s.data)).not.toContain('p@ss');
    }
  });

  it('explains the IP allowlist and bad passwords as auth errors', async () => {
    const ip = fakeRegru(() => ({ result: 'error', error_code: 'ACCESS_DENIED_FROM_IP', error_text: 'denied' }));
    await expect(new RegruConnection(CREDS, ip.fetchImpl).initialize()).rejects.toThrow(/Настройки API.*IP-адрес/);
    const pw = fakeRegru(() => ({ result: 'error', error_code: 'PASSWORD_AUTH_FAILED' }));
    await expect(new RegruConnection(CREDS, pw.fetchImpl).initialize()).rejects.toThrow(/логин или пароль API/);
  });

  it('reports per-domain errors and hides the password', async () => {
    const srv = fakeRegru(path => path === 'user/nop' ? ok()
      : ok({ domains: [{ dname: 'site.ru', result: 'error', error_code: 'DOMAIN_IS_NOT_USE_REGRU_NSS', error_text: 'not ours p@ss:w0rd&x' }] }));
    const c = new RegruConnection(CREDS, srv.fetchImpl);
    const r = await c.callTool('get_dns', { domain: 'site.ru' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('DOMAIN_IS_NOT_USE_REGRU_NSS');
    expect(r.text).not.toContain('p@ss:w0rd&x');
  });
});

describe('REG.RU in the chat', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  async function connect(answer: (path: string, data: any) => unknown = path => path === 'user/nop' ? ok() : okDomain()) {
    const srv = fakeRegru(answer);
    __setMcpFactoryForTests((_s, t) => new RegruConnection(t ?? '', srv.fetchImpl));
    expect(await mcpManager.connect('regru', CREDS)).toBe(6);
    return srv;
  }

  it('every call waits for confirmation; reading without a dialog cannot be turned on', async () => {
    await connect();
    mcpManager.setAutoRead('regru', true);
    expect(mcpManager.status().find(s => s.server.id === 'regru')?.canAutoRead).toBe(false);
    expect(needsConfirmation('mcp_regru__get_dns', 'llm', {})).toBe(true);
    expect(needsConfirmation('mcp_regru__remove_record', 'llm', {})).toBe(true);
  });

  it('the confirmation says in plain words what changes', async () => {
    await connect();
    const add = summarizeAction({ tool: 'mcp_regru__add_record', args: { domain: 'site.ru', subdomain: 'www', type: 'A', value: '1.2.3.4' }, source: 'llm' });
    expect(add.lines[0]).toBe('Что будет: REG.RU: добавить запись A для www.site.ru: 1.2.3.4. Остальные записи не изменятся.');
    expect(add.title).toMatch(/изменит данные/);
    const rm = summarizeAction({ tool: 'mcp_regru__remove_record', args: { domain: 'site.ru', subdomain: '@', type: 'MX', value: 'mx1.beget.ru', priority: 10 }, source: 'llm' });
    expect(rm.lines[0]).toBe('Что будет: REG.RU: удалить запись MX у site.ru: 10 mx1.beget.ru. Остальные записи не изменятся.');
    expect(rm.warning).toMatch(/перестанут работать/);
    const exact = summarizeAction({ tool: 'mcp_regru__remove_record', args: { domain: 'site.ru', subdomain: 'www', type: 'CNAME', value: 'Target.Example.RU.' }, source: 'llm' });
    expect(exact.lines[0]).toContain('Target.Example.RU.');
    expect(summarizeAction({ tool: 'mcp_regru__get_dns', args: { domain: 'site.ru' }, source: 'llm' }).warning ?? null).toBeNull();
  });

  it('runs only after approval; mistakes do not disconnect the service', async () => {
    const srv = await connect(path => path === 'user/nop' ? ok() : path === 'zone/get_resource_records' ? { result: 'error', error_code: 'INVALID_DOMAIN_NAME_FORMAT' } : okDomain());
    const p = parseMcpActions('[MCP: {"tool":"mcp_regru__add_record","args":{"domain":"site.ru","subdomain":"@","type":"TXT","value":"v=spf1 -all"}}]');
    expect(p.actions).toHaveLength(1);
    setActionConfirmer(async () => false);
    await runMcpActions(p.actions);
    expect(srv.sent.some(s => s.url.endsWith('zone/add_txt'))).toBe(false);
    setActionConfirmer(async () => true);
    expect((await runMcpActions(p.actions)).lines[0]).toMatch(/^✅ REG.RU: Добавить DNS-запись/);
    const bad = await runMcpActions([{ tool: 'mcp_regru__add_record', args: { domain: 'site.ru', subdomain: '@', type: 'A', value: 'x' }, source: 'llm' }]);
    expect(bad.lines[0]).toMatch(/IPv4/);
    const refused = await runMcpActions([{ tool: 'mcp_regru__get_dns', args: { domain: 'site.ru' }, source: 'llm' }]);
    expect(refused.lines[0]).toMatch(/INVALID_DOMAIN_NAME_FORMAT/);
    expect(mcpManager.status().find(s => s.server.id === 'regru')?.verified).toBe(true);
  });

  it('a blocked IP on connect explains where to fix it', async () => {
    __setMcpFactoryForTests((_s, t) => new RegruConnection(t ?? '', fakeRegru(() => ({ result: 'error', error_code: 'ACCESS_DENIED_FROM_IP' })).fetchImpl));
    await expect(mcpManager.connect('regru', CREDS)).rejects.toThrow(/Настройки API.*нажмите «Подключить» ещё раз/);
  });
});
