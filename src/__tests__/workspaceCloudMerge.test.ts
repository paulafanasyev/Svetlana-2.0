import { describe, it, expect } from 'vitest';
import { PersonalWorkspaceStore } from '../services/PersonalWorkspaceStore';

function makeStorage() {
  const values = new Map<string, string>();
  return () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
}

describe('workspace cloud snapshot merge', () => {
  it('merges separate devices without replacing unrelated agents', () => {
    const a = new PersonalWorkspaceStore(makeStorage());
    const b = new PersonalWorkspaceStore(makeStorage());
    const agentA = a.createAgent({ name: 'Устройство A' });
    const agentB = b.createAgent({ name: 'Устройство B' });

    a.mergeSyncSnapshot(b.exportSyncSnapshot());
    b.mergeSyncSnapshot(a.exportSyncSnapshot());

    expect(a.listAgents().map(x => x.name).sort()).toEqual(['Устройство A', 'Устройство B']);
    expect(b.listAgents().map(x => x.name).sort()).toEqual(['Устройство A', 'Устройство B']);
    expect(a.getAgent(agentA.id)).toBeDefined();
    expect(b.getAgent(agentB.id)).toBeDefined();
  });

  it('does not resurrect an agent, its threads, or memory after deletion', () => {
    const localStorage = makeStorage();
    const deviceA = new PersonalWorkspaceStore(localStorage);
    const agent = deviceA.createAgent({ name: 'Удалить в A' });
    const thread = deviceA.createThread(agent.id);
    deviceA.replaceMessages(thread.id, [{ id: 'msg', role: 'user', content: 'Старый чат', timestamp: 1 }]);
    const memory = deviceA.addMemory(agent.id, 'Старая память');
    const staleCloudCopy = deviceA.exportSyncSnapshot();

    expect(deviceA.deleteAgent(agent.id)).toBe(true);
    deviceA.mergeSyncSnapshot(staleCloudCopy);
    expect(deviceA.getAgent(agent.id)).toBeUndefined();
    expect(deviceA.getThread(thread.id)).toBeUndefined();
    expect(deviceA.listMemories(agent.id)).toEqual([]);
    expect(deviceA.exportSyncSnapshot().tombstones.agents[agent.id]).toBeDefined();
    expect(deviceA.exportSyncSnapshot().tombstones.threads[thread.id]).toBeDefined();
    expect(deviceA.exportSyncSnapshot().tombstones.memories[memory.id]).toBeDefined();

    const reloaded = new PersonalWorkspaceStore(localStorage);
    reloaded.mergeSyncSnapshot(staleCloudCopy);
    expect(reloaded.getAgent(agent.id)).toBeUndefined();
    expect(reloaded.getThread(thread.id)).toBeUndefined();
    expect(reloaded.listMemories(agent.id)).toEqual([]);
  });

  it('migrates a version-1 local workspace that predates tombstones', () => {
    const storage = makeStorage();
    storage().setItem('svetlana_personal_workspace_v1', JSON.stringify({
      version: 1,
      agents: [{ id: 'agent_old', name: 'Старый агент', description: '', instructions: 'Привет', providerId: null, useMcp: false, createdAt: 1, updatedAt: 2 }],
      threads: [],
      memories: [],
      activeThreadIds: {},
    }));
    const store = new PersonalWorkspaceStore(storage);
    expect(store.getAgent('agent_old')?.name).toBe('Старый агент');
    expect(store.exportSyncSnapshot().schema).toBe('svetlana-workspace');
  });

  it('rejects unknown or malformed cloud payload formats', () => {
    const store = new PersonalWorkspaceStore(makeStorage());
    expect(() => store.mergeSyncSnapshot({ schema: 'other', version: 1 })).toThrow('Неподдерживаемый формат синхронизации');
    expect(() => store.mergeSyncSnapshot(null)).toThrow('Неподдерживаемый формат синхронизации');
  });
});
