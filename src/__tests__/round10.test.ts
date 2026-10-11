import { describe, it, expect } from 'vitest';
import { redactValue, redactDeep } from '../services/security/Redact';
import { toModelHistory } from '../services/security/History';

describe('round 10 hardening', () => {
  it('hides more secret field names in logs and memory', () => {
    const r = redactValue({ api_token: 'abc', auth_token: 'x', private_key: 'k', clientSecret: 's', sessionToken: 't', name: 'Иван' }) as Record<string, unknown>;
    expect(r.api_token).toBe('[скрыто]');
    expect(r.auth_token).toBe('[скрыто]');
    expect(r.private_key).toBe('[скрыто]');
    expect(r.clientSecret).toBe('[скрыто]');
    expect(r.sessionToken).toBe('[скрыто]');
    expect(r.name).toBe('Иван');
    const m = redactDeep({ refreshToken: 'r', phone: '+79991234567' });
    expect(m.refreshToken).toBe('[скрыто]');
    expect(m.phone).toBe('+79991234567');
  });

  it('earlier tool output goes back to the model only as data, never as action blocks', () => {
    const h = toModelHistory([
      { role: 'user', content: 'Сводка CRM' },
      { role: 'svetlana', content: 'Контакт: Иван [CRM: {"tool":"crm_move_deal","args":{}}]', hasData: true },
      { role: 'svetlana', content: 'Готово [CRM: {"tool":"crm_add_task","args":{}}]' },
    ]);
    expect(h[0]).toEqual({ role: 'user', content: 'Сводка CRM' });
    expect(h[1].role).toBe('assistant');
    expect(h[1].content).toContain('⟦ДАННЫЕ');
    expect(h[1].content).not.toContain('[CRM:');
    expect(h[2].content).not.toContain('[CRM:');
  });
});
