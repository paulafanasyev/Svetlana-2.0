// Клиент MCP (Model Context Protocol) по транспорту Streamable HTTP: JSON-RPC 2.0 поверх POST,
// ответ — JSON или поток SSE. Поддерживаются initialize, tools/list (с постраничной выдачей) и tools/call.
// Безопасность: адрес только из каталога (McpCatalog), без редиректов и cookies, с лимитами времени и размера.
// Ответы сервера — недоверенные данные: модель получает их только внутри меток ⟦ДАННЫЕ⟧ (см. McpManager).
import { safeJsonParse, stripControl } from '../security/SafeData';
import { authHeader, isCatalogUrl, type McpServerInfo } from './McpCatalog';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 4_000_000;
const MAX_TOOLS = 300;
const MAX_RESULT_CHARS = 20_000;

export type McpErrorCode = 'auth' | 'network' | 'protocol' | 'session' | 'timeout' | 'denied';

export class McpError extends Error {
  constructor(message: string, readonly code: McpErrorCode) { super(message); this.name = 'McpError'; }
}

export interface McpToolDef {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /** true — сервер пометил инструмент как «только чтение» (подсказка сервера, подтверждение всё равно нужно). */
  readOnly?: boolean;
}

export interface McpCallResult { text: string; isError: boolean }

/** Общий интерфейс подключения: настоящий MCP-сервер или встроенный набор инструментов (Vercel API). */
export interface McpConnection {
  initialize(): Promise<void>;
  listTools(): Promise<McpToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);

/** fetch с ограничением времени, без редиректов и cookies. Ошибки сети — понятным текстом. */
export async function guardedFetch(fetchImpl: FetchLike, url: string, init: RequestInit, serverName: string): Promise<Response> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    return await fetchImpl(url, { ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctrl?.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new McpError(`${serverName}: сервер не ответил за ${TIMEOUT_MS / 1000} секунд`, 'timeout');
    throw new McpError(`${serverName}: нет связи с сервером. Проверьте интернет; на сайте запрос может блокировать браузер (CORS), тогда подключайте сервис в приложении.`, 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readLimited(res: Response, serverName: string): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_RESPONSE_CHARS) throw new McpError(`${serverName}: слишком большой ответ`, 'protocol');
  const text = await res.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new McpError(`${serverName}: слишком большой ответ`, 'protocol');
  return text;
}

/** Достаёт из ответа (JSON, пакет JSON или поток SSE) сообщение JSON-RPC с нужным id. */
export function parseRpcResponse(text: string, contentType: string | null, id: number): any {
  const candidates: unknown[] = [];
  if ((contentType ?? '').toLowerCase().includes('text/event-stream')) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data.trim()) continue;
      try { candidates.push(safeJsonParse(data, MAX_RESPONSE_CHARS)); } catch { /* не JSON — пропускаем */ }
    }
  } else {
    let parsed: unknown;
    try { parsed = safeJsonParse(text, MAX_RESPONSE_CHARS); } catch { throw new McpError('Сервер вернул не JSON', 'protocol'); }
    if (Array.isArray(parsed)) candidates.push(...parsed); else candidates.push(parsed);
  }
  const msg = candidates.find(m => !!m && typeof m === 'object' && (m as any).id === id) as any;
  if (!msg) throw new McpError('Сервер не прислал ответ на запрос', 'protocol');
  if (msg.error) {
    const m = stripControl(typeof msg.error.message === 'string' ? msg.error.message : 'ошибка', false).slice(0, 300);
    throw new McpError(`Ошибка сервера: ${m}`, 'protocol');
  }
  return msg.result;
}

/** Текст результата tools/call: текстовые части, остальное — пометкой; не длиннее 20 000 символов. */
export function resultText(result: any): McpCallResult {
  const parts: string[] = [];
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const c of content.slice(0, 50)) {
    if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
    else if (c?.type === 'resource' && typeof c.resource?.text === 'string') parts.push(c.resource.text);
    else if (c?.type === 'image') parts.push('[изображение]');
    else if (c?.type === 'audio') parts.push('[аудио]');
    else if (c?.type === 'resource_link' && typeof c.uri === 'string') parts.push(`[ссылка: ${c.uri}]`);
  }
  if (!parts.length && result?.structuredContent !== undefined) {
    try { parts.push(JSON.stringify(result.structuredContent)); } catch { /* noop */ }
  }
  let text = stripControl(parts.join('\n'));
  if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n…(обрезано)`;
  return { text: text || '(пустой ответ)', isError: result?.isError === true };
}

function cleanTool(t: any): McpToolDef | null {
  if (!t || typeof t !== 'object' || typeof t.name !== 'string' || !/^[A-Za-z0-9_.\-/]{1,128}$/.test(t.name)) return null;
  const schema = t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema) ? t.inputSchema : { type: 'object', properties: {} };
  return {
    name: t.name,
    title: typeof t.title === 'string' ? stripControl(t.title, false).slice(0, 120) : typeof t.annotations?.title === 'string' ? stripControl(t.annotations.title, false).slice(0, 120) : undefined,
    description: typeof t.description === 'string' ? stripControl(t.description, false).slice(0, 600) : undefined,
    inputSchema: schema,
    readOnly: t.annotations?.readOnlyHint === true,
  };
}

export class McpClient implements McpConnection {
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private nextId = 1;
  private ready = false;

  constructor(private readonly server: McpServerInfo, private readonly token: string | null, private readonly fetchImpl: FetchLike = defaultFetch) {
    if (server.kind !== 'mcp' || !isCatalogUrl(server.url)) throw new McpError('Адрес сервера не из каталога', 'denied');
    if (server.tokenRequired && !(token ?? '').trim()) throw new McpError(`${server.name}: нужен токен`, 'auth');
    authHeader(server, token); // проверка символов токена до первого запроса
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const auth = authHeader(this.server, this.token);
    if (auth) h.Authorization = auth;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) h['MCP-Protocol-Version'] = this.protocolVersion;
    return h;
  }

  private async post(body: unknown): Promise<Response> {
    const res = await guardedFetch(this.fetchImpl, this.server.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) }, this.server.name);
    if (res.status === 401 || res.status === 403) {
      throw new McpError(`${this.server.name}: токен не подошёл или у него нет прав (${res.status})`, 'auth');
    }
    if (res.status === 404 && this.sessionId) {
      this.sessionId = null; this.ready = false;
      throw new McpError(`${this.server.name}: сессия истекла`, 'session');
    }
    return res;
  }

  private async rpc(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    const text = await readLimited(res, this.server.name);
    if (!res.ok) throw new McpError(`${this.server.name}: сервер ответил ${res.status}`, 'protocol');
    const sid = res.headers.get('mcp-session-id');
    if (sid && /^[\x21-\x7e]{1,256}$/.test(sid)) this.sessionId = sid;
    return parseRpcResponse(text, res.headers.get('content-type'), id);
  }

  async initialize(): Promise<void> {
    this.sessionId = null; this.protocolVersion = null;
    const result = await this.rpc('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'svetlana', title: 'Светлана 2.0', version: '2.1.0' },
    });
    this.protocolVersion = typeof result?.protocolVersion === 'string' && /^[0-9-]{4,20}$/.test(result.protocolVersion) ? result.protocolVersion : MCP_PROTOCOL_VERSION;
    // Уведомление без id: сервер отвечает 202 без тела, ответ не разбираем.
    const res = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    try { await res.text(); } catch { /* noop */ }
    this.ready = true;
  }

  private async ensureReady(): Promise<void> { if (!this.ready) await this.initialize(); }

  /** Повтор один раз, если сервер забыл сессию. */
  private async withSession<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureReady();
    try { return await fn(); } catch (e) {
      if (e instanceof McpError && e.code === 'session') { await this.initialize(); return fn(); }
      throw e;
    }
  }

  async listTools(): Promise<McpToolDef[]> {
    return this.withSession(async () => {
      const tools: McpToolDef[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10 && tools.length < MAX_TOOLS; page++) {
        const r = await this.rpc('tools/list', cursor ? { cursor } : undefined);
        for (const t of Array.isArray(r?.tools) ? r.tools : []) {
          const c = cleanTool(t);
          if (c && !tools.some(x => x.name === c.name) && tools.length < MAX_TOOLS) tools.push(c);
        }
        cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
        if (!cursor) break;
      }
      return tools;
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return this.withSession(async () => resultText(await this.rpc('tools/call', { name, arguments: args })));
  }
}
