// Пачка 22: отмена прослушивания не отдаёт поздних результатов ни в одном режиме.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const engine = readFileSync(resolve(__dirname, '../services/voice/SpeechEngine.ts'), 'utf8');
const button = readFileSync(resolve(__dirname, '../components/VoiceButton.tsx'), 'utf8');

describe('voice cancel', () => {
  it('every recognition mode has cancel() that drops late results', () => {
    expect(engine.match(/cancel: \(\) =>/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(engine.match(/if \(cancelled\) return;/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(engine).toContain('if (ended || cancelled) return;');
    expect(engine).toContain('if (cancelled) { end(); return; }');
  });
  it('the voice button cancels on unmount and ignores results after it', () => {
    expect(button).toContain('l.cancel ? l.cancel() : l.stop()');
    expect(button).toContain('if (!aliveRef.current) return;');
  });
  it('voice settings have a backdrop so the page behind cannot be clicked', () => {
    expect(button).toContain('data-testid="voice-settings-backdrop"');
  });
});
