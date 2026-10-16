import { describe, it, expect, afterEach } from 'vitest';
import {
  McpManager, mcpManager, runMcpActions, parseMcpActions, stripActionBlocks, findMcpBlocks, scrubSecret, isSmallArgs,
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

function memoryKv() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

describe('MCP hardening: confirmation and trust', () => {
  afterEach(() => { __setMcpFactoryForTests(null); mcpManager.reset(); resetActionGate(); });

  it('asks for every call by default, even reads the app knows', async () => {
    __setMcpFactoryForTests(() => conn([listIssues, createIssue]));
    await mcpManager.connect('github', TOKEN);
    expect(needsConfirmation('mcp_github__list_issues', 'llm', {})).toBe(true);
    mcpManager.setAutoRead('github', true);
    expect(needsConfirmation('mcp_github__list_issues', 'llm', {})).toBe(false);
    expect(needsConfirmation('mcp_github__list_issues', 'llm', { q: 'x'.repeat(301) })).toBe(true);
    expect(needsConfirmation('mcp_github__create_issue', 'llm', {})).toBe(true);
  });

  it('keeps the reading setting on reconnect', async () => {
    __setMcpFactoryForTests(() => conn([listIssues]));
    await mcpManager.connect('github', TOKEN);
    mcpManager.setAutoRead('github', true);
    await mcpManager.connect('github', TOKEN);
    expect(mcpManager.status().find(s => s.server.id === 'github')?.autoRead).toBe(true);
  });

  it('does not trust a saved tool list after restart until the service answers again', async () => {
    const kv = memoryKv();
    __setMcpFactoryForTests(() => conn([listIssues]));
    const first = new McpManager(kv);
    await first.connect('github', TOKEN);
    first.setAutoRead('github', true);
    expect(needsConfirmation('mcp_github__list_issues', 'llm', {})).toBe(false);
    const second = new McpManager(kv); // «перезапуск приложения»
    expect(second.status().find(s => s.server.id === 'github')?.verified).toBe(false);
    expect(needsConfirmation('mcp_github__list_issues', 'llm', {})).toBe(true);
    second.reset();
    first.reset();
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

  it('explains an expired token with the next step', async () => {
    __setMcpFactoryForTests(() => ({ ...conn([listIssues]), callTool: async () => { throw new McpError('401', 'auth'); } }));
    await mcpManager.connect('github', TOKEN);
    setActionConfirmer(async () => true);
    const r = await runMcpActions([{ tool: 'mcp_github__list_issues', args: {}, source: 'llm' }]);
    expect(r.lines[0]).toMatch(/вставьте новый токен/);
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
    expect(dialogs[1].lines[0]).toBe('Что будет: Timeweb Cloud: [WRITE] Переименовать сеть');
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
  function server(opts: { version?: string; notifyStatus?: number; pages?: number; loop?: boolean } = {}) {
    return async (_u: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: opts.version ?? '2025-06-18', capabilities: {} } }), { headers: { 'content-type': 'application/json' } });
      }
      if (!body?.id) return new Response(null, { status: opts.notifyStatus ?? 202 });
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
  });
});
