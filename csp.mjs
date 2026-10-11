// Единая политика безопасности контента (CSP) для веб-сборки и Windows (Tauri).
// Разрешены только нужные адреса: облачные ИИ, распознавание речи, DaData, ФНС, локальные модели и мост с телефоном.
// Любой другой адрес (в т.ч. подменённый «свой» сервер ИИ) браузер заблокирует. Картинки — только свои (без внешних ссылок-маячков).
// Порты 8080/8443 в локальной сети нужны мосту с телефоном (адрес вводит пользователь); их сузим после защищённого сопряжения.
export const CLOUD_ORIGINS = [
  'https://api.openai.com', 'https://api.anthropic.com', 'https://api.groq.com', 'https://openrouter.ai',
  'https://api.deepseek.com', 'https://generativelanguage.googleapis.com', 'https://api.mistral.ai',
  'https://suggestions.dadata.ru', 'https://statusnpd.nalog.ru',
];
// Локальные модели (Ollama, LM Studio, llama.cpp, vLLM), Windows MCP и мост Svetlana-home (порт 8080 в домашней сети).
export const LOCAL_ORIGINS = [
  'http://127.0.0.1:*', 'http://localhost:*', 'ws://127.0.0.1:*', 'ws://localhost:*',
  'http://*:8080', 'ws://*:8080', 'https://*:8443', 'wss://*:8443',
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
