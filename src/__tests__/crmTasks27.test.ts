// Пачка 27: задача CRM удаляется только после вопроса, ошибки понятным текстом, сбой импорта читается как alert.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const page = readFileSync(resolve(__dirname, '../pages/CRMPage.tsx'), 'utf8');

describe('CRM page safety', () => {
  it('asks before deleting a task', () => {
    const fn = page.slice(page.indexOf('const removeTask = async'));
    expect(fn.indexOf('await askConfirm(')).toBeGreaterThan(-1);
    expect(fn.indexOf('await askConfirm(')).toBeLessThan(fn.indexOf('crmStore.deleteActivity('));
    expect(page).not.toContain('onClick={() => crmStore.deleteActivity(');
  });

  it('shows friendly error text only', () => {
    expect(page).not.toContain('?.message');
    expect((page.match(/safeErrorText\(/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('import failures are alerts, results are statuses', () => {
    expect(page).toContain("role={msg.error ? 'alert' : 'status'}");
    expect(page).toContain('setMessage(await handler(');
  });
});
