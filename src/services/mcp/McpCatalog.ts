// Каталог внешних сервисов (MCP и Vercel API), к которым Светлана может подключиться по токену.
// Адреса зашиты в код и совпадают с официальной документацией каждого сервиса: подменить сервер
// нельзя ни из модели, ни из настроек. Те же адреса разрешены в CSP (csp.mjs и tauri.conf.json).
// Российские облака: Timeweb Cloud и Yandex Cloud (официальные удалённые MCP). У Beget удалённого MCP нет,
// поэтому он работает через встроенный набор запросов к Beget API (BegetTools.ts); REG.RU так же, через Рег.API 2
// (RegruTools.ts). Selectel пока не подключён.
// Сервисы, которые пускают только по OAuth для одобренных приложений (Notion, Cloudflare,
// официальный Vercel MCP), подключить токеном нельзя; Vercel работает напрямую через его API.

export type McpAuth = 'bearer' | 'sentry-bearer';

export interface McpServerInfo {
  id: string;
  name: string;
  /** mcp — настоящий MCP-сервер (Streamable HTTP); rest — встроенный набор инструментов поверх API сервиса. */
  kind: 'mcp' | 'rest';
  /** Подсказка в поле ввода, если там не просто токен (например, «логин:пароль API»). */
  tokenLabel?: string;
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
    tokenHint: 'GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token. Срок: 30–90 дней, Repository access: только нужные репозитории, права: Contents, Issues, Pull requests (Read, а для изменений Read and write). Токен начинается с github_pat_.',
    description: 'Репозитории, issues, pull requests, Actions, поиск по коду.',
  },
  {
    id: 'vercel', name: 'Vercel', kind: 'rest', url: 'https://api.vercel.com', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://vercel.com/account/settings/tokens',
    tokenHint: 'Vercel → Account Settings → Tokens → Create. Выберите срок и нужную команду (Scope), скопируйте токен.',
    description: 'Только просмотр: проекты, деплои, логи сборки, домены. Запускать или менять деплой через Vercel Светлана не может.',
  },
  {
    id: 'timeweb', name: 'Timeweb Cloud', kind: 'mcp', url: 'https://api.timeweb.cloud/api/v1/mcp/search', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://timeweb.cloud/my/api-keys',
    tokenHint: 'Панель Timeweb Cloud → «API и Terraform» → «Создать токен». Укажите срок и только нужные права. Полный токен позволяет создавать платные ресурсы (каждое такое действие Светлана покажет вам на подтверждение).',
    description: 'Российское облако: серверы, App Platform (деплой сайтов из Git), базы, Kubernetes, S3, домены.',
  },
  {
    id: 'yandex', name: 'Yandex Cloud', kind: 'mcp', url: 'https://toolkit.mcp.cloud.yandex.net/mcp', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://yandex.cloud/ru/docs/iam/operations/iam-token/create',
    tokenHint: 'Нужен IAM-токен: его выдаёт программа yc (команда yc iam create-token) на компьютере, где она установлена и настроена. Токен действует до 12 часов, потом вставьте новый. Если yc у вас нет, откройте инструкцию по ссылке или попросите специалиста.',
    description: 'Деплой простых приложений: Compute (ВМ), сети, IAM, Object Storage (S3), YDB.',
  },
  {
    id: 'beget', name: 'Beget', kind: 'rest', url: 'https://api.beget.com/api', auth: 'bearer', tokenRequired: true,
    tokenLabel: 'логин:пароль API',
    tokenUrl: 'https://beget.com/ru/kb/api/obshhij-princzip-raboty-s-api',
    tokenHint: 'Панель Beget → «Настройки» → «Доступ к API»: включите доступ и задайте отдельный пароль для API (не пароль входа). Вставьте логин и этот пароль через двоеточие: mylogin:пароль. Если в панели включён доступ только с определённых IP, добавьте туда свой адрес.',
    description: 'Российский хостинг: сайты, домены, DNS-записи, привязка домена к сайту. Файлы сайта через API Beget не загружаются.',
  },
  {
    id: 'regru', name: 'REG.RU', kind: 'rest', url: 'https://api.reg.ru/api/regru2', auth: 'bearer', tokenRequired: true,
    tokenLabel: 'логин:пароль API',
    tokenUrl: 'https://help.reg.ru/support/partneram/reg-api/',
    tokenHint: 'Личный кабинет REG.RU → «Настройки API»: задайте альтернативный пароль для API и добавьте свой внешний IP-адрес в список разрешённых (без этого REG.RU отклонит запросы; если провайдер меняет IP, адрес придётся обновлять). Вставьте логин и пароль API через двоеточие: mylogin:пароль.',
    description: 'Российский регистратор: домены, баланс, DNS-серверы, добавление и удаление DNS-записей (по одной, остальные не меняются).',
  },
  {
    id: 'supabase', name: 'Supabase', kind: 'mcp', url: 'https://mcp.supabase.com/mcp', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://supabase.com/dashboard/account/tokens',
    tokenHint: 'Supabase → Account → Access Tokens → Generate new token. Токен начинается с sbp_.',
    description: 'Проекты, таблицы, SQL, миграции, edge functions, логи.',
  },
  {
    id: 'linear', name: 'Linear', kind: 'mcp', url: 'https://mcp.linear.app/mcp', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://linear.app/settings/account/security',
    tokenHint: 'Linear → Settings → Security & access → Personal API keys → New key. Для безопасности можно выдать только право Read. Ключ начинается с lin_api_.',
    description: 'Задачи, проекты, циклы, комментарии.',
  },
  {
    id: 'stripe', name: 'Stripe', kind: 'mcp', url: 'https://mcp.stripe.com', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://dashboard.stripe.com/apikeys',
    tokenHint: 'Stripe → Developers → API keys → Create restricted key (начинается с rk_). Начните с тестового режима (Test mode), права выдайте только нужные.',
    description: 'Клиенты, платежи, счета, подписки, ссылки на оплату.',
  },
  {
    id: 'sentry', name: 'Sentry', kind: 'mcp', url: 'https://mcp.sentry.dev/mcp', auth: 'sentry-bearer', tokenRequired: true,
    tokenUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    tokenHint: 'Sentry → Settings → Account → Personal Tokens → Create New Token. Достаточно прав на чтение (Read).',
    description: 'Ошибки, issues, релизы, производительность.',
  },
  {
    id: 'neon', name: 'Neon', kind: 'mcp', url: 'https://mcp.neon.tech/mcp', auth: 'bearer', tokenRequired: true,
    tokenUrl: 'https://console.neon.tech/app/settings/api-keys',
    tokenHint: 'Neon Console → Account settings → API keys → Create new API key.',
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
