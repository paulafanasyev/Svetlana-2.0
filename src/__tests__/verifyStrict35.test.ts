// Проверка результата действия строгая: любое расхождение с ожидаемым — неудача.
import { describe, it, expect, beforeEach } from 'vitest';
import { verification } from '../services/Verification';

beforeEach(() => verification.clearHistory());

describe('Verification fail-closed', () => {
  it('инструмент ответил success: false — проверка не проходит', async () => {
    const r = await verification.verify({ action: 'tap', expectedState: { success: true }, actualState: { success: false } });
    expect(r.success).toBe(false);
    expect(r.differences.length).toBe(1);
  });

  it('лишние поля ответа не мешают успеху', async () => {
    const r = await verification.verify({ action: 'tap', expectedState: { success: true }, actualState: { success: true, data: { x: 1 }, message: 'ok' } });
    expect(r.success).toBe(true);
    expect(r.extras).toEqual(['.data', '.message']);
  });

  it('нет ответа или не тот тип — неудача, без исключения', async () => {
    for (const actualState of [null, undefined, 'ok', 1, [true]]) {
      const r = await verification.verify({ action: 'tap', expectedState: { success: true }, actualState });
      expect(r.success).toBe(false);
    }
  });

  it('допуск только явный', async () => {
    const req = { action: 'x', expectedState: { a: 1, b: 2 }, actualState: { a: 1, b: 3 } };
    expect((await verification.verify(req)).success).toBe(false);
    expect((await verification.verify({ ...req, tolerance: 1 })).success).toBe(true);
  });

  it('ошибка наблюдения — неудача, а не исключение', async () => {
    const { result } = await verification.verifyWithRetry(
      { action: 'x', expectedState: { success: true }, actualState: undefined },
      async () => { throw new Error('screen unavailable'); },
      0,
    );
    expect(result.success).toBe(false);
    expect(result.differences).toContain('Observation failed');
  });

  it('экран: один не найденный элемент — уже неудача', async () => {
    const r = await verification.verifyScreenState(
      { elements: [{ id: 'send', type: 'button' }] },
      { elements: [{ id: 'other', type: 'button' }] },
    );
    expect(r.success).toBe(false);
  });
});
