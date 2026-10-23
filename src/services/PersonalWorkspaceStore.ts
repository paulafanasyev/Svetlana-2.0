import { safeJsonParse, stripControl, MAX_BYTES } from './security/SafeData';
import { redactSecrets } from './security/Redact';

export type AgentRole = 'user' | 'assistant';
export interface WorkspaceMessage {
  id: string;
  role: AgentRole;
  content: string;
  displayContent?: string;
  timestamp: number;
  provider?: string;
}
export interface PersonalAgent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  providerId: string | null;
  useMcp: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface WorkspaceThread {
  id: string;
  agentId: string | null;
  title: string;
  messages: WorkspaceMessage[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}
export interface AgentMemory {
  id: string;
  agentId: string | null;
  content: string;
  source: 'user' | 'chat';
  createdAt: number;
}
export interface WorkspaceTombstones {
  agents: Record<string, number>;
  threads: Record<string, number>;
  memories: Record<string, number>;
}
export interface WorkspaceSyncSnapshot {
  schema: 'svetlana-workspace';
  version: 1;
  agents: PersonalAgent[];
  threads: WorkspaceThread[];
  memories: AgentMemory[];
  tombstones: WorkspaceTombstones;
}
interface WorkspaceData {
  version: 2;
  agents: PersonalAgent[];
  threads: WorkspaceThread[];
  memories: AgentMemory[];
  activeThreadIds: Record<string, string>;
  tombstones: WorkspaceTombstones;
}
interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const KEY = 'svetlana_personal_workspace_v1';
const MAX_AGENTS = 100;
const MAX_THREADS = 300;
const MAX_MESSAGES_PER_THREAD = 500;
const MAX_MEMORIES = 500;
const MAX_TEXT = 20_000;
const scopeKey = (agentId: string | null) => agentId ?? '__default__';
const makeId = (prefix: string) => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return prefix + '_' + crypto.randomUUID();
  } catch { /* fallback below */ }
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
};
const now = () => Date.now();
const cleanText = (value: unknown, max = MAX_TEXT) => {
  const text = stripControl(typeof value === 'string' ? value : String(value ?? '')).slice(0, max);
  // Also hide credentials written as JSON/key-value pairs, not only recognizable token formats.
  return redactSecrets(text).replace(/(["']?)(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|authorization|secret)(["']?\s*[:=]\s*["']?)([^\s"',;}]+)/gi, '$1$2$3[скрыто]');
};
export function parseExplicitMemoryCommand(text: string): string | null {
  const match = text.trim().match(/^(?:запомни|запиши\s+в\s+память|remember)\s*(?:[:,—-])\s*(.{1,2000})$/i);
  if (!match) return null;
  const content = cleanText(match[1].replace(/^что\s+/i, ''), 2000).trim();
  return content || null;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function defaultStorage(): KV | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function emptyTombstones(): WorkspaceTombstones {
  return { agents: {}, threads: {}, memories: {} };
}
function decodeTombstones(value: unknown): WorkspaceTombstones {
  const result = emptyTombstones();
  if (!isRecord(value)) return result;
  for (const kind of ['agents', 'threads', 'memories'] as const) {
    const source = value[kind];
    if (!isRecord(source)) continue;
    for (const [id, at] of Object.entries(source).slice(-5000)) {
      if (typeof at === 'number' && Number.isFinite(at) && at >= 0) result[kind][cleanText(id, 100)] = at;
    }
  }
  return result;
}
function emptyData(): WorkspaceData {
  return { version: 2, agents: [], threads: [], memories: [], activeThreadIds: {}, tombstones: emptyTombstones() };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function decodeMessage(value: unknown): WorkspaceMessage | undefined {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant') || typeof value.content !== 'string') return undefined;
  return {
    id: cleanText(value.id || makeId('msg'), 100),
    role: value.role,
    content: cleanText(value.content),
    displayContent: typeof value.displayContent === 'string' ? cleanText(value.displayContent) : undefined,
    timestamp: typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : now(),
    provider: typeof value.provider === 'string' ? cleanText(value.provider, 150) : undefined,
  };
}
function decodeAgent(value: unknown): PersonalAgent | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return undefined;
  return {
    id: cleanText(value.id, 100),
    name: cleanText(value.name, 100) || 'Мой агент',
    description: cleanText(value.description || '', 500),
    instructions: cleanText(value.instructions || '', 12_000),
    providerId: typeof value.providerId === 'string' ? cleanText(value.providerId, 100) : null,
    useMcp: value.useMcp === true,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now(),
  };
}
function decodeThread(value: unknown): WorkspaceThread | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  const agentId = typeof value.agentId === 'string' ? cleanText(value.agentId, 100) : null;
  const messages = Array.isArray(value.messages) ? value.messages.map(decodeMessage).filter((m): m is WorkspaceMessage => !!m).slice(-MAX_MESSAGES_PER_THREAD) : [];
  return {
    id: cleanText(value.id, 100),
    agentId,
    title: cleanText(value.title || 'Новый чат', 120) || 'Новый чат',
    messages,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now(),
    archived: value.archived === true,
  };
}
function decodeMemory(value: unknown): AgentMemory | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.content !== 'string') return undefined;
  return {
    id: cleanText(value.id, 100),
    agentId: typeof value.agentId === 'string' ? cleanText(value.agentId, 100) : null,
    content: cleanText(value.content, 2000),
    source: value.source === 'chat' ? 'chat' : 'user',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now(),
  };
}

/**
 * Browser/device-local personal workspace store.
 * This is intentionally local-first: it does not imply cloud sync or multi-device backup.
 */
export class PersonalWorkspaceStore {
  private data: WorkspaceData = emptyData();
  private lastSaveSucceeded = true;
  constructor(private readonly storage: () => KV | null = defaultStorage) {
    this.load();
  }
  private applyTombstones() {
    // IDs are never reused. A deletion marker always wins, even when device clocks disagree.
    const goneAgent = (id: string) => this.data.tombstones.agents[id] !== undefined;
    const goneThread = (id: string) => this.data.tombstones.threads[id] !== undefined;
    const goneMemory = (id: string) => this.data.tombstones.memories[id] !== undefined;
    this.data.agents = this.data.agents.filter(a => !goneAgent(a.id));
    this.data.threads = this.data.threads.filter(t => !goneThread(t.id) && (t.agentId === null || !goneAgent(t.agentId)));
    this.data.memories = this.data.memories.filter(m => !goneMemory(m.id) && (m.agentId === null || !goneAgent(m.agentId)));
  }
  private load() {
    try {
      const raw = this.storage()?.getItem(KEY);
      if (!raw) return;
      const parsed = safeJsonParse(raw, MAX_BYTES.storage);
      if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2)) return;
      this.data = {
        version: 2,
        agents: (Array.isArray(parsed.agents) ? parsed.agents : []).map(decodeAgent).filter((x): x is PersonalAgent => !!x).slice(-MAX_AGENTS),
        threads: (Array.isArray(parsed.threads) ? parsed.threads : []).map(decodeThread).filter((x): x is WorkspaceThread => !!x).slice(-MAX_THREADS),
        memories: (Array.isArray(parsed.memories) ? parsed.memories : []).map(decodeMemory).filter((x): x is AgentMemory => !!x).slice(-MAX_MEMORIES),
        activeThreadIds: isRecord(parsed.activeThreadIds)
          ? Object.fromEntries(Object.entries(parsed.activeThreadIds).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').slice(0, MAX_AGENTS + 1).map(([k, v]) => [cleanText(k, 100), cleanText(v, 100)]))
          : {},
        tombstones: decodeTombstones(parsed.tombstones),
      };
      this.applyTombstones();
      // Orphaned agent-bound data must not become globally visible.
      const ids = new Set(this.data.agents.map(a => a.id));
      this.data.threads = this.data.threads.filter(t => t.agentId === null || ids.has(t.agentId));
      this.data.memories = this.data.memories.filter(m => m.agentId === null || ids.has(m.agentId));
      this.lastSaveSucceeded = true;
    } catch {
      this.data = emptyData();
      this.lastSaveSucceeded = false;
    }
  }
  private save(): boolean {
    try {
      const storage = this.storage();
      if (!storage) { this.lastSaveSucceeded = false; return false; }
      storage.setItem(KEY, JSON.stringify(this.data));
      this.lastSaveSucceeded = true;
      return true;
    } catch {
      this.lastSaveSucceeded = false;
      return false;
    }
  }
  isPersisted() { return this.lastSaveSucceeded; }
  storageMode(): 'local' | 'unavailable' {
    try { return this.storage() ? 'local' : 'unavailable'; } catch { return 'unavailable'; }
  }
  listAgents(): PersonalAgent[] { return clone(this.data.agents.slice().sort((a, b) => b.updatedAt - a.updatedAt)); }
  getAgent(id: string): PersonalAgent | undefined {
    const item = this.data.agents.find(a => a.id === id);
    return item ? clone(item) : undefined;
  }
  createAgent(input: Partial<Pick<PersonalAgent, 'name'|'description'|'instructions'|'providerId'|'useMcp'>> = {}): PersonalAgent {
    if (this.data.agents.length >= MAX_AGENTS) throw new Error('Достигнут лимит в 100 агентов.');
    const time = now();
    const agent: PersonalAgent = {
      id: makeId('agent'),
      name: cleanText(input.name || 'Новый агент', 100),
      description: cleanText(input.description || '', 500),
      instructions: cleanText(input.instructions || 'Ты — полезный ИИ-агент. Отвечай на русском языке, следуй инструкциям пользователя в пределах правил безопасности.', 12_000),
      providerId: typeof input.providerId === 'string' ? cleanText(input.providerId, 100) : null,
      useMcp: input.useMcp === true,
      createdAt: time,
      updatedAt: time,
    };
    delete this.data.tombstones.agents[agent.id];
    this.data.agents.push(agent);
    this.save();
    return clone(agent);
  }
  updateAgent(id: string, patch: Partial<Pick<PersonalAgent, 'name'|'description'|'instructions'|'providerId'|'useMcp'>>): PersonalAgent | undefined {
    const agent = this.data.agents.find(a => a.id === id);
    if (!agent) return undefined;
    if (patch.name !== undefined) agent.name = cleanText(patch.name, 100) || 'Мой агент';
    if (patch.description !== undefined) agent.description = cleanText(patch.description, 500);
    if (patch.instructions !== undefined) agent.instructions = cleanText(patch.instructions, 12_000);
    if (patch.providerId !== undefined) agent.providerId = typeof patch.providerId === 'string' && patch.providerId ? cleanText(patch.providerId, 100) : null;
    if (patch.useMcp !== undefined) agent.useMcp = patch.useMcp === true;
    agent.updatedAt = now();
    this.save();
    return clone(agent);
  }
  deleteAgent(id: string): boolean {
    if (!this.data.agents.some(a => a.id === id)) return false;
    const deletedAt = now();
    this.data.tombstones.agents[id] = deletedAt;
    for (const thread of this.data.threads.filter(t => t.agentId === id)) this.data.tombstones.threads[thread.id] = deletedAt;
    for (const item of this.data.memories.filter(m => m.agentId === id)) this.data.tombstones.memories[item.id] = deletedAt;
    this.data.agents = this.data.agents.filter(a => a.id !== id);
    this.data.threads = this.data.threads.filter(t => t.agentId !== id);
    this.data.memories = this.data.memories.filter(m => m.agentId !== id);
    delete this.data.activeThreadIds[scopeKey(id)];
    this.save();
    return true;
  }
  getActiveThread(agentId: string | null): WorkspaceThread | undefined {
    const id = this.data.activeThreadIds[scopeKey(agentId)];
    const thread = id ? this.data.threads.find(t => t.id === id && t.agentId === agentId && !t.archived) : undefined;
    return thread ? clone(thread) : undefined;
  }
  setActiveThread(agentId: string | null, threadId: string): boolean {
    const thread = this.data.threads.find(t => t.id === threadId && t.agentId === agentId && !t.archived);
    if (!thread) return false;
    this.data.activeThreadIds[scopeKey(agentId)] = threadId;
    return this.save();
  }
  listThreads(agentId: string | null): WorkspaceThread[] {
    return clone(this.data.threads.filter(t => t.agentId === agentId && !t.archived).sort((a, b) => b.updatedAt - a.updatedAt));
  }
  getThread(id: string): WorkspaceThread | undefined {
    const thread = this.data.threads.find(t => t.id === id);
    return thread ? clone(thread) : undefined;
  }
  createThread(agentId: string | null, title = 'Новый чат'): WorkspaceThread {
    if (agentId && !this.data.agents.some(a => a.id === agentId)) throw new Error('Агент не найден.');
    if (this.data.threads.length >= MAX_THREADS) {
      const old = this.data.threads.filter(t => t.archived).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!old) throw new Error('Достигнут лимит историй чатов. Удалите старые диалоги.');
      this.data.threads = this.data.threads.filter(t => t.id !== old.id);
    }
    const time = now();
    const thread: WorkspaceThread = { id: makeId('thread'), agentId, title: cleanText(title, 120) || 'Новый чат', messages: [], createdAt: time, updatedAt: time, archived: false };
    delete this.data.tombstones.threads[thread.id];
    this.data.threads.push(thread);
    this.data.activeThreadIds[scopeKey(agentId)] = thread.id;
    this.save();
    return clone(thread);
  }
  replaceMessages(threadId: string, messages: WorkspaceMessage[]): boolean {
    const thread = this.data.threads.find(t => t.id === threadId);
    if (!thread) return false;
    thread.messages = messages.slice(-MAX_MESSAGES_PER_THREAD).map(m => ({
      id: cleanText(m.id || makeId('msg'), 100),
      role: m.role === 'user' ? 'user' : 'assistant',
      content: cleanText(m.content),
      displayContent: m.displayContent ? cleanText(m.displayContent) : undefined,
      timestamp: Number.isFinite(m.timestamp) ? m.timestamp : now(),
      provider: m.provider ? cleanText(m.provider, 150) : undefined,
    }));
    const firstUser = thread.messages.find(m => m.role === 'user');
    if (firstUser && thread.title === 'Новый чат') thread.title = cleanText(firstUser.displayContent || firstUser.content, 80) || 'Новый чат';
    thread.updatedAt = now();
    return this.save();
  }
  addMemory(agentId: string | null, content: string, source: AgentMemory['source'] = 'user'): AgentMemory {
    if (agentId && !this.data.agents.some(a => a.id === agentId)) throw new Error('Агент не найден.');
    const text = cleanText(content, 2000);
    if (!text.trim()) throw new Error('Память не может быть пустой.');
    const duplicate = this.data.memories.find(m => m.agentId === agentId && m.content.toLocaleLowerCase() === text.toLocaleLowerCase());
    if (duplicate) return clone(duplicate);
    if (this.data.memories.length >= MAX_MEMORIES) throw new Error('Достигнут лимит записей памяти.');
    const item: AgentMemory = { id: makeId('memory'), agentId, content: text, source, createdAt: now() };
    delete this.data.tombstones.memories[item.id];
    this.data.memories.push(item);
    this.save();
    return clone(item);
  }
  listMemories(agentId: string | null): AgentMemory[] {
    return clone(this.data.memories.filter(m => m.agentId === agentId).sort((a, b) => b.createdAt - a.createdAt));
  }
  deleteMemory(id: string): boolean {
    const before = this.data.memories.length;
    this.data.memories = this.data.memories.filter(m => m.id !== id);
    if (before === this.data.memories.length) return false;
    this.data.tombstones.memories[id] = now();
    this.save();
    return true;
  }
  deleteThread(id: string): boolean {
    const thread = this.data.threads.find(t => t.id === id);
    if (!thread) return false;
    this.data.threads = this.data.threads.filter(t => t.id !== id);
    this.data.tombstones.threads[id] = now();
    if (this.data.activeThreadIds[scopeKey(thread.agentId)] === id) delete this.data.activeThreadIds[scopeKey(thread.agentId)];
    return this.save();
  }
  archiveThread(id: string): boolean {
    const thread = this.data.threads.find(t => t.id === id);
    if (!thread) return false;
    thread.archived = true;
    thread.updatedAt = now();
    if (this.data.activeThreadIds[scopeKey(thread.agentId)] === id) delete this.data.activeThreadIds[scopeKey(thread.agentId)];
    return this.save();
  }
  exportAgent(id: string): string {
    const agent = this.getAgent(id);
    if (!agent) throw new Error('Агент не найден.');
    return JSON.stringify({ schema: 'svetlana-agent', version: 1, agent, memories: this.listMemories(id) }, null, 2);
  }
  importAgent(json: string): PersonalAgent {
    const parsed = safeJsonParse(json, 200_000);
    if (!isRecord(parsed) || parsed.schema !== 'svetlana-agent' || parsed.version !== 1 || !isRecord(parsed.agent)) throw new Error('Неподдерживаемый формат агента.');
    const input = decodeAgent({ ...parsed.agent, id: 'imported' });
    const agent = this.createAgent({
      name: input?.name || 'Импортированный агент',
      description: input?.description || '',
      instructions: input?.instructions || '',
      providerId: input?.providerId || null,
      useMcp: input?.useMcp || false,
    });
    const memories = Array.isArray(parsed.memories) ? parsed.memories : [];
    for (const raw of memories.slice(0, 100)) {
      const m = decodeMemory({ ...((isRecord(raw) ? raw : {}) as Record<string, unknown>), id: makeId('memory'), agentId: agent.id });
      if (m) this.addMemory(agent.id, m.content, m.source);
    }
    return agent;
  }
  exportSyncSnapshot(): WorkspaceSyncSnapshot {
    return clone({
      schema: 'svetlana-workspace' as const,
      version: 1 as const,
      agents: this.data.agents,
      threads: this.data.threads,
      memories: this.data.memories,
      tombstones: this.data.tombstones,
    });
  }

  /** Merge a validated account snapshot without silently reviving locally deleted records. */
  mergeSyncSnapshot(input: unknown): { agents: number; threads: number; memories: number } {
    if (!isRecord(input) || input.schema !== 'svetlana-workspace' || input.version !== 1) {
      throw new Error('Неподдерживаемый формат синхронизации.');
    }
    const remoteAgents = (Array.isArray(input.agents) ? input.agents : []).map(decodeAgent).filter((x): x is PersonalAgent => !!x).slice(-MAX_AGENTS);
    const remoteThreads = (Array.isArray(input.threads) ? input.threads : []).map(decodeThread).filter((x): x is WorkspaceThread => !!x).slice(-MAX_THREADS);
    const remoteMemories = (Array.isArray(input.memories) ? input.memories : []).map(decodeMemory).filter((x): x is AgentMemory => !!x).slice(-MAX_MEMORIES);
    const remoteTombstones = decodeTombstones(input.tombstones);
    const countBefore = { agents: this.data.agents.length, threads: this.data.threads.length, memories: this.data.memories.length };
    for (const kind of ['agents', 'threads', 'memories'] as const) {
      for (const [id, at] of Object.entries(remoteTombstones[kind])) {
        this.data.tombstones[kind][id] = Math.max(this.data.tombstones[kind][id] ?? 0, at);
      }
    }
    const mergeById = <T extends { id: string }>(
      local: T[],
      remote: T[],
      kind: 'agents' | 'threads' | 'memories',
      timestamp: (item: T) => number,
    ): T[] => {
      const merged = new Map(local.map(item => [item.id, item]));
      for (const item of remote) {
        const current = merged.get(item.id);
        if (!current || timestamp(item) > timestamp(current)) merged.set(item.id, item);
      }
      // A tombstone wins regardless of timestamps; IDs are generated uniquely and never revived. 
      return Array.from(merged.values()).filter(item => this.data.tombstones[kind][item.id] === undefined);
    };
    this.data.agents = mergeById(this.data.agents, remoteAgents, 'agents', item => (item as PersonalAgent).updatedAt).slice(-MAX_AGENTS);
    this.data.threads = mergeById(this.data.threads, remoteThreads, 'threads', item => (item as WorkspaceThread).updatedAt).slice(-MAX_THREADS);
    this.data.memories = mergeById(this.data.memories, remoteMemories, 'memories', item => (item as AgentMemory).createdAt).slice(-MAX_MEMORIES);
    const ids = new Set(this.data.agents.map(a => a.id));
    this.data.threads = this.data.threads.filter(t => t.agentId === null || ids.has(t.agentId));
    this.data.memories = this.data.memories.filter(m => m.agentId === null || ids.has(m.agentId));
    this.applyTombstones();
    this.save();
    return {
      agents: Math.max(0, this.data.agents.length - countBefore.agents),
      threads: Math.max(0, this.data.threads.length - countBefore.threads),
      memories: Math.max(0, this.data.memories.length - countBefore.memories),
    };
  }

  clearAll() {
    this.data = emptyData();
    this.lastSaveSucceeded = true;
    try { this.storage()?.removeItem(KEY); } catch { this.lastSaveSucceeded = false; }
  }
}

export const personalWorkspace = new PersonalWorkspaceStore();
