import type { ChatMessage, AIResponse, StructuredToolCall } from './AIGateway';

export interface YandexAIProviderConfig {
  apiKey: string;
  folderId: string;
  model?: 'aliceai-llm' | 'aliceai-llm-flash';
  endpoint?: string;
}

type YandexTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
};

/** Alice AI is an optional provider; Svetlana remains the user-facing assistant. */
export async function yandexNativeToolCall(
  provider: YandexAIProviderConfig,
  messages: ChatMessage[],
  tools: YandexTool[],
  options?: { temperature?: number; max_tokens?: number },
): Promise<AIResponse> {
  if (!provider.apiKey) throw new Error('Yandex API key is required');
  if (!provider.folderId) throw new Error('Yandex folder ID is required');

  const endpoint = (provider.endpoint || 'https://ai.api.cloud.yandex.net/v1').replace(/\/$/, '');
  const modelName = provider.model || 'aliceai-llm-flash';
  const model = `gpt://${provider.folderId}/${modelName}`;

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.max_tokens ?? 2048,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Yandex AI Studio API error: ${data.error?.message || response.statusText || response.status}`);
  }

  const message = data.choices?.[0]?.message || {};
  const toolCalls: StructuredToolCall[] = (message.tool_calls || []).map((call: any) => {
    const rawArguments = call.function?.arguments;
    const args = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments;
    if (!call.function?.name || !args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('Yandex returned an invalid structured tool call');
    }
    return {
      tool: call.function.name,
      arguments: args,
      requestId: call.id || `yandex_${Date.now()}`,
      timestamp: Date.now(),
    };
  });

  return {
    content: message.content || '',
    provider: 'Yandex AI Studio',
    model,
    toolCalls,
    usage: data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens || 0,
          completion_tokens: data.usage.completion_tokens || 0,
          total_tokens: data.usage.total_tokens || 0,
        }
      : undefined,
  };
}
