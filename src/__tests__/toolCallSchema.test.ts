import { describe, it, expect } from 'vitest';
import { validateToolCalls } from '../services/security/ToolCallSchema';

const tools = [
  { type: 'function', function: { name: 'send_email', parameters: { type: 'object', properties: { to: { type: 'string' }, body: { type: 'string' }, urgent: { type: 'boolean' } }, required: ['to'] } } },
  { name: 'crm_note', input_schema: { type: 'object', properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } } },
];

describe('validateToolCalls', () => {
  it('accepts only known tools with exact arguments', () => {
    const calls = [
      { tool: 'send_email', arguments: { to: 'a@b.c', body: 'hi' } },
      { tool: 'send_email', arguments: { to: 'a@b.c', bcc: 'evil@x' } },
      { tool: 'send_email', arguments: { body: 'no recipient' } },
      { tool: 'delete_all', arguments: {} },
      { tool: 'crm_note', arguments: { id: 5, tags: ['x'] } },
      { tool: 'crm_note', arguments: { id: 5.5 } },
      { tool: 'crm_note', arguments: { tags: [1] } },
    ];
    const ok = validateToolCalls(calls, tools);
    expect(ok.map(c => c.arguments)).toEqual([{ to: 'a@b.c', body: 'hi' }, { id: 5, tags: ['x'] }]);
  });

  it('rejects everything when no tools were offered', () => {
    expect(validateToolCalls([{ tool: 'send_email', arguments: { to: 'x' } }], [])).toEqual([]);
  });
});
