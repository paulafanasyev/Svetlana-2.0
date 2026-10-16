// Единая политика безопасности контента (CSP) для веб-сборки и Windows (Tauri).
// Разрешены только нужные адреса: облачные ИИ, внешние сервисы (MCP), распознавание речи, DaData, ФНС, личный кабинет,
// локальные модели и мост с телефоном.
// Любой другой адрес (в т.ч. подменённый «свой» сервер ИИ) браузер заблокирует. Картинки — только свои (без внешних ссылок-маячков).
// Мост с телефоном: только http на порт 8080 (протокол v2 сам шифрует и подписывает каждый запрос).
// CSP не умеет выразить «только домашняя сеть», поэтому адрес дополнительно проверяет BridgeCrypto.validateBridgeEndpoint
// (10.x, 172.16–31.x, 192.168.x). WebSocket и порт 8443 в локальной сети больше не разрешены.
export const CLOUD_ORIGINS = [
  'https://api.openai.com', 'https://api.anthropic.com', 'https://api.groq.com', 'https://openrouter.ai',
  'https://api.deepseek.com', 'https://generativelanguage.googleapis.com', 'https://api.mistral.ai',
  // Шлюзы к многим моделям с одним ключом: AnyModel и OpenCode Zen.
  'https://anymodel.org', 'https://opencode.ai',
  // Внешние сервисы (src/services/mcp/McpCatalog.ts): GitHub MCP, Vercel API, Supabase, Linear, Stripe, Sentry, Neon, Context7, Hugging Face,
  // Timeweb Cloud, Yandex Cloud, Beget.
  'https://api.githubcopilot.com', 'https://api.vercel.com', 'https://mcp.supabase.com', 'https://mcp.linear.app',
  'https://mcp.stripe.com', 'https://mcp.sentry.dev', 'https://mcp.neon.tech', 'https://mcp.context7.com', 'https://huggingface.co',
  // Российские облака и хостинг: Timeweb Cloud MCP, Yandex Cloud Toolkit MCP, Beget API.
  'https://api.timeweb.cloud', 'https://toolkit.mcp.cloud.yandex.net', 'https://api.beget.com',
  'https://suggestions.dadata.ru', 'https://statusnpd.nalog.ru',
  // Личный кабинет «Мир Самозанятых» (мир-самозанятых.рф и резервный API).
  'https://xn----8sba1acxdkgqms3b9euc.xn--p1ai', 'https://mir-samozanyatykh-api-frankfurt.onrender.com',
];
// Локальные модели (Ollama, LM Studio, llama.cpp, vLLM), Windows MCP на этом ПК и мост Svetlana-home (порт 8080 в домашней сети).
export const LOCAL_ORIGINS = [
  'http://127.0.0.1:*', 'http://localhost:*', 'ws://127.0.0.1:*', 'ws://localhost:*',
  'http://*:8080',
];

export function buildCsp({ desktop = false } = {}) {
  const connect = ["'self'", ...(desktop ? ['ipc:', 'http://ipc.localhost'] : []), ...CLOUD_ORIGINS, ...LOCAL_ORIGINS];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self'",
    `connect-src ${connect.join(' ')}`,
  ].join('; ');
}
