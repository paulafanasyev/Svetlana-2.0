// Каталог внешних сервисов (MCP и Vercel API), к которым Светлана может подключиться по токену.
// Адреса зашиты в код и совпадают с официальной документацией каждого сервиса: подменить сервер
// нельзя ни из модели, ни из настроек. Те же адреса разрешены в CSP (csp.mjs и tauri.conf.json).
// Сервисы, которые пускают только по OAuth для одобренных приложений (Notion, Cloudflare,
// официальный Vercel MCP), подключить токеном нельзя; Vercel работает напрямую через его API.

export type McpAuth = 'bearer' | 'sentry-bearer';

export interface McpServerInfo {
  id: string;
  name: string;
  /** mcp — настоящий MCP-сервер (Streamable HTTP); rest — встроенный набор инструментов поверх API сервиса. */
  kind: 'mcp' | 'rest';
  url: string;
  auth: McpAuth;
  tokenRequired: boolean;
  tokenUrl: string;
  tokenHint: string;
  description: string;
}

export const MCP_SERVERS: readonly McpServerInfo[] = Object.freeze([
  {
    id: 'github', name: 'GitHub', kind: 'mcp', url: 'https://api.githubcopilot.com/mcp/', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://github.com/settings/personal-access-tokens/new',
    tokenHint: 'Fine-grained токен (github_pat_…). Дайте доступ только к нужным репозиториям.',
    description: 'Репозитории, issues, pull requests, Actions, поиск по коду.',
  },
  {
    id: 'vercel', name: 'Vercel', kind: 'rest', url: 'https://api.vercel.com', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://vercel.com/account/settings/tokens',
    tokenHint: 'Токен Vercel. Официальный Vercel MCP пускает только по OAuth, поэтому Светлана работает через API Vercel.',
    description: 'Проекты, деплои, логи сборки, домены (только чтение).',
  },
  {
    id: 'supabase', name: 'Supabase', kind: 'mcp', url: 'https://mcp.supabase.com/mcp', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://supabase.com/dashboard/account/tokens',
    tokenHint: 'Personal access token (sbp_…). Лучше с ограниченными правами.',
    description: 'Проекты, таблицы, SQL, миграции, edge functions, логи.',
  },
  {
    id: 'linear', name: 'Linear', kind: 'mcp', url: 'https://mcp.linear.app/mcp', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://linear.app/settings/account/security',
    tokenHint: 'Personal API key (lin_api_…). Для безопасности можно ключ только с правом Read.',
    description: 'Задачи, проекты, циклы, комментарии.',
  },
  {
    id: 'stripe', name: 'Stripe', kind: 'mcp', url: 'https://mcp.stripe.com', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://dashboard.stripe.com/apikeys',
    tokenHint: 'Ограниченный ключ (rk_…) или ключ агента. Начните с тестового режима.',
    description: 'Клиенты, платежи, счета, подписки, ссылки на оплату.',
  },
  {
    id: 'sentry', name: 'Sentry', kind: 'mcp', url: 'https://mcp.sentry.dev/mcp', auth: 'sentry-bearer', tokenRequired: true,
    tokenUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    tokenHint: 'User auth token Sentry.',
    description: 'Ошибки, issues, релизы, производительность.',
  },
  {
    id: 'neon', name: 'Neon', kind: 'mcp', url: 'https://mcp.neon.tech/mcp', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://console.neon.tech/app/settings/api-keys',
    tokenHint: 'API key Neon.',
    description: 'Postgres: проекты, ветки, SQL-запросы, схема.',
  },
  {
    id: 'context7', name: 'Context7', kind: 'mcp', url: 'https://mcp.context7.com/mcp', auth: 'bearer', tokenRequired: false,
    tokenUrl: 'https://context7.com/dashboard',
    tokenHint: 'Ключ не обязателен: без него тоже работает, с ним больше запросов.',
    description: 'Свежая документация любых библиотек и фреймворков.',
  },
  {
    id: 'huggingface', name: 'Hugging Face', kind: 'mcp', url: 'https://huggingface.co/mcp', auth: 'bearer', tokenRequired: false,
    tokenUrl: 'https://huggingface.co/settings/tokens',
    tokenHint: 'Токен (hf_…) с правом Read. Без токена доступен только поиск.',
    description: 'Поиск моделей, датасетов, статей и Spaces.',
  },
].map(s => Object.freeze(s)) as McpServerInfo[]);

/** Источники (origin) всех сервисов: ровно они добавлены в CSP. */
export const MCP_ORIGINS: readonly string[] = Object.freeze(Array.from(new Set(MCP_SERVERS.map(s => new URL(s.url).origin))));

export function mcpServer(id: string): McpServerInfo | undefined {
  return MCP_SERVERS.find(s => s.id === id);
}

/** Точный адрес сервера из каталога (никакие другие адреса клиент не вызывает). */
export function isCatalogUrl(url: string): boolean {
  return MCP_SERVERS.some(s => s.url === url);
}

/** Заголовок Authorization для сервиса. Пустой токен — без заголовка (для сервисов, где он необязателен). */
export function authHeader(server: McpServerInfo, token: string | null | undefined): string | null {
  const t = (token ?? '').trim();
  if (!t) return null;
  if (!/^[\x21-\x7e]{1,4096}$/.test(t)) throw new Error('Токен содержит недопустимые символы (пробелы, кириллицу или переносы строк)');
  return server.auth === 'sentry-bearer' ? `Sentry-Bearer ${t}` : `Bearer ${t}`;
}
