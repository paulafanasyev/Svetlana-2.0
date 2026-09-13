import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { nativeToolCall } from '../services/NativeToolCallingGateway';

describe('Yandex native tool calling', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it('uses Api-Key auth, folder model URI and structured tool calls', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '', tool_calls: [{ id: 'call_1', function: { name: 'open_app', arguments: '{"packageName":"com.example"}' } }] } }],
    }), { status: 200 }));
    const result = await nativeToolCall(
      { id: 'yandex', name: 'Yandex AI Studio', endpoint: 'https://ai.api.cloud.yandex.net/v1', apiKey: 'key', model: 'aliceai-llm-flash', folderId: 'folder' },
      [{ role: 'user', content: 'Открой приложение' }],
      [{ type: 'function', function: { name: 'open_app', description: 'Open app', parameters: { type: 'object', properties: { packageName: { type: 'string' } }, required: ['packageName'] } } }],
    );
    expect(result.toolCalls).toEqual([expect.objectContaining({ tool: 'open_app', arguments: { packageName: 'com.example' }, requestId: 'call_1' })]);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('https://ai.api.cloud.yandex.net/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Api-Key key' });
    expect(JSON.parse(String((init as RequestInit).body)).model).toBe('gpt://folder/aliceai-llm-flash');
  });

  it('fails closed on malformed tool arguments', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'open_app', arguments: '[]' } }] } }] }), { status: 200 }));
    await expect(nativeToolCall(
      { id: 'yandex', name: 'Yandex AI Studio', endpoint: 'https://ai.api.cloud.yandex.net/v1', apiKey: 'key', model: 'aliceai-llm-flash', folderId: 'folder' },
      [{ role: 'user', content: 'Открой приложение' }], [],
    )).rejects.toThrow('invalid arguments');
  });
});
