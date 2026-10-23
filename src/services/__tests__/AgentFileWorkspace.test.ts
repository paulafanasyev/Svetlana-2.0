import { describe, it, expect } from 'vitest';
import { AgentFileWorkspaceStore } from '../AgentFileWorkspace';

function makeStorage() {
  const data = new Map<string, string>();
  return {
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); },
  };
}

describe('AgentFileWorkspaceStore', () => {
  it('persists files across store instances and scopes them to one agent', () => {
    const storage = makeStorage();
    const a = new AgentFileWorkspaceStore(() => storage);
    a.createWorkspace('agent_a');
    a.createWorkspace('agent_b');
    a.writeFile('agent_a', 'notes/todo.md', 'Только агент A');
    a.writeFile('agent_b', 'notes/todo.md', 'Только агент B');
    const reloaded = new AgentFileWorkspaceStore(() => storage);
    expect(reloaded.readFile('agent_a', 'notes/todo.md').content).toBe('Только агент A');
    expect(reloaded.readFile('agent_b', 'notes/todo.md').content).toBe('Только агент B');
    expect(reloaded.listFiles('agent_a')).toHaveLength(1);
  });

  it('requires an explicit workspace creation and an explicit overwrite', () => {
    const store = new AgentFileWorkspaceStore(() => makeStorage());
    expect(() => store.writeFile('agent_a', 'note.md', 'data')).toThrow(/сначала вызовите agent_workspace_create/);
    store.createWorkspace('agent_a');
    store.writeFile('agent_a', 'note.md', 'first');
    expect(() => store.writeFile('agent_a', 'note.md', 'second')).toThrow(/overwrite: true/);
    store.writeFile('agent_a', 'note.md', 'second', true);
    expect(store.readFile('agent_a', 'note.md').content).toBe('second');
  });

  it('rejects path traversal and unsupported sizes', () => {
    const store = new AgentFileWorkspaceStore(() => makeStorage());
    store.createWorkspace('agent_a');
    for (const path of ['../secret.txt', '/etc/passwd', 'notes/../../secret', 'C:/secret.txt', 'notes\\\\secret.txt']) {
      expect(() => store.writeFile('agent_a', path, 'x')).toThrow();
    }
    expect(() => store.writeFile('agent_a', 'large.txt', 'x'.repeat(2001))).toThrow(/2000 символов/);
  });

  it('rejects attempts to read another agent by using an invalid or missing scope', () => {
    const store = new AgentFileWorkspaceStore(() => makeStorage());
    store.createWorkspace('agent_a');
    store.writeFile('agent_a', 'private.txt', 'private');
    expect(() => store.readFile('agent_b', 'private.txt')).toThrow(/ещё нет локального хранилища/);
    expect(() => store.status('../agent_a')).toThrow(/идентификатор агента/);
  });

  it('deletes one file or the entire private workspace', () => {
    const store = new AgentFileWorkspaceStore(() => makeStorage());
    store.createWorkspace('agent_a');
    store.writeFile('agent_a', 'one.md', '1');
    store.writeFile('agent_a', 'two.md', '2');
    expect(store.deleteFile('agent_a', 'one.md').deleted).toBe(true);
    expect(store.listFiles('agent_a').map(f => f.path)).toEqual(['two.md']);
    expect(store.deleteWorkspace('agent_a').deleted).toBe(true);
    expect(store.status('agent_a').exists).toBe(false);
  });
});
