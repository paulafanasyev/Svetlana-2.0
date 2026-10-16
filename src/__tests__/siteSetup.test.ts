import { describe, it, expect, afterEach } from 'vitest';
import { BegetConnection, splitBegetDomain, begetZones } from '../services/mcp/BegetTools';
import { RegruConnection, regruRequest, regruNss } from '../services/mcp/RegruTools';
import { mcpManager, mcpSystemPrompt, runMcpActions, __setMcpFactoryForTests } from '../services/mcp/McpManager';
import { setActionConfirmer, resetActionGate, summarizeAction } from '../services/security/ActionGate';

const ZONES = { status: 'success', answer: { status: 'success', result: { ru: { id: '1', zone: 'ru' }, 'com.ru': { id: '7', zone: 'com.ru' }, com: { id: '3', zone: 'com' } } } };
const BEGET_NS = ['ns1.beget.com', 'ns2.beget.com', 'ns1.beget.pro', 'ns2.beget.pro'];

function begetFake(handler: (path: string, data: any) => unknown) {
  const sent: { path: string; data: any }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body ?? ''));
    const path = url.replace('https://api.beget.com/api/', '');
    const data = form.get('input_data') ? JSON.parse(form.get('input_data')!) : undefined;
    sent.push({ path, data });
    return new Response(JSON.stringify(handler(path, data)), { headers: { 'content-type': 'application/json' } });
  };
  return { sent, fetchImpl };
}
const bOk = (result: unknown) => ({ status: 'success', answer: { status: 'success', result } });

describe('Beget: adding a domain and a site', () => {
  it('picks the longest matching zone and refuses subdomains', () => {
    const zones = begetZones(ZONES.answer.result);
    expect(zones).toEqual({ ru: 1, 'com.ru': 7, com: 3 });
    expect(splitBegetDomain('My-Site.ru', zones)).toEqual({ hostname: 'my-site', zone_id: 1, zone: 'ru' });
    expect(splitBegetDomain('shop.com.ru', zones)).toEqual({ hostname: 'shop', zone_id: 7, zone: 'com.ru' });
    expect(() => splitBegetDomain('www.site.ru', zones)).toThrow(/поддомен.*site\.ru/);
    expect(() => splitBegetDomain('site.xyz', zones)).toThrow(/зоной/);
  });

  it('add_domain asks Beget for zones, then adds the domain and returns its number', async () => {
    const srv = begetFake(path => path === 'domain/getZoneList' ? ZONES : path === 'domain/addVirtual' ? bOk(4242) : bOk({}));
    const c = new BegetConnection('me:pw', srv.fetchImpl);
    const r = await c.callTool('add_domain', { fqdn: 'site.ru' });
    expect(r).toEqual({ text: '{"domain_id":4242,"fqdn":"site.ru"}', isError: false });
    expect(srv.sent.map(s => s.path)).toEqual(['domain/getZoneList', 'domain/addVirtual']);
    expect(srv.sent[1].data).toEqual({ hostname: 'site', zone_id: 1 });
  });

  it('add_domain errors come back as results, the connection stays', async () => {
    const srv = begetFake(path => path === 'domain/getZoneList' ? ZONES : { status: 'success', answer: { status: 'error', errors: [{ error_code: 'DOMAIN_EXISTS', error_text: 'exists' }] } });
    const c = new BegetConnection('me:pw', srv.fetchImpl);
    expect(await c.callTool('add_domain', { fqdn: 'site.ru' })).toEqual({ text: 'DOMAIN_EXISTS: exists', isError: true });
    expect((await c.callTool('add_domain', { fqdn: 'www.site.ru' })).text).toMatch(/поддомен/);
    expect((await c.callTool('add_domain', { fqdn: '../x' })).text).toMatch(/неверный домен/);
  });

  it('add_site creates the site, then finds its number in the site list', async () => {
    const srv = begetFake(path => path === 'site/add' ? bOk(true)
      : path === 'site/getList' ? bOk([{ id: '12', path: 'old.ru/public_html', domains: [] }, { id: '77', path: 'site.ru/public_html', domains: [] }]) : bOk({}));
    const c = new BegetConnection('me:pw', srv.fetchImpl);
    expect(await c.callTool('add_site', { name: 'Site.ru' })).toEqual({ text: '{"site_id":77,"name":"site.ru","path":"site.ru/public_html"}', isError: false });
    expect(srv.sent.map(s => s.path)).toEqual(['site/add', 'site/getList']);
    expect(srv.sent[0].data).toEqual({ name: 'site.ru' });
    expect((await c.callTool('add_site', { name: '../etc' })).text).toMatch(/имя сайта/);
    expect(srv.sent.length).toBe(2);
  });

  it('add_site: a refusal is an error, a missing number asks to list the sites', async () => {
    const no = begetFake(path => path === 'site/add' ? bOk(false) : bOk([]));
    expect((await new BegetConnection('me:pw', no.fetchImpl).callTool('add_site', { name: 'a.ru' })).isError).toBe(true);
    const lost = begetFake(path => path === 'site/add' ? bOk(true) : bOk([]));
    const r = await new BegetConnection('me:pw', lost.fetchImpl).callTool('add_site', { name: 'a.ru' });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/list_sites/);
    const broken = begetFake(path => path === 'site/add' ? bOk(true) : { status: 'success', answer: { status: 'error', errors: [] } });
    const b = await new BegetConnection('me:pw', broken.fetchImpl).callTool('add_site', { name: 'a.ru' });
    expect(b.isError).toBe(true);
    expect(b.text).toMatch(/Сайт создан/);
  });

  it('accepts Cyrillic domains as punycode', () => {
    const zones = begetZones({ rf: { id: '9', zone: 'рф' }, ru: { id: '1', zone: 'ru' } });
    expect(zones).toEqual({ 'xn--p1ai': 9, ru: 1 });
    expect(splitBegetDomain('Тест.РФ.', zones)).toEqual({ hostname: 'xn--e1aybc', zone_id: 9, zone: 'xn--p1ai' });
    expect(regruRequest('set_nss', { domain: 'тест.рф', nss: ['ns1.beget.com', 'ns2.beget.com'] }).data).toEqual({ domains: [{ dname: 'xn--e1aybc.xn--p1ai' }], nss: { ns0: 'ns1.beget.com', ns1: 'ns2.beget.com' } });
    expect(() => splitBegetDomain('тест.рф/путь', zones)).toThrow(/неверный домен/);
    for (const d of ['foo.-bar', 'foo.bar-', 'foo.--']) expect(() => splitBegetDomain(d, zones)).toThrow(/неверный домен/);
    expect(() => regruNss(['ns1.foo-', 'ns2.beget.com'])).toThrow(/DNS-сервер/);
  });
});

describe('REG.RU: moving a domain to other DNS servers', () => {
  it('sends 2–4 checked servers as ns0..ns3', () => {
    expect(regruRequest('set_nss', { domain: 'site.ru', nss: BEGET_NS })).toEqual({
      path: 'domain/update_nss',
      data: { domains: [{ dname: 'site.ru' }], nss: { ns0: 'ns1.beget.com', ns1: 'ns2.beget.com', ns2: 'ns1.beget.pro', ns3: 'ns2.beget.pro' } },
    });
    expect(() => regruNss(['ns1.beget.com'])).toThrow(/от 2 до 4/);
    expect(() => regruNss(['a.ru', 'a.ru'])).toThrow(/повторяются/);
    expect(() => regruNss(['ns1.x.ru', 'bad host'])).toThrow(/неверный DNS-сервер/);
  });
});

describe('Site in 5 minutes', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  async function connectBoth() {
    const beget = begetFake(path => path === 'user/getAccountInfo' ? bOk({}) : path === 'domain/getZoneList' ? ZONES : path === 'domain/addVirtual' ? bOk(10) : bOk(true));
    const regruSent: string[] = [];
    const regruFetch = async (url: string) => {
      regruSent.push(url.replace('https://api.reg.ru/api/regru2/', ''));
      return new Response(JSON.stringify({ result: 'success', answer: { domains: [{ dname: 'site.ru', result: 'success' }] } }), { headers: { 'content-type': 'application/json' } });
    };
    __setMcpFactoryForTests((s, t) => s.id === 'beget' ? new BegetConnection(t ?? '', beget.fetchImpl) : new RegruConnection(t ?? '', regruFetch));
    await mcpManager.connect('beget', 'me:pw');
    await mcpManager.connect('regru', 'me@mail.ru:pw');
    return { beget, regruSent };
  }

  it('the prompt carries the step-by-step recipe only when both services are connected', async () => {
    await connectBoth();
    const p = mcpSystemPrompt();
    expect(p).toContain('Сайт на Beget с доменом с REG.RU');
    expect(p).toContain('ns1.beget.com, ns2.beget.com, ns1.beget.pro, ns2.beget.pro');
    await mcpManager.disconnect('regru');
    expect(mcpSystemPrompt()).not.toContain('Сайт на Beget с доменом с REG.RU');
  });

  it('every step is confirmed separately and explained in plain words', async () => {
    const { beget, regruSent } = await connectBoth();
    const nss = summarizeAction({ tool: 'mcp_regru__set_nss', args: { domain: 'site.ru', nss: BEGET_NS }, source: 'llm' });
    expect(nss.lines[0]).toBe('Что будет: REG.RU: домен site.ru будут обслуживать DNS-серверы (Beget): ns1.beget.com, ns2.beget.com, ns1.beget.pro, ns2.beget.pro');
    expect(nss.warning).toMatch(/до 24 часов/);
    expect(summarizeAction({ tool: 'mcp_beget__add_domain', args: { fqdn: 'site.ru' }, source: 'llm' }).lines[0]).toBe('Что будет: Beget: добавить домен site.ru в аккаунт');
    // показывается ровно то, что уйдёт в API: кириллица как punycode рядом с исходным написанием
    expect(summarizeAction({ tool: 'mcp_beget__add_domain', args: { fqdn: 'Тест.рф' }, source: 'llm' }).lines[0]).toBe('Что будет: Beget: добавить домен xn--e1aybc.xn--p1ai (тест.рф) в аккаунт');
    expect(summarizeAction({ tool: 'mcp_beget__add_site', args: { name: 'Site.RU' }, source: 'llm' }).lines[0]).toBe('Что будет: Beget: создать сайт site.ru');
    expect(summarizeAction({ tool: 'mcp_regru__set_nss', args: { domain: 'тест.рф', nss: BEGET_NS }, source: 'llm' }).lines[0]).toMatch(/^Что будет: REG\.RU: домен xn--e1aybc\.xn--p1ai \(тест\.рф\) будут/);
    const seen: string[] = [];
    setActionConfirmer(async (_r, s) => { seen.push(s.title); return true; });
    const r = await runMcpActions([
      { tool: 'mcp_beget__add_domain', args: { fqdn: 'site.ru' }, source: 'llm' },
      { tool: 'mcp_beget__link_domain', args: { domain_id: 10, site_id: 5 }, source: 'llm' },
      { tool: 'mcp_regru__set_nss', args: { domain: 'site.ru', nss: BEGET_NS }, source: 'llm' },
    ]);
    expect(r.lines.every(l => l.startsWith('✅'))).toBe(true);
    expect(seen).toHaveLength(3);
    expect(beget.sent.map(s => s.path)).toContain('domain/addVirtual');
    expect(regruSent).toContain('domain/update_nss');
  });
});
