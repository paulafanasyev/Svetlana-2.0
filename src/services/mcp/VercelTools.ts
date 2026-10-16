// Vercel: официальный Vercel MCP пускает только по OAuth и только одобренные приложения, поэтому
// Светлана работает с Vercel напрямую через REST API по токену. Набор инструментов — только чтение:
// проекты, деплои, логи сборки, домены. Адрес фиксирован (https://api.vercel.com), без редиректов.
import { safeJsonParse, stripControl } from '../security/SafeData';
import { authHeader, mcpServer } from './McpCatalog';
import { guardedFetch, readLimited, McpError, type FetchLike, type McpCallResult, type McpConnection, type McpToolDef } from './McpClient';

const BASE = 'https://api.vercel.com';
const ID_RE = /^[A-Za-z0-9_.\-]{1,128}$/;
const MAX_RESULT_CHARS = 20_000;

const teamProp = { type: 'string', description: 'Team id or slug (optional)' };
const limitProp = { type: 'number', description: 'Max items, default 20' };

export const VERCEL_TOOLS: readonly McpToolDef[] = Object.freeze([
  { name: 'list_projects', title: 'Проекты', readOnly: true, description: 'List Vercel projects.',
    inputSchema: { type: 'object', properties: { limit: limitProp, teamId: teamProp } } },
  { name: 'list_deployments', title: 'Деплои', readOnly: true, description: 'List recent deployments, optionally for one project (id or name). state: BUILDING, ERROR, READY, QUEUED, CANCELED.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string', description: 'Project id or name' }, state: { type: 'string', description: 'Deployment state', enum: ['BUILDING', 'ERROR', 'INITIALIZING', 'QUEUED', 'READY', 'CANCELED'] }, limit: limitProp, teamId: teamProp } } },
  { name: 'get_deployment', title: 'Деплой', readOnly: true, description: 'Get one deployment by id or URL host.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Deployment id (dpl_...) or host' }, teamId: teamProp }, required: ['id'] } },
  { name: 'get_build_logs', title: 'Логи сборки', readOnly: true, description: 'Get build log lines of a deployment (last 100).',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Deployment id (dpl_...)' }, teamId: teamProp }, required: ['id'] } },
  { name: 'list_domains', title: 'Домены', readOnly: true, description: 'List domains of the account or team.',
    inputSchema: { type: 'object', properties: { limit: limitProp, teamId: teamProp } } },
]);

function id(v: unknown, label: string): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new McpError(`Vercel: неверный ${label}`, 'protocol');
  return v;
}
function lim(v: unknown): string { return String(Math.max(1, Math.min(100, Math.floor(Number(v) || 20)))); }

/** Адрес запроса Vercel API для инструмента. Только фиксированные пути, значения проверены и закодированы. */
export function vercelRequestUrl(name: string, args: Record<string, unknown>): string {
  const q = new URLSearchParams();
  if (args.teamId !== undefined) q.set('teamId', id(args.teamId, 'teamId'));
  let path: string;
  switch (name) {
    case 'list_projects': path = '/v9/projects'; q.set('limit', lim(args.limit)); break;
    case 'list_deployments':
      path = '/v6/deployments'; q.set('limit', lim(args.limit));
      if (args.projectId !== undefined) q.set('projectId', id(args.projectId, 'projectId'));
      if (args.state !== undefined) q.set('state', id(args.state, 'state'));
      break;
    case 'get_deployment': path = `/v13/deployments/${encodeURIComponent(id(args.id, 'id'))}`; break;
    case 'get_build_logs': path = `/v3/deployments/${encodeURIComponent(id(args.id, 'id'))}/events`; q.set('limit', '100'); q.set('direction', 'backward'); break;
    case 'list_domains': path = '/v5/domains'; q.set('limit', lim(args.limit)); break;
    default: throw new McpError(`Vercel: нет инструмента ${stripControl(name, false).slice(0, 60)}`, 'protocol');
  }
  const qs = q.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

/** true — Vercel вернул ошибку в теле ответа ({"error": {...}}), даже при коде 2xx. */
export function isVercelErrorBody(text: string): boolean {
  if (!text.trimStart().startsWith('{') || !text.includes('"error"')) return false;
  try {
    const o = safeJsonParse(text, 4_000_000) as Record<string, unknown> | null;
    return !!o && typeof o === 'object' && !Array.isArray(o) && !!o.error && typeof o.error === 'object';
  } catch { return false; }
}

export class VercelConnection implements McpConnection {
  constructor(private readonly token: string, private readonly fetchImpl: FetchLike = (u, i) => globalThis.fetch(u, i)) {
    if (!token.trim()) throw new McpError('Vercel: нужен токен', 'auth');
  }

  private async get(url: string): Promise<string> {
    const server = mcpServer('vercel')!;
    const res = await guardedFetch(this.fetchImpl, url, { method: 'GET', headers: { Authorization: authHeader(server, this.token)!, Accept: 'application/json' } }, 'Vercel');
    if (res.status === 401 || res.status === 403) throw new McpError(`Vercel: токен не подошёл или у него нет прав (${res.status})`, 'auth');
    const text = await readLimited(res, 'Vercel');
    if (!res.ok) throw new McpError(`Vercel: сервер ответил ${res.status}`, 'protocol');
    return text;
  }

  async initialize(): Promise<void> {
    // Проверка токена: кто владелец.
    const text = await this.get(`${BASE}/v2/user`);
    if (isVercelErrorBody(text)) throw new McpError('Vercel: токен не подошёл или у него нет прав', 'auth');
  }

  async listTools(): Promise<McpToolDef[]> { return VERCEL_TOOLS.map(t => ({ ...t })); }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    let text = stripControl(await this.get(vercelRequestUrl(name, args)));
    const isError = isVercelErrorBody(text);
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n…(обрезано)`;
    return { text, isError };
  }
}
