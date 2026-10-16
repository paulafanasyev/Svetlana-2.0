// Beget: удалённого MCP у хостинга нет, поэтому Светлана работает с ним напрямую через Beget API
// (https://api.beget.com/api/<раздел>/<метод>). Набор запросов зашит в код: просмотр аккаунта, сайтов, доменов и DNS,
// смена DNS-записей, добавление домена и сайта, привязка домена к сайту. Логин и пароль API уходят только в теле POST-запроса (не в адресе),
// без редиректов и cookies. Каждое изменение пользователь подтверждает на экране (см. McpManager).
import { safeJsonParse, stripControl } from '../security/SafeData';
import { guardedFetch, readLimited, McpError, type FetchLike, type McpCallResult, type McpConnection, type McpToolDef } from './McpClient';

const BASE = 'https://api.beget.com/api';
const MAX_RESULT_CHARS = 20_000;
const MAX_RECORDS = 10;

const fqdnProp = { type: 'string', description: 'Домен или поддомен, например example.ru или www.example.ru' };
const listProp = (d: string) => ({ type: 'array', items: { type: 'string' }, description: d });

export const BEGET_TOOLS: readonly McpToolDef[] = Object.freeze([
  { name: 'account_info', title: 'Аккаунт', readOnly: true, description: 'Сведения об аккаунте Beget: тариф, баланс и лимиты.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_sites', title: 'Сайты', readOnly: true, description: 'Список сайтов: номер, папка и привязанные домены.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_domains', title: 'Домены', readOnly: true, description: 'Список доменов: номер, имя и срок действия.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'get_dns', title: 'DNS-записи', readOnly: true, description: 'Текущие DNS-записи домена. Получите их перед изменением.',
    inputSchema: { type: 'object', properties: { fqdn: fqdnProp }, required: ['fqdn'] } },
  { name: 'change_dns', title: 'Изменить DNS', readOnly: false,
    description: 'Заменяет все DNS-записи домена: всё, чего нет в новом списке, будет удалено. Сначала вызовите get_dns и перенесите записи, которые должны остаться. '
      + 'Передайте одну группу: a, mx и txt вместе, или ns (для поддомена), или cname (для поддомена). Запись mx: "10 mx1.beget.ru".',
    inputSchema: { type: 'object', properties: {
      fqdn: fqdnProp,
      a: listProp('IPv4-адреса (A), до 10; пустой список удалит все записи этого типа'),
      mx: listProp('MX в формате «приоритет сервер», например "10 mx1.beget.com", до 10; пустой список удалит все записи этого типа'),
      txt: listProp('TXT-записи, до 10; пустой список удалит все записи этого типа'),
      ns: listProp('DNS-серверы поддомена, до 10'),
      cname: { type: 'string', description: 'Адрес CNAME для поддомена' },
    }, required: ['fqdn'] } },
  { name: 'add_domain', title: 'Добавить домен в аккаунт', readOnly: false,
    description: 'Добавляет уже зарегистрированный домен (где угодно, например на REG.RU) в аккаунт Beget. Регистрацию домена не оформляет. Возвращает номер домена для link_domain.',
    inputSchema: { type: 'object', properties: { fqdn: { type: 'string', description: 'Домен, например example.ru' } }, required: ['fqdn'] } },
  { name: 'add_site', title: 'Создать сайт', readOnly: false,
    description: 'Создаёт новый пустой сайт (папку) в аккаунте Beget и возвращает его номер (site_id) для link_domain. Файлы сайта загружаются отдельно, не через API.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Имя папки сайта, например example.ru' } }, required: ['name'] } },
  { name: 'link_domain', title: 'Привязать домен к сайту', readOnly: false, description: 'Привязывает домен к сайту (номера из list_domains и list_sites).',
    inputSchema: { type: 'object', properties: { domain_id: { type: 'number', description: 'Номер домена' }, site_id: { type: 'number', description: 'Номер сайта' } }, required: ['domain_id', 'site_id'] } },
]);

/** Неверные аргументы действия (проверка до запроса): это ответ модели, а не поломка подключения. */
class BegetInvalid extends McpError {}
const bad = (what: string) => new BegetInvalid(`Beget: ${what}`, 'protocol');

const LOGIN_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Логин и пароль API из поля «токен» в виде «логин:пароль». Пароль может содержать двоеточие. */
export function parseBegetCredentials(token: string): { login: string; password: string } {
  const t = (token ?? '').trim();
  const i = t.indexOf(':');
  const login = i > 0 ? t.slice(0, i) : '';
  const password = i > 0 ? t.slice(i + 1) : '';
  if (!LOGIN_RE.test(login) || !password || password.length > 256 || stripControl(password, false) !== password) {
    throw new McpError('Beget: вставьте логин и пароль API через двоеточие, например mylogin:пароль. Пароль API задаётся в панели Beget отдельно от пароля входа.', 'auth');
  }
  return { login, password };
}

/**
 * Домен в ASCII (punycode): «тест.рф» → «xn--e1aybc.xn--p1ai». Преобразуется только строка из букв, цифр,
 * точек и дефисов, иначе возвращается как есть (дальше её отклонит проверка). Регистр приводится к нижнему.
 */
export function asciiDomain(v: string): string {
  const s = v.trim().toLowerCase().replace(/\.$/, '');
  if (!/[^\x00-\x7f]/.test(s) || !/^[\p{L}\p{N}\p{M}.-]{1,253}$/u.test(s)) return s;
  try { return new URL(`http://${s}/`).hostname; } catch { return s; }
}

function host(v: unknown, what: string): string {
  if (typeof v !== 'string') throw bad(`нужно указать ${what}`);
  const h = asciiDomain(v);
  if (!HOST_RE.test(h)) throw bad(`неверный ${what}: ${stripControl(v, false).slice(0, 80)}`);
  return h;
}

/** Проверенный домен в том виде, в каком он уйдёт в Beget (для окна подтверждения). */
export function begetFqdn(v: unknown): string { return host(v, 'домен'); }

/** Проверенное имя сайта в том виде, в каком оно уйдёт в Beget. */
export function begetSiteName(v: unknown): string { return siteName(v); }

function list(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw bad(`${what}: нужен список строк`);
  if (v.length > MAX_RECORDS) throw bad(`${what}: не больше ${MAX_RECORDS} записей`);
  return v as string[];
}

function positiveId(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 1e12) throw bad(`неверный ${what}`);
  return v;
}

const SITE_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

function siteName(v: unknown): string {
  const n = typeof v === 'string' ? asciiDomain(v) : '';
  if (!SITE_RE.test(n) || n.includes('..')) throw bad('имя сайта: латинские буквы, цифры, точка, дефис и подчёркивание, до 64 символов');
  return n;
}

/** Имя домена без зоны и зона для domain/addVirtual: выбирается самая длинная подходящая зона Beget. */
export function splitBegetDomain(fqdn: unknown, zones: Record<string, number>): { hostname: string; zone_id: number; zone: string } {
  const h = host(fqdn, 'домен');
  const labels = h.split('.');
  for (let i = 1; i < labels.length; i++) {
    const zone = labels.slice(i).join('.');
    if (Object.prototype.hasOwnProperty.call(zones, zone)) {
      const hostname = labels.slice(0, i).join('.');
      if (hostname.includes('.')) throw bad(`${h}: указан поддомен. Сначала добавьте основной домен ${labels.slice(i - 1).join('.')}, а поддомен потом настройте в его DNS-записях.`);
      return { hostname, zone_id: zones[zone], zone };
    }
  }
  throw bad(`Beget не работает с зоной домена ${h}`);
}

/** Зоны из ответа domain/getZoneList: {"ru": {"id": "1", "zone": "ru"}, …} → {ru: 1}. */
export function begetZones(result: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!result || typeof result !== 'object') return out;
  for (const v of Object.values(result as Record<string, any>)) {
    const zone = typeof v?.zone === 'string' ? asciiDomain(v.zone) : '';
    const id = Number(v?.id);
    if (zone && /^[a-z0-9.-]{2,63}$/.test(zone) && Number.isInteger(id) && id > 0) out[zone] = id;
  }
  return out;
}

type Rec = { priority: number; value: string };

/** Записи для dns/changeRecords. Группа A/MX/TXT передаётся только целиком, чтобы ничего не стёрлось случайно. */
export function begetDnsRecords(args: Record<string, unknown>): Record<string, Rec[]> {
  const has = (k: string) => args[k] !== undefined;
  const groups = [has('a') || has('mx') || has('txt'), has('ns'), has('cname')].filter(Boolean).length;
  if (groups !== 1) throw bad('передайте ровно одну группу записей: a, mx и txt вместе, или ns, или cname');
  const step = (i: number) => (i + 1) * 10;
  if (has('ns')) {
    const ns = list(args.ns, 'ns');
    if (!ns.length) throw bad('ns: нужна хотя бы одна запись');
    return { NS: ns.map((v, i) => ({ priority: step(i), value: host(v, 'NS-сервер') })) };
  }
  if (has('cname')) return { CNAME: [{ priority: 10, value: host(args.cname, 'адрес CNAME') }] };
  if (!has('a') || !has('mx') || !has('txt')) {
    throw bad('Beget заменяет A, MX и TXT вместе: передайте все три списка (возьмите текущие записи из get_dns, пустой список удалит записи этого типа)');
  }
  const a = list(args.a, 'a').map(v => { const ip = v.trim(); if (!IPV4_RE.test(ip)) throw bad(`неверный IP-адрес: ${stripControl(v, false).slice(0, 40)}`); return { priority: 0, value: ip }; });
  const mx = list(args.mx, 'mx').map(v => {
    const m = /^\s*(\d{1,5})\s+(\S+)\s*$/.exec(v);
    const p = m ? Number(m[1]) : NaN;
    if (!m || p > 65535) throw bad(`MX пишется как «приоритет сервер», например 10 mx1.beget.ru: ${stripControl(v, false).slice(0, 60)}`);
    return { priority: p, value: host(m[2], 'почтовый сервер') };
  });
  const txt = list(args.txt, 'txt').map((v, i) => {
    if (v.length > 255 || stripControl(v, false) !== v) throw bad('TXT: до 255 символов, без переносов строк');
    return { priority: step(i), value: v };
  });
  return { A: a, MX: mx, TXT: txt };
}

/** Раздел, метод и аргументы запроса для инструмента. Только фиксированные методы, значения проверены. */
export function begetRequest(name: string, args: Record<string, unknown>): { path: string; data?: Record<string, unknown> } {
  switch (name) {
    case 'account_info': return { path: 'user/getAccountInfo' };
    case 'list_sites': return { path: 'site/getList' };
    case 'list_domains': return { path: 'domain/getList' };
    case 'get_dns': return { path: 'dns/getData', data: { fqdn: host(args.fqdn, 'домен') } };
    case 'change_dns': return { path: 'dns/changeRecords', data: { fqdn: host(args.fqdn, 'домен'), records: begetDnsRecords(args) } };
    case 'add_site': return { path: 'site/add', data: { name: siteName(args.name) } };
    case 'link_domain': return { path: 'site/linkDomain', data: { domain_id: positiveId(args.domain_id, 'domain_id'), site_id: positiveId(args.site_id, 'site_id') } };
    default: throw bad(`нет инструмента ${stripControl(name, false).slice(0, 60)}`);
  }
}

/** Beget отказал в запросе (неверные данные, лимит): это ответ на действие, а не поломка подключения. */
class BegetRejected extends Error {}

function scrub(text: string, password: string): string {
  return password ? text.split(password).join('[пароль скрыт]') : text;
}

export class BegetConnection implements McpConnection {
  private readonly login: string;
  private readonly password: string;

  constructor(token: string, private readonly fetchImpl: FetchLike = (u, i) => globalThis.fetch(u, i)) {
    const c = parseBegetCredentials(token);
    this.login = c.login;
    this.password = c.password;
  }

  /** Вызов метода API. Возвращает поле answer (с собственным status) или бросает ошибку запроса. */
  private async request(path: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({ login: this.login, passwd: this.password, input_format: 'json', output_format: 'json' });
    if (data) body.set('input_data', JSON.stringify(data));
    const res = await guardedFetch(this.fetchImpl, `${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    }, 'Beget');
    const text = await readLimited(res, 'Beget');
    if (res.status === 401 || res.status === 403) throw new McpError(`Beget: доступ запрещён (${res.status})`, 'auth');
    if (!res.ok) throw new McpError(`Beget: сервер ответил ${res.status}`, 'protocol');
    let o: Record<string, unknown> | null;
    try { o = safeJsonParse(text, 4_000_000) as Record<string, unknown> | null; } catch { throw new McpError('Beget: сервер вернул не JSON', 'protocol'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new McpError('Beget: непонятный ответ сервера', 'protocol');
    if (o.status !== 'success') {
      const code = typeof o.error_code === 'string' ? o.error_code : '';
      const msg = scrub(stripControl(typeof o.error_text === 'string' ? o.error_text : '', false), this.password).slice(0, 200);
      if (code === 'AUTH_ERROR') {
        throw new McpError('Beget: логин или пароль API не подошли, доступ к API выключен или ваш IP не в разрешённых. Проверьте настройки API в панели Beget.', 'auth');
      }
      throw new BegetRejected(`Beget: ${code || 'ошибка'}${msg ? ` (${msg})` : ''}`);
    }
    const answer = o.answer;
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new McpError('Beget: ответ без данных', 'protocol');
    return answer as Record<string, unknown>;
  }

  async initialize(): Promise<void> {
    const a = await this.request('user/getAccountInfo').catch((e: unknown) => {
      if (e instanceof BegetRejected) throw new McpError(e.message, 'protocol');
      throw e;
    });
    if (a.status !== 'success') throw new McpError('Beget: не удалось прочитать данные аккаунта', 'auth');
  }

  async listTools(): Promise<McpToolDef[]> { return BEGET_TOOLS.map(t => ({ ...t })); }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    // Неверные аргументы и отказ Beget возвращаются как результат действия: подключение при этом остаётся рабочим.
    if (name === 'add_domain') return this.addDomain(args);
    if (name === 'add_site') return this.addSite(args);
    let req: { path: string; data?: Record<string, unknown> };
    try { req = begetRequest(name, args); } catch (e) {
      if (e instanceof BegetInvalid) return { text: e.message, isError: true };
      throw e;
    }
    let a: Record<string, unknown>;
    try { a = await this.request(req.path, req.data); } catch (e) {
      if (e instanceof BegetRejected) return { text: e.message, isError: true };
      throw e;
    }
    let text: string;
    let isError = false;
    if (a.status === 'success') {
      text = JSON.stringify(a.result ?? null);
      if (name === 'change_dns' || name === 'link_domain') isError = a.result !== true && a.result !== 1;
    } else {
      isError = true;
      const errs = Array.isArray(a.errors) ? a.errors : [];
      text = errs.slice(0, 10).map((e: any) => `${typeof e?.error_code === 'string' ? e.error_code : 'ERROR'}: ${typeof e?.error_text === 'string' ? e.error_text : ''}`).join('\n') || 'Beget не выполнил запрос';
    }
    text = scrub(stripControl(text), this.password);
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n…(обрезано)`;
    return { text, isError };
  }

  /**
   * Создание сайта: site/add отвечает только «да/нет», поэтому номер нового сайта берётся из site/getList
   * по папке «имя/public_html».
   */
  private async addSite(args: Record<string, unknown>): Promise<McpCallResult> {
    const fail = (text: string): McpCallResult => ({ text: scrub(stripControl(text), this.password).slice(0, 2000), isError: true });
    try {
      const req = begetRequest('add_site', args);
      const name = String(req.data?.name);
      const a = await this.request(req.path, req.data);
      if (a.status !== 'success' || (a.result !== true && a.result !== 1)) {
        const errs = Array.isArray(a.errors) ? a.errors : [];
        return fail(errs.slice(0, 5).map((e: any) => `${typeof e?.error_code === 'string' ? e.error_code : 'ERROR'}: ${typeof e?.error_text === 'string' ? e.error_text : ''}`).join('\n') || 'Beget не создал сайт');
      }
      const l = await this.request('site/getList');
      if (l.status !== 'success' || !Array.isArray(l.result)) return fail('Сайт создан, но Beget не прислал список сайтов. Обновите список сайтов (list_sites) и повторите привязку домена.');
      const sites = l.result;
      const site = sites.find((x: any) => typeof x?.path === 'string' && x.path.toLowerCase().replace(/\/+$/, '') === `${name}/public_html`);
      const id = Number(site?.id);
      if (!(Number.isInteger(id) && id > 0)) {
        return { text: JSON.stringify({ created: true, name, note: 'Сайт создан, но его номер не найден. Обновите список сайтов (list_sites) и повторите привязку домена.' }), isError: false };
      }
      return { text: JSON.stringify({ site_id: id, name, path: `${name}/public_html` }), isError: false };
    } catch (e) {
      if (e instanceof BegetInvalid || e instanceof BegetRejected) return fail(e.message);
      throw e;
    }
  }

  /** Добавление домена: зона берётся из domain/getZoneList, затем domain/addVirtual. */
  private async addDomain(args: Record<string, unknown>): Promise<McpCallResult> {
    const fail = (text: string): McpCallResult => ({ text: scrub(stripControl(text), this.password).slice(0, 2000), isError: true });
    try {
      host(args.fqdn, 'домен');
      const z = await this.request('domain/getZoneList');
      if (z.status !== 'success') return fail('Beget не прислал список доменных зон');
      const d = splitBegetDomain(args.fqdn, begetZones(z.result));
      const a = await this.request('domain/addVirtual', { hostname: d.hostname, zone_id: d.zone_id });
      if (a.status !== 'success') {
        const errs = Array.isArray(a.errors) ? a.errors : [];
        return fail(errs.slice(0, 5).map((e: any) => `${typeof e?.error_code === 'string' ? e.error_code : 'ERROR'}: ${typeof e?.error_text === 'string' ? e.error_text : ''}`).join('\n') || 'Beget не добавил домен');
      }
      const id = Number(a.result);
      if (!(id > 0)) return fail('Beget не вернул номер домена');
      return { text: JSON.stringify({ domain_id: id, fqdn: `${d.hostname}.${d.zone}` }), isError: false };
    } catch (e) {
      if (e instanceof BegetInvalid || e instanceof BegetRejected) return fail(e.message);
      throw e;
    }
  }
}
