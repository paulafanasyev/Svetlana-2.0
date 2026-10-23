import type { Tool, ToolResult } from './ToolRegistry';
import { toolRegistry } from './ToolRegistry';
import { agentFileWorkspace } from './AgentFileWorkspace';

let activeAgentId: string | null = null;
const validAgentId = (value: string) => /^[A-Za-z0-9_-]{1,120}$/.test(value);

export function setActiveAgentWorkspaceAgentId(agentId: string | null): void {
  if (agentId !== null && !validAgentId(agentId)) throw new Error('Некорректный идентификатор агента.');
  activeAgentId = agentId;
}
export function getActiveAgentWorkspaceAgentId(): string | null {
  return activeAgentId;
}
function requireScope(): string {
  if (!activeAgentId) throw new Error('Личное хранилище доступно только в чате выбранного агента.');
  return activeAgentId;
}
function success(data: unknown): ToolResult {
  return {
    success: true,
    data: { text: JSON.stringify(data) },
    verification: { status: 'PASS', confidence: 1, details: 'Операция локального хранилища завершена без ошибки.' },
  };
}
function failure(error: unknown): ToolResult {
  return { success: false, error: error instanceof Error ? error.message : 'Не удалось выполнить операцию с хранилищем.' };
}
function makeTool(input: Omit<Tool, 'execute' | 'isAvailable'> & { run: (args: Record<string, any>) => unknown | Promise<unknown> }): Tool {
  return {
    id: input.id, name: input.name, description: input.description, inputSchema: input.inputSchema,
    riskLevel: input.riskLevel, category: input.category,
    async execute(args) {
      try { return success(await input.run(args)); }
      catch (error) { return failure(error); }
    },
    async isAvailable() { return activeAgentId !== null; },
  };
}

export const agentWorkspaceTools: Tool[] = [
  makeTool({
    id: 'agent_workspace_create', name: 'Create private local workspace',
    description: 'Создаёт постоянное локальное текстовое хранилище только для текущего агента на этом устройстве. Сообщи пользователю, что это хранилище приложения, а не общая папка файлов Android.',
    inputSchema: { type: 'object', properties: {}, required: [] }, riskLevel: 'medium', category: 'system',
    run: () => agentFileWorkspace.createWorkspace(requireScope()),
  }),
  makeTool({
    id: 'agent_workspace_status', name: 'Check private workspace',
    description: 'Проверяет, создано ли локальное хранилище текущего агента, сколько в нём файлов и символов.',
    inputSchema: { type: 'object', properties: {}, required: [] }, riskLevel: 'low', category: 'data',
    run: () => agentFileWorkspace.status(requireScope()),
  }),
  makeTool({
    id: 'agent_workspace_list', name: 'List private workspace files',
    description: 'Показывает список текстовых файлов в локальном хранилище текущего агента. Не читает содержимое файлов.',
    inputSchema: { type: 'object', properties: { prefix: { type: 'string', description: 'Необязательный относительный каталог-префикс' } }, required: [] }, riskLevel: 'low', category: 'data',
    run: args => agentFileWorkspace.listFiles(requireScope(), typeof args.prefix === 'string' ? args.prefix : ''),
  }),
  makeTool({
    id: 'agent_workspace_read', name: 'Read private workspace file',
    description: 'Читает текстовый файл текущего агента. Передача содержимого модели требует подтверждения пользователя.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Относительный путь файла' } }, required: ['path'] }, riskLevel: 'medium', category: 'data',
    run: args => agentFileWorkspace.readFile(requireScope(), args.path),
  }),
  makeTool({
    id: 'agent_workspace_write', name: 'Write private workspace file',
    description: 'Создаёт текстовый файл в локальном хранилище текущего агента. До 2000 символов на файл; перезапись требует overwrite: true и подтверждения.',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string', description: 'Относительный путь файла, например notes/task.md' },
      content: { type: 'string', description: 'Содержимое текстового файла, до 2000 символов' },
      overwrite: { type: 'boolean', description: 'Установите true только при намеренной перезаписи существующего файла' },
    }, required: ['path', 'content'] }, riskLevel: 'medium', category: 'system',
    run: args => agentFileWorkspace.writeFile(requireScope(), args.path, args.content, args.overwrite === true),
  }),
  makeTool({
    id: 'agent_workspace_delete_file', name: 'Delete private workspace file',
    description: 'Удаляет один текстовый файл из локального хранилища текущего агента.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Относительный путь файла' } }, required: ['path'] }, riskLevel: 'medium', category: 'system',
    run: args => agentFileWorkspace.deleteFile(requireScope(), args.path),
  }),
  makeTool({
    id: 'agent_workspace_remove', name: 'Remove private local workspace',
    description: 'Удаляет всё локальное хранилище текущего агента вместе с файлами. Требует подтверждения пользователя.',
    inputSchema: { type: 'object', properties: {}, required: [] }, riskLevel: 'critical', category: 'system',
    run: () => agentFileWorkspace.deleteWorkspace(requireScope()),
  }),
];
agentWorkspaceTools.forEach(tool => toolRegistry.registerTool(tool));
