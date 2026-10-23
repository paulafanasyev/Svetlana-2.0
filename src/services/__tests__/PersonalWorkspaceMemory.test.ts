import { describe, it, expect } from 'vitest';
import { PersonalWorkspaceStore, parseExplicitMemoryCommand } from '../PersonalWorkspaceStore';

function makeStorage() {
  const data = new Map<string, string>();
  return {
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); },
    removeItem(key: string) { data.delete(key); },
  };
}

describe('main-chat explicit memory', () => {
  it('accepts explicit Russian and English save commands, but not ordinary statements', () => {
    expect(parseExplicitMemoryCommand('Запомни: мой проект называется Светлана')).toBe('мой проект называется Светлана');
    expect(parseExplicitMemoryCommand('запиши в память — предпочитаю ответы на русском')).toBe('предпочитаю ответы на русском');
    expect(parseExplicitMemoryCommand('remember: I prefer short answers')).toBe('I prefer short answers');
    expect(parseExplicitMemoryCommand('мой проект называется Светлана')).toBeNull();
    expect(parseExplicitMemoryCommand('Запомни')).toBeNull();
  });

  it('persists locally across store instances and makes deleted facts disappear from future context', () => {
    const storage = makeStorage();
    const first = new PersonalWorkspaceStore(() => storage);
    const saved = first.addMemory(null, 'Мой основной проект — Svetlana-2.0', 'user');
    expect(first.listMemories(null)).toEqual([saved]);

    const reloaded = new PersonalWorkspaceStore(() => storage);
    expect(reloaded.listMemories(null).map(item => item.content)).toEqual(['Мой основной проект — Svetlana-2.0']);
    expect(reloaded.deleteMemory(saved.id)).toBe(true);
    expect(new PersonalWorkspaceStore(() => storage).listMemories(null)).toEqual([]);
  });

  it('keeps the main-chat memory separate from an agent memory', () => {
    const store = new PersonalWorkspaceStore(() => makeStorage());
    const agent = store.createAgent({ name: 'Research agent' });
    store.addMemory(null, 'Только для основного чата');
    store.addMemory(agent.id, 'Только для агента');

    expect(store.listMemories(null).map(item => item.content)).toEqual(['Только для основного чата']);
    expect(store.listMemories(agent.id).map(item => item.content)).toEqual(['Только для агента']);
  });
});
