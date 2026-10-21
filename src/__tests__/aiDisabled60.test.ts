// Пачка 60: выключенный ИИ не отвечает в чате.
import { describe, it, expect } from 'vitest';
import { aiGateway } from '../services/AIGateway';

describe('disabled AI provider', () => {
  it('is not active after it is switched off', async () => {
    await aiGateway.ready;
    await aiGateway.updateProvider('lmstudio', { enabled: true });
    expect(aiGateway.getActiveProvider()?.id).toBe('lmstudio');
    await aiGateway.updateProvider('lmstudio', { enabled: false });
    const active = aiGateway.getActiveProvider();
    expect(active?.id).not.toBe('lmstudio');
    if (active) expect(active.enabled).toBe(true);
  });

  it('the only enabled provider switched off leaves no active AI', async () => {
    await aiGateway.ready;
    for (const p of aiGateway.getAllProviders()) if (p.enabled) await aiGateway.updateProvider(p.id, { enabled: false });
    expect(aiGateway.getActiveProvider()).toBeUndefined();
    await aiGateway.updateProvider('ollama', { enabled: true });
    expect(aiGateway.getActiveProvider()?.id).toBe('ollama');
  });
});
