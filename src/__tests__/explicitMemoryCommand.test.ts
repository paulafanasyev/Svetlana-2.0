import { describe, it, expect } from 'vitest';
import { parseExplicitMemoryCommand, PersonalWorkspaceStore } from '../services/PersonalWorkspaceStore';

function memoryStorage() {
  const values = new Map<string, string>();
  return () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
}

describe('explicit memory commands', () => {
  it('recognizes clear explicit commands but does not treat ordinary messages as memory', () => {
    expect(parseExplicitMemoryCommand('Запомни: я предпочитаю короткие ответы')).toBe('я предпочитаю короткие ответы');
    expect(parseExplicitMemoryCommand('Запиши в память: люблю таблицы')).toBe('люблю таблицы');
    expect(parseExplicitMemoryCommand('Remember: answer in Russian')).toBe('answer in Russian');
    expect(parseExplicitMemoryCommand('Расскажи, что ты помнишь')).toBeNull();
    expect(parseExplicitMemoryCommand('Запомни')).toBeNull();
  });

  it('redacts key-value credentials before persisting durable notes', () => {
    const store = new PersonalWorkspaceStore(memoryStorage());
    const agent = store.createAgent({ name: 'Безопасность' });
    store.addMemory(agent.id, 'apiKey=do-not-store-this-value');
    const persisted = store.listMemories(agent.id)[0]?.content ?? '';
    expect(persisted).toContain('[скрыто]');
    expect(persisted).not.toContain('do-not-store-this-value');
  });
});
