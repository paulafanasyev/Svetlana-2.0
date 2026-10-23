import { safeJsonParse } from './security/SafeData';

const STORAGE_KEY = 'svetlana_agent_file_workspaces_v1';
const MAX_WORKSPACES = 100;
const MAX_FILES_PER_WORKSPACE = 100;
const MAX_FILE_CHARS = 2_000;
const MAX_STATE_CHARS = 400_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface StoredFile { content: string; createdAt: number; updatedAt: number }
interface StoredWorkspace { createdAt: number; updatedAt: number; files: Record<string, StoredFile> }
interface StoredState { version: 1; workspaces: Record<string, StoredWorkspace> }
export interface AgentWorkspaceFileInfo { path: string; chars: number; updatedAt: number }
export interface AgentWorkspaceStatus {
  exists: boolean;
  files: number;
  chars: number;
  createdAt?: number;
  updatedAt?: number;
}
const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const validAgentId = (id: string) => /^[A-Za-z0-9_-]{1,120}$/.test(id);

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage === 'undefined') throw new Error();
    return localStorage;
  } catch {
    throw new Error('Локальное хранилище приложения недоступно в этой среде.');
  }
}
function validPath(path: unknown, allowEmpty = false): string {
  if (typeof path !== 'string') throw new Error('Путь файла должен быть текстом.');
  const value = path.trim();
  if (allowEmpty && value === '') return '';
  if (!value || value.length > 240 || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)
    || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Недопустимый путь. Используйте относительный путь длиной до 240 символов.');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..'
    || /^(?:__proto__|prototype|constructor)$/i.test(part)
    || !/^[\p{L}\p{N} ._()-]+$/u.test(part))) {
    throw new Error('Путь содержит недопустимую часть. Запрещены пустые сегменты, «.» и «..».');
  }
  return parts.join('/');
}
function validateState(value: unknown): StoredState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.workspaces)) {
    throw new Error('Формат локального хранилища повреждён; данные не были изменены.');
  }
  const ids = Object.keys(value.workspaces);
  if (ids.length > MAX_WORKSPACES) throw new Error('В хранилище слишком много пространств.');
  for (const id of ids) {
    const workspace = value.workspaces[id];
    if (!validAgentId(id) || !isRecord(workspace) || !isRecord(workspace.files)
      || !Number.isFinite(workspace.createdAt) || !Number.isFinite(workspace.updatedAt)) {
      throw new Error('Формат локального хранилища повреждён; данные не были изменены.');
    }
    const paths = Object.keys(workspace.files);
    if (paths.length > MAX_FILES_PER_WORKSPACE) throw new Error('В пространстве слишком много файлов.');
    for (const path of paths) {
      const file = workspace.files[path];
      if (validPath(path) !== path || !isRecord(file) || typeof file.content !== 'string'
        || file.content.length > MAX_FILE_CHARS || !Number.isFinite(file.createdAt) || !Number.isFinite(file.updatedAt)) {
        throw new Error('Формат локального хранилища повреждён; данные не были изменены.');
      }
    }
  }
  return value as StoredState;
}

/** Device-local text files for a single personal agent. This is app-origin storage, not Android shared storage. */
export class AgentFileWorkspaceStore {
  constructor(private readonly storageFactory: () => StorageLike = defaultStorage) {}

  private load(): StoredState {
    const storage = this.storageFactory();
    let raw: string | null;
    try { raw = storage.getItem(STORAGE_KEY); }
    catch { throw new Error('Не удалось прочитать локальное хранилище приложения.'); }
    if (raw === null) return { version: 1, workspaces: {} };
    if (raw.length > MAX_STATE_CHARS) throw new Error('Хранилище превышает безопасный лимит размера.');
    try { return validateState(safeJsonParse(raw, MAX_STATE_CHARS)); }
    catch (error) {
      if (error instanceof Error && /повреждён|слишком много|превышает/.test(error.message)) throw error;
      throw new Error('Не удалось прочитать локальные данные; они не были изменены.');
    }
  }

  private save(state: StoredState): void {
    const raw = JSON.stringify(state);
    if (raw.length > MAX_STATE_CHARS) throw new Error('Локальное хранилище заполнено. Удалите ненужные файлы или экспортируйте важные данные.');
    try { this.storageFactory().setItem(STORAGE_KEY, raw); }
    catch { throw new Error('Не удалось сохранить файл: хранилище заполнено или запрещено браузером.'); }
  }

  private scoped(state: StoredState, agentId: string): StoredWorkspace {
    if (!validAgentId(agentId)) throw new Error('Некорректный идентификатор агента.');
    const workspace = state.workspaces[agentId];
    if (!workspace) throw new Error('У агента ещё нет локального хранилища. Сначала вызовите agent_workspace_create.');
    return workspace;
  }

  createWorkspace(agentId: string): { created: boolean; status: AgentWorkspaceStatus } {
    if (!validAgentId(agentId)) throw new Error('Некорректный идентификатор агента.');
    const state = this.load();
    const current = state.workspaces[agentId];
    if (current) return { created: false, status: this.statusFrom(current) };
    if (Object.keys(state.workspaces).length >= MAX_WORKSPACES) throw new Error('Достигнут лимит локальных хранилищ.');
    const now = Date.now();
    const workspace: StoredWorkspace = { createdAt: now, updatedAt: now, files: {} };
    state.workspaces[agentId] = workspace;
    this.save(state);
    return { created: true, status: this.statusFrom(workspace) };
  }

  status(agentId: string): AgentWorkspaceStatus {
    if (!validAgentId(agentId)) throw new Error('Некорректный идентификатор агента.');
    const workspace = this.load().workspaces[agentId];
    return workspace ? this.statusFrom(workspace) : { exists: false, files: 0, chars: 0 };
  }

  private statusFrom(workspace: StoredWorkspace): AgentWorkspaceStatus {
    const files = Object.values(workspace.files);
    return {
      exists: true,
      files: files.length,
      chars: files.reduce((sum, file) => sum + file.content.length, 0),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  }

  listFiles(agentId: string, prefix = ''): AgentWorkspaceFileInfo[] {
    const workspace = this.scoped(this.load(), agentId);
    const normalizedPrefix = validPath(prefix, true);
    return Object.entries(workspace.files)
      .filter(([path]) => !normalizedPrefix || path === normalizedPrefix || path.startsWith(normalizedPrefix + '/'))
      .map(([path, file]) => ({ path, chars: file.content.length, updatedAt: file.updatedAt }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  readFile(agentId: string, inputPath: string): { path: string; content: string; chars: number; updatedAt: number } {
    const path = validPath(inputPath);
    const workspace = this.scoped(this.load(), agentId);
    const file = workspace.files[path];
    if (!file) throw new Error('Файл не найден в локальном хранилище этого агента.');
    return { path, content: file.content, chars: file.content.length, updatedAt: file.updatedAt };
  }

  writeFile(agentId: string, inputPath: string, content: string, overwrite = false): AgentWorkspaceFileInfo {
    const path = validPath(inputPath);
    if (typeof content !== 'string') throw new Error('Содержимое файла должно быть текстом.');
    if (content.length > MAX_FILE_CHARS) throw new Error('Файл слишком большой: максимум 2000 символов за одну запись.');
    const state = this.load();
    const workspace = this.scoped(state, agentId);
    const existing = Object.prototype.hasOwnProperty.call(workspace.files, path) ? workspace.files[path] : undefined;
    if (existing && overwrite !== true) throw new Error('Файл уже существует. Передайте overwrite: true, чтобы заменить его.');
    if (!existing && Object.keys(workspace.files).length >= MAX_FILES_PER_WORKSPACE) throw new Error('В пространстве достигнут лимит в 100 файлов.');
    const now = Date.now();
    workspace.files[path] = { content, createdAt: existing?.createdAt ?? now, updatedAt: now };
    workspace.updatedAt = now;
    this.save(state);
    return { path, chars: content.length, updatedAt: now };
  }

  deleteFile(agentId: string, inputPath: string): { deleted: boolean; path: string } {
    const path = validPath(inputPath);
    const state = this.load();
    const workspace = this.scoped(state, agentId);
    if (!Object.prototype.hasOwnProperty.call(workspace.files, path)) return { deleted: false, path };
    delete workspace.files[path];
    workspace.updatedAt = Date.now();
    this.save(state);
    return { deleted: true, path };
  }

  deleteWorkspace(agentId: string): { deleted: boolean } {
    if (!validAgentId(agentId)) throw new Error('Некорректный идентификатор агента.');
    const state = this.load();
    if (!Object.prototype.hasOwnProperty.call(state.workspaces, agentId)) return { deleted: false };
    delete state.workspaces[agentId];
    this.save(state);
    return { deleted: true };
  }
}

export const agentFileWorkspace = new AgentFileWorkspaceStore();
