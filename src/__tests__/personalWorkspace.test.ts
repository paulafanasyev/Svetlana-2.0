import { describe, it, expect } from 'vitest';
import { PersonalWorkspaceStore } from '../services/PersonalWorkspaceStore';

function storageFactory() {
  const values = new Map<string, string>();
  return {
    storage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    }),
    values,
  };
}

describe('PersonalWorkspaceStore', () => {
  it('persists agents, thread messages, and active thread across store instances', () => {
    const backing = storageFactory();
    const first = new PersonalWorkspaceStore(backing.storage);
    const agent = first.createAgent({
      name: 'Редактор',
      description: 'Правит тексты',
      instructions: 'Отвечай кратко',
      providerId: 'ollama',
    });
    const thread = first.createThread(agent.id, 'Новый чат');
    first.replaceMessages(thread.id, [
      { id: 'u1', role: 'user', content: 'Проверь текст', timestamp: 100 },
      { id: 'a1', role: 'assistant', content: 'Готово', timestamp: 200, provider: 'Ollama' },
    ]);

    const reloaded = new PersonalWorkspaceStore(backing.storage);
    expect(reloaded.getAgent(agent.id)?.name).toBe('Редактор');
    expect(reloaded.getActiveThread(agent.id)?.id).toBe(thread.id);
    expect(reloaded.getThread(thread.id)?.messages.map(m => m.content)).toEqual(['Проверь текст', 'Готово']);
    expect(reloaded.getThread(thread.id)?.title).toBe('Проверь текст');
  });

  it('keeps each agent thread and memory scoped separately', () => {
    const backing = storageFactory();
    const store = new PersonalWorkspaceStore(backing.storage);
    const a = store.createAgent({ name: 'Агент A' });
    const b = store.createAgent({ name: 'Агент B' });
    const threadA = store.createThread(a.id);
    store.createThread(b.id);
    store.replaceMessages(threadA.id, [{ id: 'only-a', role: 'user', content: 'только А', timestamp: 1 }]);
    store.addMemory(a.id, 'Память А');
    store.addMemory(b.id, 'Память Б');

    expect(store.listThreads(a.id)).toHaveLength(1);
    expect(store.listThreads(b.id)).toHaveLength(1);
    expect(store.listMemories(a.id).map(m => m.content)).toEqual(['Память А']);
    expect(store.listMemories(b.id).map(m => m.content)).toEqual(['Память Б']);
    expect(store.getThread(threadA.id)?.messages[0].content).toBe('только А');
  });

  it('redacts recognizable secrets before persistent message storage', () => {
    const backing = storageFactory();
    const store = new PersonalWorkspaceStore(backing.storage);
    const thread = store.createThread(null);
    store.replaceMessages(thread.id, [
      { id: 'u1', role: 'user', content: 'Use Bearer abcdefghijklmnop for this request', timestamp: 1 },
    ]);
    const persisted = new PersonalWorkspaceStore(backing.storage).getThread(thread.id)?.messages[0].content ?? '';
    expect(persisted).toContain('Bearer [скрыто]');
    expect(persisted).not.toContain('abcdefghijklmnop');
  });

  it('exports and imports agent settings and memory without reusing the original id', () => {
    const backing = storageFactory();
    const source = new PersonalWorkspaceStore(backing.storage);
    const original = source.createAgent({
      name: 'Импортируемый',
      description: 'Описание',
      instructions: 'Инструкции',
      providerId: 'local-model',
      useMcp: true,
    });
    source.addMemory(original.id, 'Пользователь предпочитает русский язык');
    const exported = source.exportAgent(original.id);

    const imported = new PersonalWorkspaceStore(storageFactory().storage);
    const result = imported.importAgent(exported);
    expect(result.id).not.toBe(original.id);
    expect(result.name).toBe('Импортируемый');
    expect(result.instructions).toBe('Инструкции');
    expect(result.providerId).toBe('local-model');
    expect(result.useMcp).toBe(true);
    expect(imported.listMemories(result.id).map(m => m.content)).toEqual(['Пользователь предпочитает русский язык']);
  });

  it('deleting an agent deletes its private threads and memory', () => {
    const backing = storageFactory();
    const store = new PersonalWorkspaceStore(backing.storage);
    const agent = store.createAgent({ name: 'Удаляемый' });
    const thread = store.createThread(agent.id);
    store.addMemory(agent.id, 'Private note');
    expect(store.deleteAgent(agent.id)).toBe(true);
    expect(store.getAgent(agent.id)).toBeUndefined();
    expect(store.getThread(thread.id)).toBeUndefined();
    expect(store.listMemories(agent.id)).toEqual([]);
  });
});
