// REG.RU: удалённого MCP у регистратора нет, поэтому Светлана работает с ним напрямую через Рег.API 2
// (https://api.reg.ru/api/regru2/<раздел>/<функция>). Набор запросов зашит в код: баланс, список доменов, DNS-серверы
// и записи зоны (чтение), добавление и удаление одной DNS-записи. Записи добавляются по одной, поэтому остальные
// записи домена не трогаются. Логин и пароль API уходят только в теле POST-запроса, без редиректов и cookies.
// REG.RU пускает к API только с IP-адресов из «Настроек API», иначе отвечает ACCESS_DENIED_FROM_IP.
import { safeJsonParse, stripControl } from '../security/SafeData';
import { guardedFetch, readLimited, McpError, type FetchLike, type McpCallResult, type McpConnection, type McpToolDef } from './McpClient';

const BASE = 'https://api.reg.ru/api/regru2';
const MAX_RESULT_CHARS = 20_000;

const domainProp = { type: 'string', description: 'Домен, например example.ru' };
const subProp = { type: 'string', description: 'Поддомен: @ для самого домена, www, mail, _dmarc и т. п.' };
export const REGRU_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'] as const;
type RecType = typeof REGRU_RECORD_TYPES[number];

export const REGRU_TOOLS: readonly McpToolDef[] = Object.freeze([
  { name: 'get_balance', title: 'Баланс', readOnly: true, description: 'Баланс счёта REG.RU в рублях.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_domains', title: 'Домены', readOnly: true, description: 'Список доменов: имя, состояние и срок действия.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'get_nss', title: 'DNS-серверы', readOnly: true, description: 'DNS-серверы (NS), на которые делегирован домен.',
    inputSchema: { type: 'object', properties: { domain: domainProp }, required: ['domain'] } },
  { name: 'get_dns', title: 'DNS-записи', readOnly: true, description: 'Все DNS-записи домена (работает, если домен на DNS-серверах REG.RU).',
    inputSchema: { type: 'object', properties: { domain: domainProp }, required: ['domain'] } },
  { name: 'add_record', title: 'Добавить DNS-запись', readOnly: false,
    description: 'Добавляет одну DNS-запись, остальные записи домена не меняются. Типы: A (IPv4), AAAA (IPv6), CNAME (адрес другого домена), MX (почта, с приоритетом), TXT.',
    inputSchema: { type: 'object', properties: {
      domain: domainProp, subdomain: subProp,
      type: { type: 'string', enum: [...REGRU_RECORD_TYPES], description: 'Тип записи' },
      value: { type: 'string', description: 'IP-адрес, адрес сервера или текст TXT' },
      priority: { type: 'number', description: 'Приоритет MX (обычно 10)' },
    }, required: ['domain', 'subdomain', 'type', 'value'] } },
  { name: 'remove_record', title: 'Удалить DNS-запись', readOnly: false,
    description: 'Удаляет одну DNS-запись с точным значением (сначала вызовите get_dns). Остальные записи не меняются.',
    inputSchema: { type: 'object', properties: {
      domain: domainProp, subdomain: subProp,
      type: { type: 'string', enum: [...REGRU_RECORD_TYPES], description: 'Тип записи' },
      value: { type: 'string', description: 'Точное значение записи из get_dns' },
      priority: { type: 'number', description: 'Приоритет MX' },
    }, required: ['domain', 'subdomain', 'type', 'value'] } },
]);

const bad = (what: string) => new McpError(`REG.RU: ${what}`, 'protocol');
const show = (v: unknown, n = 80) => stripControl(String(v ?? ''), false).slice(0, n);

const LOGIN_RE = /^[A-Za-z0-9_.@+-]{1,100}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const SUB_RE = /^(?=.{1,200}$)(?:@|\*|(?:\*\.)?[a-z0-9_](?:[a-z0-9_-]{0,62})(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}))*)$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_RE = /^(?=.{2,39}$)[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/;

/** Логин и пароль API из поля ввода в виде «логин:пароль». Логином может быть e-mail, пароль может содержать двоеточие. */
export function parseRegruCredentials(token: string): { login: string; password: string } {
  const t = (token ?? '').trim();
  const i = t.indexOf(':');
  const login = i > 0 ? t.slice(0, i) : '';
  const password = i > 0 ? t.slice(i + 1) : '';
  if (!LOGIN_RE.test(login) || !password || password.length > 256 || stripControl(password, false) !== password) {
    throw new McpError('REG.RU: вставьте логин и пароль API через двоеточие, например mylogin:пароль. Пароль API задаётся в «Настройках API» личного кабинета REG.RU.', 'auth');
  }
  return { login, password };
}

function domain(v: unknown): string {
  if (typeof v !== 'string') throw bad('нужно указать домен');
  const h = v.trim().toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(h)) throw bad(`неверный домен: ${show(v)}`);
  return h;
}

function subdomain(v: unknown): string {
  if (typeof v !== 'string') throw bad('нужно указать поддомен (@ для самого домена)');
  const s = v.trim().toLowerCase();
  if (!SUB_RE.test(s)) throw bad(`неверный поддомен: ${show(v)}`);
  return s;
}

function recType(v: unknown): RecType {
  const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!(REGRU_RECORD_TYPES as readonly string[]).includes(t)) throw bad(`тип записи должен быть одним из: ${REGRU_RECORD_TYPES.join(', ')}`);
  return t as RecType;
}

function priority(v: unknown): number {
  if (v === undefined) return 10;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 65535) throw bad('приоритет MX: целое число от 0 до 65535');
  return v;
}

/** Проверенное значение записи по её типу. exact — вернуть значение как есть (для удаления: REG.RU сравнивает точно). */
function recValue(type: RecType, v: unknown, exact = false): string {
  if (typeof v !== 'string' || !v.trim()) throw bad('нужно указать значение записи');
  const s = v.trim();
  if (type === 'A') { if (!IPV4_RE.test(s)) throw bad(`неверный IPv4-адрес: ${show(v, 40)}`); return s; }
  if (type === 'AAAA') { const x = s.toLowerCase(); if (!IPV6_RE.test(x)) throw bad(`неверный IPv6-адрес: ${show(v, 40)}`); return x; }
  if (type === 'CNAME' || type === 'MX') {
    const h = s.toLowerCase().replace(/\.$/, '');
    if (!HOST_RE.test(h)) throw bad(`неверный адрес сервера: ${show(v)}`);
    return exact ? s : h;
  }
  if (v.length > 1000 || stripControl(v, false) !== v) throw bad('TXT: до 1000 символов, без переносов строк');
  return exact ? v : s; // при удалении TXT сравнивается побайтно, поэтому пробелы по краям сохраняем
}

export interface RegruRecord { domain: string; subdomain: string; type: RecType; value: string; priority?: number }

/** Проверенная запись для add_record/remove_record (используется и для текста подтверждения). */
export function regruRecord(args: Record<string, unknown>, exact = false): RegruRecord {
  const type = recType(args.type);
  return {
    domain: domain(args.domain), subdomain: subdomain(args.subdomain), type, value: recValue(type, args.value, exact),
    ...(type === 'MX' ? { priority: priority(args.priority) } : {}),
  };
}

const ADD_FN: Record<RecType, string> = { A: 'zone/add_alias', AAAA: 'zone/add_aaaa', CNAME: 'zone/add_cname', MX: 'zone/add_mx', TXT: 'zone/add_txt' };

/** Функция API и её аргументы для инструмента. Только фиксированные функции, значения проверены. */
export function regruRequest(name: string, args: Record<string, unknown>): { path: string; data?: Record<string, unknown> } {
  switch (name) {
    case 'get_balance': return { path: 'user/get_balance', data: { currency: 'RUR' } };
    case 'list_domains': return { path: 'service/get_list', data: { servtype: 'domain' } };
    case 'get_nss': return { path: 'domain/get_nss', data: { domains: [{ dname: domain(args.domain) }] } };
    case 'get_dns': return { path: 'zone/get_resource_records', data: { domains: [{ dname: domain(args.domain) }] } };
    case 'add_record': {
      const r = regruRecord(args);
      const base = { domains: [{ dname: r.domain }], subdomain: r.subdomain };
      if (r.type === 'A' || r.type === 'AAAA') return { path: ADD_FN[r.type], data: { ...base, ipaddr: r.value } };
      if (r.type === 'CNAME') return { path: ADD_FN.CNAME, data: { ...base, canonical_name: r.value } };
      if (r.type === 'MX') return { path: ADD_FN.MX, data: { ...base, mail_server: r.value, priority: r.priority } };
      return { path: ADD_FN.TXT, data: { ...base, text: r.value } };
    }
    case 'remove_record': {
      // content обязателен и передаётся точно как в get_dns: без него REG.RU удалил бы все записи этого типа у поддомена.
      const r = regruRecord(args, true);
      return { path: 'zone/remove_record', data: {
        domains: [{ dname: r.domain }], subdomain: r.subdomain, record_type: r.type, content: r.value,
        ...(r.type === 'MX' ? { priority: r.priority } : {}),
      } };
    }
    default: throw bad(`нет инструмента ${show(name, 60)}`);
  }
}

/** REG.RU отказал в запросе (неверные данные, домен не на его DNS): это ответ на действие, а не поломка подключения. */
class RegruRejected extends Error {}

const AUTH_CODES = new Set(['NO_USERNAME', 'NO_AUTH', 'PASSWORD_AUTH_FAILED', 'INVALID_AUTH', 'ACCESS_DENIED', 'ACCOUNT_BLOCKED']);

function scrub(text: string, password: string): string {
  return password ? text.split(password).join('[пароль скрыт]') : text;
}

export class RegruConnection implements McpConnection {
  private readonly login: string;
  private readonly password: string;

  constructor(token: string, private readonly fetchImpl: FetchLike = (u, i) => globalThis.fetch(u, i)) {
    const c = parseRegruCredentials(token);
    this.login = c.login;
    this.password = c.password;
  }

  /** Вызов функции API. Возвращает поле answer или бросает ошибку. */
  private async request(path: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({ username: this.login, password: this.password, input_format: 'json', output_format: 'json' });
    body.set('input_data', JSON.stringify(data ?? {}));
    const res = await guardedFetch(this.fetchImpl, `${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    }, 'REG.RU');
    const text = await readLimited(res, 'REG.RU');
    if (res.status === 401 || res.status === 403) throw new McpError(`REG.RU: доступ запрещён (${res.status})`, 'auth');
    if (!res.ok) throw new McpError(`REG.RU: сервер ответил ${res.status}`, 'protocol');
    let o: Record<string, unknown> | null;
    try { o = safeJsonParse(text, 4_000_000) as Record<string, unknown> | null; } catch { throw new McpError('REG.RU: сервер вернул не JSON', 'protocol'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new McpError('REG.RU: непонятный ответ сервера', 'protocol');
    if (o.result !== 'success') {
      const code = typeof o.error_code === 'string' ? o.error_code : '';
      const msg = scrub(show(o.error_text, 200), this.password);
      if (code === 'ACCESS_DENIED_FROM_IP') {
        throw new McpError('REG.RU: запрос пришёл с IP-адреса, которого нет в разрешённых. В личном кабинете REG.RU откройте «Настройки API» и добавьте свой внешний IP-адрес в список.', 'auth');
      }
      if (AUTH_CODES.has(code)) {
        throw new McpError('REG.RU: логин или пароль API не подошли, либо доступ к API выключен. Проверьте «Настройки API» в личном кабинете REG.RU.', 'auth');
      }
      throw new RegruRejected(`REG.RU: ${code || 'ошибка'}${msg ? ` (${msg})` : ''}`);
    }
    const answer = o.answer ?? {};
    if (typeof answer !== 'object' || Array.isArray(answer) || answer === null) throw new McpError('REG.RU: ответ без данных', 'protocol');
    return answer as Record<string, unknown>;
  }

  async initialize(): Promise<void> {
    await this.request('user/nop').catch((e: unknown) => {
      if (e instanceof RegruRejected) throw new McpError(e.message, 'protocol');
      throw e;
    });
  }

  async listTools(): Promise<McpToolDef[]> { return REGRU_TOOLS.map(t => ({ ...t })); }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    // Неверные аргументы и отказ REG.RU возвращаются как результат действия: подключение остаётся рабочим.
    let req: { path: string; data?: Record<string, unknown> };
    try { req = regruRequest(name, args); } catch (e) {
      if (e instanceof McpError) return { text: e.message, isError: true };
      throw e;
    }
    let a: Record<string, unknown>;
    try { a = await this.request(req.path, req.data); } catch (e) {
      if (e instanceof RegruRejected) return { text: e.message, isError: true };
      throw e;
    }
    // Ответ по каждому домену: у домена может быть своя ошибка (например, он не на DNS-серверах REG.RU).
    const failed = (Array.isArray(a.domains) ? a.domains : [])
      .filter((d: any) => d && typeof d === 'object' && d.result !== undefined && d.result !== 'success')
      .map((d: any) => `${show(d.dname, 100)}: ${show(d.error_code, 60) || 'ERROR'}${d.error_text ? ` (${show(d.error_text, 200)})` : ''}`);
    let text = failed.length ? failed.join('\n') : JSON.stringify(a);
    text = scrub(stripControl(text), this.password);
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n…(обрезано)`;
    return { text, isError: failed.length > 0 };
  }
}
