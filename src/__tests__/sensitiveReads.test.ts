// Пачка 20: личные данные клиентов нейросеть получает только после нажатия.
import { describe, it, expect, beforeEach } from 'vitest';
import { authorizeAction, needsConfirmation, setActionConfirmer, resetActionGate, summarizeAction, SENSITIVE_READ_WARNING, isSensitiveRead } from '../services/security/ActionGate';

beforeEach(() => resetActionGate());

describe('sensitive reads', () => {
  it('the model must ask before reading client personal data', () => {
    for (const tool of ['crm_find_contacts', 'biz_receivables', 'biz_analytics', 'biz_agenda', 'biz_booking_reminders']) {
      expect(isSensitiveRead(tool)).toBe(true);
      expect(needsConfirmation(tool, 'llm')).toBe(true);
      expect(needsConfirmation(tool, 'voice')).toBe(true);
      expect(needsConfirmation(tool, 'unknown')).toBe(false);
      expect(needsConfirmation(tool, 'user')).toBe(false);
    }
  });

  it('aggregate reads without names stay automatic', () => {
    for (const tool of ['crm_stats', 'biz_tax_summary', 'biz_free_slots', 'biz_find_support', 'biz_check_inn']) {
      expect(needsConfirmation(tool, 'llm')).toBe(false);
    }
  });

  it('the confirmation warns that the model will see the data, and a refusal blocks the read', async () => {
    const s = summarizeAction({ tool: 'crm_find_contacts', args: { query: 'Иван' }, source: 'llm' });
    expect(s.title).toBe('Показать контакты');
    expect(s.warning).toBe(SENSITIVE_READ_WARNING);
    expect(s.lines).toContain('Поиск: Иван');
    setActionConfirmer(async () => false);
    expect(await authorizeAction({ tool: 'crm_find_contacts', args: {}, source: 'llm' })).toBe(false);
    setActionConfirmer(async () => true);
    expect(await authorizeAction({ tool: 'crm_find_contacts', args: {}, source: 'llm' })).toBe(true);
  });
});
