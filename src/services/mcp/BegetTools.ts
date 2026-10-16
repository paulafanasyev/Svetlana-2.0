// Beget: удалённого MCP у хостинга нет, поэтому Светлана работает с ним напрямую через Beget API
// (https://api.beget.com/api/<раздел>/<метод>). Набор запросов зашит в код: просмотр аккаунта, сайтов, доменов и DNS,
// смена DNS-записей и привязка домена к сайту. Логин и пароль API уходят только в теле POST-запроса (не в адресе),
// без редиректов и cookies. Каждое изменение пользователь подтверждает на экране (см. McpManager).
import { safeJsonParse, stripControl } from '../security/SafeData';
import { guardedFetch, readLimited, McpError, type FetchLike, type McpCallResult, type McpConnection, type McpToolDef } from './McpClient';

const BASE = 'https://api.beget.com/api';
const MAX_RESULT_CHARS = 20_000;
const MAX_RECORDS = 10;

const fqdnProp = { type: 'string', description: 'Domain or subdomain, e.g. example.ru or www.example.ru' };
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
      a: listProp('IPv4 addresses (A), up to 10; [] to remove all'),
      mx: listProp('MX as "priority host", up to 10; [] to remove all'),
      txt: listProp('TXT values, up to 10; [] to remove all'),
      ns: listProp('NS hosts for a subdomain, up to 10'),
      cname: { type: 'string', description: 'CNAME target for a subdomain' },
    }, required: ['fqdn'] } },
  { name: 'link_domain', title: 'Привязать домен к сайту', readOnly: false, description: 'Привязывает домен к сайту (номера из list_domains и list_sites).',
    inputSchema: { type: 'object', properties: { domain_id: { type: 'number', description: 'Domain id' }, site_id: { type: 'number', description: 'Site id' } }, required: ['domain_id', 'site_id'] } },
]);

const bad = (what: string) => new McpError(`Beget: ${what}`, 'protocol');

const LOGIN_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
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

function host(v: unknown, what: string): string {
  if (typeof v !== 'string') throw bad(`нужно указать ${what}`);
  const h = v.trim().toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(h)) throw bad(`неверный ${what}: ${stripControl(v, false).slice(0, 80)}`);
  return h;
}

function list(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw bad(`${what}: нужен список строк`);
  if (v.length > MAX_RECORDS) throw bad(`${what}: не больше ${MAX_RECORDS} записей`);
  return v as string[];
}

function positiveId(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 1e12) throw bad(`неверный ${what}`);
  return v;
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
    let req: { path: string; data?: Record<string, unknown> };
    try { req = begetRequest(name, args); } catch (e) {
      if (e instanceof McpError) return { text: e.message, isError: true };
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
}
