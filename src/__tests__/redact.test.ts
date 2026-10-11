import { describe, it, expect } from 'vitest';
import { redactSecrets, redactDeep } from '../services/security/Redact';

describe('redactSecrets', () => {
  it('hides keys, tokens, passwords, codes and cards', () => {
    expect(redactSecrets('ключ sk-proj-abcdefghijklmnop1234')).not.toContain('sk-proj');
    expect(redactSecrets('AIzaSyA1234567890abcdefghijklmnopqrstu')).toBe('[ключ скрыт]');
    expect(redactSecrets('Bearer abcdefghijklmnopqrstuvwxyz')).toBe('Bearer [скрыто]');
    expect(redactSecrets('пароль: hunter2 ок')).toBe('пароль: [скрыто] ок');
    expect(redactSecrets('код 123456')).toBe('код [скрыто]');
    expect(redactSecrets('карта 4111 1111 1111 1111')).toBe('карта [карта скрыта]');
  });

  it('keeps phones and ordinary numbers', () => {
    expect(redactSecrets('телефон +7 916 123 45 67')).toBe('телефон +7 916 123 45 67');
    expect(redactSecrets('заказ 1234567890123')).toBe('заказ 1234567890123');
  });

  it('redacts nested metadata', () => {
    const out = redactDeep({ a: { b: ['password=qwerty'] }, n: 5 });
    expect(out).toEqual({ a: { b: ['password=[скрыто]'] }, n: 5 });
  });
});
