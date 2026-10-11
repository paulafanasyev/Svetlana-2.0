// Запасные провайдеры: переписка с локальной моделью никогда не уходит в облако сама по себе.
import { describe, it, expect } from 'vitest';
import { fallbackCandidates, type AIProvider } from '../services/AIGateway';

const p = (id: string, type: 'online' | 'offline', enabled = true): AIProvider => ({
  id, type, enabled, name: id, model: 'm',
  endpoint: type === 'offline' ? 'http://127.0.0.1:11434' : 'https://example.invalid',
});

describe('AI fallback', () => {
  const all = [p('ollama', 'offline'), p('lmstudio', 'offline'), p('groq', 'online'), p('openai', 'online'), p('anthropic', 'online'), p('deepseek', 'online', false)];

  it('local failure falls back only to other local models', () => {
    const ids = fallbackCandidates(all, all[0]).map(x => x.id);
    expect(ids).toEqual(['lmstudio']);
    expect(ids.some(id => ['groq', 'openai', 'anthropic', 'deepseek'].includes(id))).toBe(false);
  });
  it('no local alternative means no fallback at all (no cloud)', () => {
    expect(fallbackCandidates([p('ollama', 'offline'), p('openai', 'online')], p('ollama', 'offline'))).toEqual([]);
  });
  it('cloud failure may use another enabled cloud provider, never a disabled one', () => {
    const ids = fallbackCandidates(all, all[2]).map(x => x.id);
    expect(ids).toEqual(['openai', 'anthropic']);
  });
  it('unknown local provider type is treated as local', () => {
    expect(fallbackCandidates(all, { id: 'custom', type: 'offline' }).every(x => x.type === 'offline')).toBe(true);
  });
});
