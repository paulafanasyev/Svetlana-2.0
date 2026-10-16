import { describe, it, expect, afterEach } from 'vitest';
import {
  McpManager, mcpManager, runMcpActions, parseMcpActions, stripActionBlocks, findMcpBlocks, scrubSecret, scrubDeep, isSmallArgs,
  __setMcpFactoryForTests, MCP_REJECTED_TEXT,
} from '../services/mcp/McpManager';
import { McpClient, McpError, parseRpcResponse, resultText } from '../services/mcp/McpClient';
import { mcpServer } from '../services/mcp/McpCatalog';
import { isVercelErrorBody } from '../services/mcp/VercelTools';
import { setActionConfirmer, resetActionGate, needsConfirmation, summarizeAction, type ActionSummary } from '../services/security/ActionGate';
import type { McpConnection, McpToolDef } from '../services/mcp/McpClient';

const TOKEN = 'ghp_SECRET_TOKEN_123456';

function conn(tools: McpToolDef[], call: (name: string, args: Record<string, unknown>) => string = n => `ok ${n}`): McpConnection {
  return { initialize: async () => {}, listTools: async () => tools.map(t => ({ ...t })), callTool: async (n, a) => ({ text: call(n, a), isError: false }) };
}
const listIssues: McpToolDef = { name: 'list_issues', readOnly: true, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } };
const createIssue: McpToolDef = { name: 'create_issue', readOnly: false, inputSchema: { type: 'object', properties: { title: { type: 'string' } } } };
const listProjects: McpToolDef = { name: 'list_projects', readOnly: true, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } };

function memoryKv() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

describe('MCP hardening: confirmation and trust', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  it('asks for every call by default; only the built-in adapter can read without a dialog', async () => {
    __setMcpFactoryForTests(() => conn([listIssues, createIssue, listProjects]));
    await mcpManager.connect('github', TOKEN);
    mcpManager.setAutoRead('github', true);
    expect(needsConfirmation('mcp_github__list_issues', 'llm', {})).toBe(true);
    await mcpManager.connect('vercel', TOKEN);
    expect(needsConfirmation('mcp_vercel__list_projects', 'llm', {})).toBe(true);
    mcpManager.setAutoRead('vercel', true);
    expect(needsConfirmation('mcp_vercel__list_projects', 'llm', {})).toBe(false);
    expect(needsConfirmation('mcp_vercel__list_projects', 'llm', { q: 'x'.repeat(301) })).toBe(true);
    expect(needsConfirmation('mcp_vercel__create_issue', 'llm', {})).toBe(true);
  });

  it('keeps the reading setting on reconnect', async () => {
    __setMcpFactoryForTests(() => conn([listProjects]));
    await mcpManager.connect('vercel', TOKEN);
    mcpManager.setAutoRead('vercel', true);
    await mcpManager.connect('vercel', TOKEN);
    expect(mcpManager.status().find(s => s.server.id === 'vercel')?.autoRead).toBe(true);
  });

  it('after restart, saved tools reach the chat only after the service answers again', async () => {
    const kv = memoryKv();
    __setMcpFactoryForTests(() => conn([listProjects]));
    const first = new McpManager(kv);
    await first.connect('vercel', TOKEN);
    first.setAutoRead('vercel', true);
    const saved = kv.getItem('svetlana_mcp_v1');
    expect(saved).not.toContain('list_projects'); // описания инструментов не сохраняются
    first.reset(); // «приложение закрыто»
    kv.setItem('svetlana_mcp_v1', saved!);
    const second = new McpManager(kv);
    expect(second.status().find(s => s.server.id === 'vercel')?.verified).toBe(false);
    expect(second.status().find(s => s.server.id === 'vercel')?.tools).toEqual([]);
    expect(second.activeTools()).toEqual([]);
    expect(needsConfirmation('mcp_vercel__list_projects', 'llm', {})).toBe(true);
    await second.whenReady();
    expect(second.status().find(s => s.server.id === 'vercel')?.verified).toBe(true);
    expect(second.activeTools().map(t => t.id)).toEqual(['mcp_vercel__list_projects']);
    second.reset();
  });

  it('a service that fails the check after restart stays out of the chat and shows why', async () => {
    const kv = memoryKv();
    __setMcpFactoryForTests(() => conn([listIssues]));
    const first = new McpManager(kv);
    await first.connect('github', TOKEN);
    const saved = kv.getItem('svetlana_mcp_v1');
    first.reset();
    kv.setItem('svetlana_mcp_v1', saved!);
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), initialize: async () => { throw new McpError('401', 'auth'); } }));
    const second = new McpManager(kv);
    await second.whenReady();
    const st = second.status().find(s => s.server.id === 'github')!;
    expect(st.verified).toBe(false);
    expect(st.error).toMatch(/Сменить токен/);
    expect(second.activeTools()).toEqual([]);
    second.reset();
  });

  it('turning a service off forgets the check; turning it on checks again', async () => {
    let lists = 0;
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), listTools: async () => { lists++; return [listIssues]; } }));
    await mcpManager.connect('github', TOKEN);
    mcpManager.setServerEnabled('github', false);
    expect(mcpManager.activeTools()).toEqual([]);
    const checking = mcpManager.setServerEnabled('github', true);
    expect(mcpManager.activeTools()).toEqual([]); // ещё не проверен
    await checking;
    expect(lists).toBe(2);
    expect(mcpManager.activeTools().map(t => t.id)).toEqual(['mcp_github__list_issues']);
  });

  it('a check started before off/on cannot overwrite the newer one', async () => {
    let n = 0;
    let release: () => void = () => {};
    __setMcpFactoryForTests(() => ({
      ...conn([]),
      listTools: async () => { const v = ++n; if (v === 2) await new Promise<void>(r => { release = r; }); return [{ ...listIssues, description: `v${v}` }]; },
    }));
    await mcpManager.connect('github', TOKEN);
    await mcpManager.setServerEnabled('github', false);
    const old = mcpManager.setServerEnabled('github', true); // зависнет на v2
    await new Promise(r => setTimeout(r, 0));
    await mcpManager.setServerEnabled('github', false);
    await mcpManager.setServerEnabled('github', true); // v3
    release();
    await old;
    expect(mcpManager.activeTools().map(t => t.def.description)).toEqual(['v3']);
    expect(mcpManager.status().find(s => s.server.id === 'github')?.error).toBeNull();
  });

  it('a connect that finishes after disconnect does not bring the service back', async () => {
    let release: () => void = () => {};
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), initialize: () => new Promise<void>(r => { release = r; }) }));
    const pending = mcpManager.connect('github', TOKEN);
    await new Promise(r => setTimeout(r, 0));
    await mcpManager.disconnect('github');
    release();
    await expect(pending).rejects.toThrow(/подключение отменено/);
    expect(mcpManager.status().find(s => s.server.id === 'github')?.connected).toBe(false);
    expect(mcpManager.activeTools()).toEqual([]);
  });

  it('does not run an approved call if the service changed the tool while the dialog was open', async () => {
    let version = 1;
    const calls: string[] = [];
    __setMcpFactoryForTests(() => ({
      initialize: async () => {},
      listTools: async () => [{ ...createIssue, description: `v${version}` }],
      callTool: async n => { calls.push(n); return { text: 'ok', isError: false }; },
    }));
    await mcpManager.connect('github', TOKEN);
    setActionConfirmer(async () => { version = 2; await mcpManager.refresh('github'); return true; });
    const r = await runMcpActions([{ tool: 'mcp_github__create_issue', args: { title: 't' }, source: 'llm' }]);
    expect(r.lines[0]).toMatch(/сервис изменил это действие/);
    expect(calls).toEqual([]);
  });

  it('removes the token from the tool schema too', async () => {
    __setMcpFactoryForTests(() => conn([{ ...listIssues, inputSchema: { type: 'object', properties: { q: { type: 'string', description: `key ${TOKEN}`, enum: [TOKEN] }, [TOKEN]: { type: 'string' } } } }]));
    await mcpManager.connect('github', TOKEN);
    expect(JSON.stringify(mcpManager.status())).not.toContain(TOKEN);
    expect(scrubSecret('abc', 'b')).toBe('a[токен скрыт]c');
    let deep: Record<string, unknown> = { leak: TOKEN };
    for (let i = 0; i < 30; i++) deep = { d: deep };
    expect(JSON.stringify(scrubDeep(deep, TOKEN))).not.toContain(TOKEN);
  });

  it('removes the token if a service sends it back', async () => {
    __setMcpFactoryForTests(() => conn([{ ...listIssues, description: `uses ${TOKEN}` }], () => `echo ${TOKEN}`));
    await mcpManager.connect('github', TOKEN);
    setActionConfirmer(async () => true);
    const r = await runMcpActions([{ tool: 'mcp_github__list_issues', args: {}, source: 'llm' }]);
    const all = JSON.stringify([r, mcpManager.status()]);
    expect(all).not.toContain(TOKEN);
    expect(all).toContain('[токен скрыт]');
    expect(scrubSecret('a b', '')).toBe('a b');
  });

  it('turns connection failures into clear text without the token', async () => {
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), initialize: async () => { throw new McpError(`Ошибка сервера: bad ${TOKEN}`, 'protocol'); } }));
    await expect(mcpManager.connect('github', TOKEN)).rejects.toThrow(/\[токен скрыт\]/);
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), initialize: async () => { throw new TypeError(`x ${TOKEN}`); } }));
    await expect(mcpManager.connect('github', TOKEN)).rejects.toThrow(/Проверьте токен и интернет/);
  });

  it('explains a bad token on first connect without pointing to a button that is not there', async () => {
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), initialize: async () => { throw new McpError('401', 'auth'); } }));
    await expect(mcpManager.connect('github', TOKEN)).rejects.toThrow(/Проверьте токен и нажмите «Подключить» ещё раз/);
  });

  it('explains an expired token with the next step', async () => {
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), callTool: async () => { throw new McpError('401', 'auth'); } }));
    await mcpManager.connect('github', TOKEN);
    setActionConfirmer(async () => true);
    const r = await runMcpActions([{ tool: 'mcp_github__list_issues', args: {}, source: 'llm' }]);
    expect(r.lines[0]).toMatch(/Сменить токен/);
    expect(mcpManager.activeTools()).toEqual([]); // инструменты сразу убраны из чата
    expect(mcpManager.status().find(s => s.server.id === 'github')?.error).toMatch(/Сменить токен/);
  });

  it('a failed refresh removes the tools from the chat', async () => {
    let fail = false;
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), initialize: async () => { if (fail) throw new McpError('401', 'auth'); } }));
    await mcpManager.connect('github', TOKEN);
    fail = true;
    await expect(mcpManager.refresh('github')).rejects.toThrow();
    expect(mcpManager.activeTools()).toEqual([]);
  });

  it('warns about changes and unknown cost in the dialog', async () => {
    __setMcpFactoryForTests(() => conn([createIssue]));
    await mcpManager.connect('github', TOKEN);
    const s: ActionSummary = summarizeAction({ tool: 'mcp_github__create_issue', args: { title: 't' }, source: 'llm' });
    expect(s.warning).toMatch(/изменить данные в GitHub/);
  });

  it('keeps the Timeweb summary for long confirmation tokens', async () => {
    const tok = 'T'.repeat(300);
    __setMcpFactoryForTests(() => conn([{ name: 'execute_tool', readOnly: false, inputSchema: { type: 'object', properties: { tool_id: { type: 'string' }, confirm_token: { type: 'string' } } } }],
      (_n, a) => a.confirm_token ? 'done' : `Ответ: ${JSON.stringify({ status: 'confirmation_required', confirm_token: tok, operation_summary: '[WRITE] Переименовать сеть' })}`));
    await mcpManager.connect('timeweb', 'tw_token_123');
    const dialogs: ActionSummary[] = [];
    setActionConfirmer(async (_r, s) => { dialogs.push(s); return true; });
    await runMcpActions([{ tool: 'mcp_timeweb__execute_tool', args: { tool_id: 'x' }, source: 'llm' }]);
    await runMcpActions([{ tool: 'mcp_timeweb__execute_tool', args: { tool_id: 'x', confirm_token: tok }, source: 'llm' }]);
    expect(dialogs[1].lines[0]).toBe('Что будет: Timeweb Cloud: Переименовать сеть');
    expect(dialogs[1].warning).toMatch(/изменит ресурсы/);
  });
});

describe('MCP hardening: parsing', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  it('reads action blocks with brackets inside strings', async () => {
    __setMcpFactoryForTests(() => conn([createIssue]));
    await mcpManager.connect('github', TOKEN);
    const text = 'Создаю [MCP: {"tool":"mcp_github__create_issue","args":{"title":"a}] b \\" c"}}] готово';
    const p = parseMcpActions(text);
    expect(p.actions).toEqual([{ tool: 'mcp_github__create_issue', args: { title: 'a}] b " c' }, source: 'llm' }]);
    expect(p.clean).toBe('Создаю  готово');
    expect(findMcpBlocks('[MCP: {"a":1')).toEqual([]);
    expect(stripActionBlocks('x [MCP: {"t":"}]"}] y')).toBe('x  y');
    expect(MCP_REJECTED_TEXT).toMatch(/по частям/);
    expect(isSmallArgs({ a: ['x'.repeat(301)] })).toBe(false);
  });

  it('accepts only real JSON-RPC 2.0 responses', () => {
    expect(() => parseRpcResponse('{"id":1,"result":1}', 'application/json', 1)).toThrow(/JSON-RPC/);
    expect(() => parseRpcResponse('{"jsonrpc":"2.0","id":1,"result":1,"error":{"message":"x"}}', 'application/json', 1)).toThrow(/JSON-RPC/);
    expect(() => parseRpcResponse('{"jsonrpc":"2.0","id":"1","result":1}', 'application/json', 1)).toThrow(McpError);
    expect(() => parseRpcResponse('{"jsonrpc":"2.0","id":1,"error":"x"}', 'application/json', 1)).toThrow(/JSON-RPC/);
    expect(() => parseRpcResponse('{"jsonrpc":"2.0","id":1,"error":{}}', 'application/json', 1)).toThrow(/JSON-RPC/);
    expect(() => parseRpcResponse('{"jsonrpc":"2.0","id":1,"error":{"code":"x","message":"m"}}', 'application/json', 1)).toThrow(/JSON-RPC/);
    expect(() => parseRpcResponse('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":5}}', 'application/json', 1)).toThrow(/JSON-RPC/);
    expect(() => parseRpcResponse('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"boom"}}', 'application/json', 1)).toThrow(/boom/);
    expect(parseRpcResponse('{"jsonrpc":"2.0","id":1,"result":null}', 'application/json', 1)).toBeNull();
  });

  it('treats an empty tool result as an error and a Vercel error body as an error', () => {
    expect(resultText(null).isError).toBe(true);
    expect(resultText({}).isError).toBe(true);
    expect(resultText({ content: [] }).isError).toBe(false);
    expect(isVercelErrorBody('{"error":{"code":"forbidden"}}')).toBe(true);
    expect(isVercelErrorBody('{"projects":[]}')).toBe(false);
  });
});

describe('MCP hardening: protocol', () => {
  const github = mcpServer('github')!;
  function server(opts: { version?: string; notifyStatus?: number; pages?: number; loop?: boolean; result?: unknown; notifyBody?: string } = {}) {
    return async (_u: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: opts.version ?? '2025-06-18', capabilities: {} } }), { headers: { 'content-type': 'application/json' } });
      }
      if (!body?.id) return new Response(opts.notifyBody ?? null, { status: opts.notifyStatus ?? 202 });
      if (opts.result !== undefined) return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: opts.result }), { headers: { 'content-type': 'application/json' } });
      const page = Number(body.params?.cursor ?? 0);
      const pages = opts.pages ?? 1;
      const next = opts.loop ? 'same' : page + 1 < pages ? String(page + 1) : undefined;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: `t${page}`, inputSchema: { type: 'object', properties: {} } }], ...(next ? { nextCursor: next } : {}) } }), { headers: { 'content-type': 'application/json' } });
    };
  }

  it('rejects unsupported protocol versions and a failed start of session', async () => {
    await expect(new McpClient(github, 't', server({ version: '1999-01-01' })).initialize()).rejects.toThrow(/неподдерживаемой версии/);
    await expect(new McpClient(github, 't', server({ notifyStatus: 500 })).initialize()).rejects.toThrow(/не принял/);
    await expect(new McpClient(github, 't', server()).initialize()).resolves.toBeUndefined();
  });

  it('reads every page of tools and stops on a looping cursor', async () => {
    const tools = await new McpClient(github, 't', server({ pages: 15 })).listTools();
    expect(tools).toHaveLength(15);
    await expect(new McpClient(github, 't', server({ loop: true })).listTools()).rejects.toThrow(/зациклил/);
    await expect(new McpClient(github, 't', server({ result: {} })).listTools()).rejects.toThrow(/не по протоколу/);
    await expect(new McpClient(github, 't', server({ result: { tools: [], nextCursor: 5 } })).listTools()).rejects.toThrow(/курсор/);
    await expect(new McpClient(github, 't', server({ result: { tools: [], nextCursor: null } })).listTools()).resolves.toEqual([]);
  });

  it('starts a new session once when the server forgets it (400 or 404)', async () => {
    for (const lost of [400, 404]) {
      let inits = 0;
      let forgot = false;
      const f = async (_u: string, init: RequestInit) => {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        const sid = (init.headers as Record<string, string>)['Mcp-Session-Id'];
        if (body?.method === 'initialize') { inits++; return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': `S${inits}` } }); }
        if (!body?.id) return new Response(null, { status: 202 });
        if (sid === 'S1' && !forgot) { forgot = true; return new Response('{}', { status: lost }); }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }), { headers: { 'content-type': 'application/json' } });
      };
      await expect(new McpClient(github, 't', f).listTools()).resolves.toEqual([]);
      expect(inits).toBe(2);
    }
  });

  it('rejects an oversized reply to the start of session', async () => {
    await expect(new McpClient(github, 't', server({ notifyBody: 'x'.repeat(4_000_001) })).initialize()).rejects.toThrow(/слишком большой/);
  });
});
