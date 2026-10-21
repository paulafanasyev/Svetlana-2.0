// Пачка 28: в окнах подтверждения, описаниях MCP и памяти не остаётся невидимых и направляющих символов.
import { describe, it, expect } from 'vitest';
import { stripControl } from '../services/security/SafeData';

describe('stripControl removes every invisible character', () => {
  it('bidi, zero-width, BOM, soft hyphen and friends', () => {
    const bad = ['\u061c', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\u2066', '\u2069', '\u202a', '\u202e', '\ufeff', '\u00ad', '\u180e', '\ufff9', '\ufffb'];
    for (const ch of bad) {
      expect({ code: ch.charCodeAt(0).toString(16), out: stripControl(`Удали${ch}ть`) }).toEqual({ code: ch.charCodeAt(0).toString(16), out: 'Удалить' });
    }
  });

  it('keeps ordinary text, newlines and non-breaking spaces', () => {
    expect(stripControl('Привет,\nмир «Светлана» 100\u00a0₽')).toBe('Привет,\nмир «Светлана» 100\u00a0₽');
    expect(stripControl('a\nb', false)).toBe('a b');
  });
});
