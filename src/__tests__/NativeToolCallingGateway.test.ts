import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeToolCall } from '../services/NativeToolCallingGateway';

describe('NativeToolCallingGateway', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses a Google Interactions API function_call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'int_test',
      steps: [
        { type: 'function_call', id: 'fc_1', name: 'open_app', arguments: { packageName: 'com.example.app' } },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await nativeToolCall(
      { id: 'google', name: 'Google', endpoint: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'test-key', model: 'gemma-4-31b-it' },
      [{ role: 'user', content: 'Open the app' }],
      [{ type: 'function', function: { name: 'open_app', description: 'Open an app', parameters: { type: 'object' } } }],
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
      }),
    );
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ tool: 'open_app', arguments: { packageName: 'com.example.app' }, requestId: 'fc_1' }),
    ]);
  });

  it('rejects malformed structured arguments instead of guessing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ id: 'fc_bad', function: { name: 'open_app', arguments: 'not-json' } }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(nativeToolCall(
      { id: 'openai', name: 'OpenAI', endpoint: '', apiKey: 'test-key', model: 'test-model' },
      [{ role: 'user', content: 'Open the app' }],
      [{ type: 'function', function: { name: 'open_app', description: 'Open an app', parameters: { type: 'object' } } }],
    )).rejects.toThrow('Invalid tool arguments for open_app');
  });
});
