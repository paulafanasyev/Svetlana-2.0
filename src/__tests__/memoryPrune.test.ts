// Долгая память не растёт бесконечно, устаревшие записи уходят, предпочтения и факты ценнее разговоров.
import { describe, it, expect } from 'vitest';
import { pruneLongTerm, EPISODIC_TTL_MS, type MemoryItem } from '../services/Memory';

const NOW = 2_000_000_000_000;
const item = (id: string, type: MemoryItem['type'], importance: number, age = 0, lastAccessed = NOW): MemoryItem => ({
  id, type, content: id, timestamp: NOW - age, importance, accessCount: 0, lastAccessed,
});

describe('pruneLongTerm', () => {
  it('drops expired conversations and actions but keeps old facts', () => {
    const old = EPISODIC_TTL_MS + 1;
    const drop = pruneLongTerm([item('a', 'action', 1, old), item('c', 'conversation', 1, old), item('f', 'fact', 0.1, old)], NOW, 100);
    expect(drop.sort()).toEqual(['a', 'c']);
  });

  it('keeps at most limit items, removing the least valuable first', () => {
    const items = [
      item('pref', 'preference', 0.1),
      item('act-low', 'action', 0.1, 0, NOW - 1000),
      item('act-low-recent', 'action', 0.1, 0, NOW),
      item('act-high', 'action', 0.9),
    ];
    expect(pruneLongTerm(items, NOW, 2).sort()).toEqual(['act-low', 'act-low-recent']);
    expect(pruneLongTerm(items, NOW, 3)).toEqual(['act-low']);
    expect(pruneLongTerm(items, NOW, 10)).toEqual([]);
  });
});
