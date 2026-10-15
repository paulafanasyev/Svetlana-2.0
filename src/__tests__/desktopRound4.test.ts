import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

// Итоги 4-го круга критиков: что именно нельзя сломать обратно.
describe('Windows shell round 4', () => {
  it('allows the https phone bridge in the desktop CSP (validateBridgeEndpoint accepts it)', () => {
    const csp: string = JSON.parse(read('src-tauri/tauri.conf.json')).app.security.csp;
    expect(csp).toContain('http://*:8080');
    expect(csp).toContain('https://*:8080');
  });

  it('does not show the demo orchestrator as a main tab', () => {
    const shell = read('src/DesktopShell.tsx');
    const start = shell.indexOf('const TABS');
    const tabs = shell.slice(start, shell.indexOf('];', start));
    expect(start).toBeGreaterThan(-1);
    expect(tabs).not.toContain('orchestrator');
    expect(tabs).toContain("'chat'");
    expect(shell).toContain('voice-note');
  });

  it('links the Android app from the phone page and catches startup errors', () => {
    const page = read('src/pages/AndroidConnectionPage.tsx');
    expect(page).toContain('https://github.com/paulafanasyev/Svetlana-Home/releases');
    expect(page).toMatch(/\}\)\(\)\.catch\(/);
  });

  it('does not panic when the speech model answers without log_probs', () => {
    const stt = read('src-tauri/src/local_stt.rs');
    expect(stt).not.toContain('outputs["log_probs"]');
    expect(stt).toContain('outputs.get("log_probs")');
  });

  it('handles DaData key errors on the bank page', () => {
    const page = read('src/pages/BankInnPage.tsx');
    expect(page).toMatch(/getDadataKey\(\)[\s\S]{0,120}\.catch\(/);
  });
});
