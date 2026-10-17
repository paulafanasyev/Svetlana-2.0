// Selectel: официального удалённого MCP нет, поэтому Светлана работает с ним напрямую через публичные API
// (https://docs.selectel.ru/api/). Набор запросов зашит в код: баланс, DNS-зоны и записи (DNS-хостинг актуальной версии,
// api.selectel.ru/domains/v2), добавление и удаление одной DNS-записи. Вход через сервисного пользователя: приложение
// само получает IAM-токен (Keystone) на 24 часа и обновляет его. Пароль уходит только в теле POST-запроса к Keystone,
// без редиректов и cookies. Каждое изменение пользователь подтверждает на экране (см. McpManager).
import { safeJsonParse, stripControl } from '../security/SafeData';
import { asciiDomain } from './BegetTools';
import { guardedFetch, readLimited, McpError, type FetchLike, type McpCallResult, type McpConnection, type McpToolDef } from './McpClient';

export const SELECTEL_API = 'https://api.selectel.ru';
export const SELECTEL_IDENTITY = 'https://cloud.api.selcloud.ru/identity/v3/auth/tokens';
const DNS = `${SELECTEL_API}/domains/v2`;
const MAX_RESULT_CHARS = 20_000;
const DEFAULT_TTL = 3600;
const PAGE = 1000;
const MAX_PAGES = 20;
/** Токен обновляется заранее: за 10 минут до конца срока. */
const TOKEN_MARGIN_MS = 10 * 60 * 1000;
const TOKEN_FALLBACK_MS = 23 * 60 * 60 * 1000;

/** DNS-серверы Selectel (DNS-хостинг актуальной версии) — для делегирования домена, например через REG.RU set_nss. */
export const SELECTEL_NS = Object.freeze(['a.ns.selectel.ru', 'b.ns.selectel.ru', 'c.ns.selectel.ru', 'd.ns.selectel.ru']);

const domainProp = { type: 'string', description: 'Домен, например example.ru' };
const subProp = { type: 'string', description: 'Поддомен: @ для самого домена, www, mail, _dmarc и т. п.' };
export const SELECTEL_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'] as const;
type RecType = typeof SELECTEL_RECORD_TYPES[number];

export const SELECTEL_TOOLS: readonly McpToolDef[] = Object.freeze([
  { name: 'get_balance', title: 'Баланс', readOnly: true, description: 'Баланс и задолженность аккаунта Selectel.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_zones', title: 'DNS-зоны', readOnly: true, description: 'Домены, добавленные в DNS-хостинг Selectel.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'get_dns', title: 'DNS-записи', readOnly: true, description: 'Все DNS-записи домена в DNS-хостинге Selectel. Получите их перед изменением.',
    inputSchema: { type: 'object', properties: { domain: domainProp }, required: ['domain'] } },
  { name: 'add_record', title: 'Добавить DNS-запись', readOnly: false,
    description: 'Добавляет одну DNS-запись, остальные записи домена не меняются. Типы: A (IPv4), AAAA (IPv6), CNAME (адрес другого домена), MX (почта, с приоритетом), TXT.',
    inputSchema: { type: 'object', properties: {
      domain: domainProp, subdomain: subProp,
      type: { type: 'string', enum: [...SELECTEL_RECORD_TYPES], description: 'Тип записи' },
      value: { type: 'string', description: 'IP-адрес, адрес сервера или текст TXT' },
      priority: { type: 'number', description: 'Приоритет MX (обычно 10)' },
    }, required: ['domain', 'subdomain', 'type', 'value'] } },
  { name: 'remove_record', title: 'Удалить DNS-запись', readOnly: false,
    description: 'Удаляет одну DNS-запись с точным значением (сначала вызовите get_dns). Остальные записи не меняются.',
    inputSchema: { type: 'object', properties: {
      domain: domainProp, subdomain: subProp,
      type: { type: 'string', enum: [...SELECTEL_RECORD_TYPES], description: 'Тип записи' },
      value: { type: 'string', description: 'Значение записи из get_dns' },
      priority: { type: 'number', description: 'Приоритет MX' },
    }, required: ['domain', 'subdomain', 'type', 'value'] } },
]);

/** Неверные аргументы действия (проверка до запроса): это ответ модели, а не поломка подключения. */
class SelectelInvalid extends McpError {}
const bad = (what: string) => new SelectelInvalid(`Selectel: ${what}`, 'protocol');
const show = (v: unknown, n = 80) => stripControl(String(v ?? ''), false).slice(0, n);

const ACCOUNT_RE = /^\d{1,12}$/;
const NAME_RE = /^[A-Za-z0-9_.@+-][A-Za-z0-9_.@+ -]{0,99}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const SUB_RE = /^(?=.{1,200}$)(?:@|\*|(?:\*\.)?[a-z0-9_](?:[a-z0-9_-]{0,62})(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}))*)$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_RE = /^(?=.{2,39}$)[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/;

export interface SelectelCredentials { account: string; project: string; user: string; password: string }

/**
 * Данные сервисного пользователя из поля ввода: «номер_аккаунта:проект:пользователь:пароль».
 * Пароль идёт последним и может содержать двоеточия.
 */
export function parseSelectelCredentials(token: string): SelectelCredentials {
  const fail = () => new McpError('Selectel: вставьте данные сервисного пользователя через двоеточие: номер_аккаунта:проект:пользователь:пароль, например 123456:my-project:svetlana:пароль. Номер аккаунта виден в правом верхнем углу панели Selectel.', 'auth');
  const t = (token ?? '').trim();
  const parts = t.split(':');
  if (parts.length < 4) throw fail();
  const [account, project, user] = parts.map(p => p.trim());
  const password = parts.slice(3).join(':');
  if (!ACCOUNT_RE.test(account) || !NAME_RE.test(project) || !NAME_RE.test(user) || !password || password.length > 256
    || stripControl(password, false) !== password) throw fail();
  return { account, project, user, password };
}

function domain(v: unknown): string {
  if (typeof v !== 'string') throw bad('нужно указать домен');
  const h = asciiDomain(v);
  if (!HOST_RE.test(h)) throw bad(`неверный домен: ${show(v)}`);
  return h;
}

function subdomain(v: unknown): string {
  if (typeof v !== 'string') throw bad('нужно указать поддомен (@ для самого домена)');
  const s = v.trim().toLowerCase().replace(/\.$/, '');
  if (!SUB_RE.test(s)) throw bad(`неверный поддомен: ${show(v)}`);
  return s;
}

function recType(v: unknown): RecType {
  const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!(SELECTEL_RECORD_TYPES as readonly string[]).includes(t)) throw bad(`тип записи должен быть одним из: ${SELECTEL_RECORD_TYPES.join(', ')}`);
  return t as RecType;
}

function priority(v: unknown): number {
  if (v === undefined) return 10;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 65535) throw bad('приоритет MX: целое число от 0 до 65535');
  return v;
}

/** Убирает кавычки TXT-записи: Selectel хранит TXT в кавычках ("v=spf1 -all"). */
function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\"/g, '"') : s;
}

export interface SelectelRecord { domain: string; subdomain: string; type: RecType; value: string; priority?: number;
  /** Полное имя набора записей с точкой в конце, как его хранит Selectel. */ fqdn: string;
  /** Содержимое записи в формате Selectel. */ content: string }

/** Проверенная запись (используется и для текста подтверждения). */
export function selectelRecord(args: Record<string, unknown>): SelectelRecord {
  const type = recType(args.type);
  const d = domain(args.domain);
  const sub = subdomain(args.subdomain);
  if (typeof args.value !== 'string' || !args.value.trim()) throw bad('нужно указать значение записи');
  const raw = args.value.trim();
  let value: string;
  let content: string;
  const fqdn = `${sub === '@' ? d : `${sub}.${d}`}.`;
  if (type === 'A') { if (!IPV4_RE.test(raw)) throw bad(`неверный IPv4-адрес: ${show(raw, 40)}`); value = content = raw; }
  else if (type === 'AAAA') { value = raw.toLowerCase(); if (!IPV6_RE.test(value)) throw bad(`неверный IPv6-адрес: ${show(raw, 40)}`); content = value; }
  else if (type === 'CNAME' || type === 'MX') {
    value = asciiDomain(raw);
    if (!HOST_RE.test(value)) throw bad(`неверный адрес сервера: ${show(raw)}`);
    content = type === 'MX' ? `${priority(args.priority)} ${value}.` : `${value}.`;
  } else {
    value = unquote(raw);
    if (value.length > 255 || stripControl(value, false) !== value || value.includes('"')) throw bad('TXT: до 255 символов, без переносов строк и кавычек');
    content = `"${value}"`;
  }
  return { domain: d, subdomain: sub, type, value, fqdn, content, ...(type === 'MX' ? { priority: priority(args.priority) } : {}) };
}

/** Одинаковы ли две записи по смыслу (регистр имён серверов, точка в конце, кавычки TXT не важны). */
export function sameContent(type: RecType, a: string, b: string): boolean {
  const norm = (s: string) => {
    const t = s.trim();
    if (type === 'TXT') return unquote(t);
    if (type === 'MX' || type === 'CNAME') return t.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
    return t.toLowerCase();
  };
  return norm(a) === norm(b);
}

/** Selectel отказал в запросе (неверные данные, нет зоны): это ответ на действие, а не поломка подключения. */
class SelectelRejected extends Error {}

function scrub(text: string, secrets: string[]): string {
  let s = text;
  for (const x of secrets) if (x) s = s.split(x).join('[скрыто]');
  return s;
}

interface Rrset { id: string; name: string; type: string; ttl: number; records: { content: string; disabled?: boolean }[] }

export class SelectelConnection implements McpConnection {
  private readonly creds: SelectelCredentials;
  private tokens = new Map<'project' | 'account', { token: string; until: number }>();

  constructor(token: string, private readonly fetchImpl: FetchLike = (u, i) => globalThis.fetch(u, i)) {
    this.creds = parseSelectelCredentials(token);
  }

  private secrets(): string[] { return [this.creds.password, ...Array.from(this.tokens.values()).map(t => t.token)]; }

  /** IAM-токен (Keystone) на проект (DNS) или на аккаунт (баланс). Хранится только в памяти. */
  private async token(scope: 'project' | 'account', fresh = false): Promise<string> {
    const cached = this.tokens.get(scope);
    if (!fresh && cached && cached.until > Date.now()) return cached.token;
    const { account, project, user, password } = this.creds;
    const body = { auth: {
      identity: { methods: ['password'], password: { user: { name: user, domain: { name: account }, password } } },
      scope: scope === 'project' ? { project: { name: project, domain: { name: account } } } : { domain: { name: account } },
    } };
    const res = await guardedFetch(this.fetchImpl, SELECTEL_IDENTITY, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    }, 'Selectel');
    const text = await readLimited(res, 'Selectel');
    if (res.status === 401 || res.status === 403) {
      throw new McpError('Selectel: пользователь, пароль или номер аккаунта не подошли, либо у сервисного пользователя нет доступа к проекту. Проверьте их в панели Selectel → «Управление доступом» → «Сервисные пользователи».', 'auth');
    }
    if (res.status === 404 || res.status === 400) throw new McpError('Selectel: проект с таким именем не найден. Проверьте имя проекта в панели Selectel → «Облачная платформа».', 'auth');
    if (!res.ok) throw new McpError(`Selectel: сервер входа ответил ${res.status}`, 'protocol');
    const t = res.headers.get('x-subject-token') ?? '';
    if (!/^[\x21-\x7e]{16,8192}$/.test(t)) {
      throw new McpError('Selectel: не удалось получить ответ сервера входа. В браузере сайт может не показать его; если подключение не получается, откройте Светлану в приложении для Windows или Android.', 'protocol');
    }
    let until = Date.now() + TOKEN_FALLBACK_MS;
    try {
      const o = safeJsonParse(text, 2_000_000) as { token?: { expires_at?: unknown } } | null;
      const exp = typeof o?.token?.expires_at === 'string' ? Date.parse(o.token.expires_at) : NaN;
      if (Number.isFinite(exp)) until = Math.min(until, exp - TOKEN_MARGIN_MS);
    } catch { /* срок по умолчанию */ }
    this.tokens.set(scope, { token: t, until });
    return t;
  }

  /** Запрос к API с IAM-токеном. Истёкший токен обновляется один раз. */
  private async api(scope: 'project' | 'account', method: string, url: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await this.token(scope, attempt > 0);
      const res = await guardedFetch(this.fetchImpl, url, {
        method,
        headers: { 'X-Auth-Token': tok, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }, 'Selectel');
      const text = await readLimited(res, 'Selectel');
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 401) throw new McpError('Selectel: доступ запрещён. Проверьте данные сервисного пользователя.', 'auth');
      if (res.status === 403) throw new SelectelRejected('Selectel: у сервисного пользователя нет прав на это действие. Для DNS выдайте ему роль «DNS», для баланса добавьте доступ к биллингу аккаунта, для остальных действий — роль «Администратор проекта». Измените роль в панели Selectel → «Управление доступом» → «Сервисные пользователи», затем повторите запрос.');
      if (res.status === 204 || (res.ok && !text.trim())) return null;
      let o: unknown;
      try { o = safeJsonParse(text, 4_000_000); } catch { throw new McpError('Selectel: сервер вернул не JSON', 'protocol'); }
      if (!res.ok) {
        const e = o as Record<string, unknown> | null;
        const msg = show((e && (e.error ?? e.message ?? e.description)) ?? '', 200);
        if (res.status >= 500) throw new McpError(`Selectel: сервер ответил ${res.status}`, 'protocol');
        throw new SelectelRejected(`Selectel: ${res.status === 404 ? 'не найдено' : 'запрос отклонён'}${msg ? ` (${msg})` : ''}`);
      }
      return o;
    }
    throw new McpError('Selectel: доступ запрещён', 'auth');
  }

  async initialize(): Promise<void> { await this.token('project'); }

  async listTools(): Promise<McpToolDef[]> { return SELECTEL_TOOLS.map(t => ({ ...t })); }

  /** Все страницы списка (Selectel отдаёт до 1000 элементов за раз и номер следующей страницы next_offset). */
  private async all(path: string): Promise<any[]> {
    const out: any[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const o = await this.api('project', 'GET', `${DNS}${path}?limit=${PAGE}&offset=${offset}`) as { result?: unknown; next_offset?: unknown } | null;
      const list = Array.isArray(o?.result) ? o.result : [];
      out.push(...list);
      const next = Number(o?.next_offset);
      if (!list.length || !Number.isInteger(next) || next <= offset) return out;
      offset = next;
    }
    throw new McpError('Selectel: слишком длинный список, Светлана не стала читать его целиком', 'protocol');
  }

  private async zone(name: string): Promise<{ id: string; name: string }> {
    const list = await this.all('/zones') as { id?: unknown; name?: unknown }[];
    const z = list.find(x => typeof x?.name === 'string' && x.name.toLowerCase().replace(/\.$/, '') === name && typeof x.id === 'string');
    if (!z) throw new SelectelRejected(`Selectel: домен ${name} ещё не добавлен в DNS-хостинг Selectel. Откройте панель Selectel → «DNS-хостинг», добавьте домен и повторите запрос.`);
    return { id: String(z.id), name };
  }

  private async rrsets(zoneId: string): Promise<Rrset[]> {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(zoneId)) throw new McpError('Selectel: непонятный номер зоны', 'protocol');
    const list = await this.all(`/zones/${zoneId}/rrset`);
    return list.filter((r: any) => r && typeof r.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(r.id) && typeof r.name === 'string' && typeof r.type === 'string' && Array.isArray(r.records))
      .map((r: any) => ({ id: r.id, name: r.name, type: r.type, ttl: Number(r.ttl) || DEFAULT_TTL,
        records: r.records.filter((x: any) => x && typeof x.content === 'string').map((x: any) => ({ content: x.content, disabled: x.disabled === true })) }));
  }

  private async run(name: string, args: Record<string, unknown>): Promise<string> {
    if (name === 'get_balance') {
      const o = await this.api('account', 'GET', `${SELECTEL_API}/v3/balances`) as { data?: any } | null;
      const d = o?.data ?? {};
      const billings = Array.isArray(d.billings) ? d.billings : [];
      return JSON.stringify({
        currency: typeof d.settings?.currency === 'string' ? d.settings.currency : null,
        debt_status: typeof d.debt_status === 'string' ? d.debt_status : null,
        billings: billings.slice(0, 10).map((b: any) => ({ billing_type: b?.billing_type ?? null, final_sum: b?.final_sum ?? null, debt_sum: b?.debt_sum ?? null })),
        note: 'Суммы в том виде, как их прислал Selectel (уточните единицы в панели, если сомневаетесь).',
      });
    }
    if (name === 'list_zones') {
      const list = await this.all('/zones');
      return JSON.stringify(list.slice(0, 500).map(z => ({ name: typeof z?.name === 'string' ? z.name.replace(/\.$/, '') : null, disabled: z?.disabled === true })));
    }
    if (name === 'get_dns') {
      const z = await this.zone(domain(args.domain));
      const sets = await this.rrsets(z.id);
      return JSON.stringify(sets.map(s => ({ name: s.name.replace(/\.$/, ''), type: s.type, ttl: s.ttl, records: s.records.map(r => s.type === 'TXT' ? unquote(r.content) : r.content) })));
    }
    if (name === 'add_record' || name === 'remove_record') {
      const r = selectelRecord(args);
      const z = await this.zone(r.domain);
      const sets = await this.rrsets(z.id);
      const set = sets.find(s => s.type === r.type && s.name.toLowerCase() === r.fqdn);
      if (name === 'add_record') {
        if (!set) {
          await this.api('project', 'POST', `${DNS}/zones/${z.id}/rrset`, { name: r.fqdn, type: r.type, ttl: DEFAULT_TTL, records: [{ content: r.content, disabled: false }] });
          return JSON.stringify({ added: `${r.type} ${r.fqdn.replace(/\.$/, '')} ${r.value}` });
        }
        if (r.type === 'CNAME') throw new SelectelRejected('Selectel: у этого поддомена уже есть CNAME. Сначала удалите старую запись.');
        if (set.records.some(x => sameContent(r.type, x.content, r.content))) return JSON.stringify({ unchanged: 'такая запись уже есть' });
        await this.api('project', 'PATCH', `${DNS}/zones/${z.id}/rrset/${set.id}`, { ttl: set.ttl, records: [...set.records, { content: r.content, disabled: false }] });
        return JSON.stringify({ added: `${r.type} ${r.fqdn.replace(/\.$/, '')} ${r.value}` });
      }
      const rest = set ? set.records.filter(x => !sameContent(r.type, x.content, r.content)) : [];
      if (!set || rest.length === set.records.length) throw new SelectelRejected('Selectel: такой записи нет. Вызовите get_dns и укажите значение точно как там.');
      if (rest.length) await this.api('project', 'PATCH', `${DNS}/zones/${z.id}/rrset/${set.id}`, { ttl: set.ttl, records: rest });
      else await this.api('project', 'DELETE', `${DNS}/zones/${z.id}/rrset/${set.id}`);
      return JSON.stringify({ removed: `${r.type} ${r.fqdn.replace(/\.$/, '')} ${r.value}` });
    }
    throw bad(`нет инструмента ${show(name, 60)}`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    // Неверные аргументы и отказ Selectel возвращаются как результат действия: подключение остаётся рабочим.
    let text: string;
    try { text = await this.run(name, args); } catch (e) {
      if (e instanceof SelectelInvalid || e instanceof SelectelRejected) return { text: scrub(stripControl(e.message), this.secrets()).slice(0, 2000), isError: true };
      throw e;
    }
    text = scrub(stripControl(text), this.secrets());
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n…(обрезано)`;
    return { text, isError: false };
  }
}
