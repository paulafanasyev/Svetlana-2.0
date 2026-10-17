// «Сервисы»: подключение GitHub, Vercel, Timeweb Cloud, Yandex Cloud, Beget, REG.RU, Selectel, Supabase, Linear, Stripe, Sentry, Neon, Context7 и Hugging Face по токену.
// Токен уходит в зашифрованное хранилище и обратно в интерфейс не показывается.
// Каждый вызов сервиса из чата Светлана выполняет только после подтверждения на экране
// (кроме просмотра в Vercel, если пользователь сам разрешил его галочкой).
// Список инструментов показывается только после того, как сервис в этом сеансе заново ответил по токену.
import { useEffect, useId, useState } from 'react';
import { Plug, ExternalLink, RefreshCw, Trash2, Loader2, X, Key, Eye, EyeOff } from 'lucide-react';
import { mcpManager, type ServerStatus } from '../services/mcp/McpManager';
import { McpError } from '../services/mcp/McpClient';
import { secretStorageMode } from '../services/security/SecretStore';
import { appPlatform } from '../platform';

export const MCP_WEB_NOTE = 'На сайте часть сервисов может не пустить браузер (CORS). В приложениях для Windows и Android такого ограничения меньше.';

function ServerCard({ s }: { s: ServerStatus }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [replace, setReplace] = useState(false);
  const listId = useId();
  // У сервисов с логином и паролем (Beget, REG.RU, Selectel) вместо «токена» говорим «данные для входа».
  const creds = !!s.server.tokenLabel;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) {
      // Показываем только свои понятные тексты (без токена); всё остальное — общей фразой.
      setMsg({ ok: false, text: e instanceof McpError ? e.message : 'Не получилось. Проверьте токен и интернет и попробуйте ещё раз.' });
    } finally { setBusy(false); }
  };
  const connect = () => run(async () => { const n = await mcpManager.connect(s.server.id, token); setToken(''); setReplace(false); return `Подключено, инструментов: ${n}`; });
  const refresh = () => run(async () => `Обновлено, инструментов: ${await mcpManager.refresh(s.server.id)}`);
  const remove = () => { setConfirmRemove(false); return run(async () => { await mcpManager.disconnect(s.server.id); return creds ? 'Отключено, данные доступа удалены' : 'Отключено, токен удалён'; }); };
  const onCount = s.tools.filter(t => t.on).length;

  return (
    <div data-testid={`mcp-${s.server.id}`} className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{s.server.name}</h4>
          <p className="text-xs text-sv-muted">{s.server.description}</p>
        </div>
        {s.connected && (
          <label className="flex items-center gap-1.5 text-xs shrink-0">
            <input type="checkbox" checked={s.enabled} onChange={e => { void mcpManager.setServerEnabled(s.server.id, e.target.checked); }} aria-label={`Включить ${s.server.name}`} />
            {s.enabled ? 'включён' : 'выключен'}
          </label>
        )}
      </div>

      {(!s.connected || replace) && (
        <>
          <div className="flex gap-2">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="off"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={s.server.tokenLabel ?? (s.server.tokenRequired ? 'токен' : 'токен (необязательно)')}
              aria-label={creds ? `Данные для входа в API ${s.server.name} в формате ${s.server.tokenLabel}` : `Токен ${s.server.name}`}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-indigo-500/50"
            />
            <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? (creds ? 'Скрыть данные доступа' : 'Скрыть токен') : (creds ? 'Показать данные доступа' : 'Показать токен')} title={show ? (creds ? 'Скрыть данные доступа' : 'Скрыть токен') : (creds ? 'Показать данные доступа' : 'Показать токен')} className="p-2 rounded-lg bg-white/5 hover:bg-white/10">
              {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={connect}
              disabled={busy || (s.server.tokenRequired && !token.trim())}
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />} Подключить
            </button>
          </div>
          <p className="text-xs text-sv-muted flex items-start gap-1">
            <Key className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{s.server.tokenHint} <a href={s.server.tokenUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline inline-flex items-center gap-0.5">{creds ? 'Как настроить API' : 'Как получить токен'} <ExternalLink className="w-3 h-3" /></a></span>
          </p>
        </>
      )}

      {s.connected && s.enabled && !s.verified && (
        <p role={s.error ? 'alert' : 'status'} aria-live={s.error ? 'assertive' : 'polite'} className={`text-xs ${s.error ? 'text-red-400' : 'text-sv-muted'}`}>
          {s.error
            ? `Не удалось проверить подключение. ${s.error}${/Сменить токен|Сменить данные|Обновить|Подключить/.test(s.error) ? '' : ' Нажмите «Обновить», чтобы попробовать снова.'}`
            : 'Проверяю подключение…'}
        </p>
      )}

      {s.connected && (
        <div className="flex flex-wrap items-center gap-2">
          {s.verified && <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={listId} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs">
            Инструменты: {onCount} из {s.tools.length}
          </button>}
          {s.verified && s.canAutoRead && (
            <label className="flex items-center gap-1.5 text-xs" title="Просмотр проектов, деплоев, логов и доменов выполняется без окна подтверждения. Голосовые команды подтверждаются всегда.">
              <input type="checkbox" checked={s.autoRead} onChange={e => mcpManager.setAutoRead(s.server.id, e.target.checked)} aria-label={`Чтение без подтверждения: ${s.server.name}`} />
              чтение без подтверждения
            </label>
          )}
          <button onClick={refresh} disabled={busy} title="Обновить список" aria-label={`Обновить ${s.server.name}`} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setReplace(!replace)} aria-expanded={replace} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs">
            {replace ? 'Отмена' : creds ? 'Сменить данные для входа' : 'Сменить токен'}
          </button>
          {!confirmRemove ? (
            <button onClick={() => setConfirmRemove(true)} disabled={busy} title={creds ? 'Отключить и удалить данные доступа' : 'Отключить и удалить токен'} aria-label={`Отключить ${s.server.name}`} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs" role="group" aria-label="Подтвердите отключение">
              {creds ? 'Удалить данные доступа?' : 'Удалить токен?'}
              <button onClick={remove} disabled={busy} className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white">Да, отключить</button>
              <button onClick={() => setConfirmRemove(false)} className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20">Нет</button>
            </span>
          )}
        </div>
      )}

      {s.connected && s.verified && open && (
        <ul id={listId} className="max-h-60 overflow-y-auto space-y-1 pr-1">
          {s.tools.map(t => (
            <li key={t.id} className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={t.on} onChange={e => mcpManager.setToolEnabled(s.server.id, t.def.name, e.target.checked)} aria-label={t.def.title || t.def.name} className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium">{t.def.title || t.def.name}</span>
                <span className={`ml-1.5 px-1.5 rounded ${t.def.readOnly ? 'bg-emerald-500/10 text-emerald-300' : 'bg-yellow-500/10 text-yellow-300'}`}>{t.def.readOnly ? 'чтение' : 'изменяет'}</span>
                {t.def.description && <span className="block text-sv-muted truncate">{t.def.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {msg && <p role={msg.ok ? 'status' : 'alert'} aria-live={msg.ok ? 'polite' : 'assertive'} className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
    </div>
  );
}

export default function McpPanel({ onClose }: { onClose?: () => void }) {
  const [list, setList] = useState<ServerStatus[]>(() => mcpManager.status());
  const [storageMode, setStorageMode] = useState<'encrypted' | 'memory' | null>(null);
  useEffect(() => mcpManager.subscribe(() => setList(mcpManager.status())), []);
  useEffect(() => { let alive = true; secretStorageMode().then(m => { if (alive) setStorageMode(m); }).catch(() => {}); return () => { alive = false; }; }, []);
  const web = appPlatform() === 'web';

  return (
    <div data-testid="mcp-panel" className="glass-card rounded-xl p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2"><Plug className="w-5 h-5 text-indigo-300" aria-hidden="true" />Сервисы</h3>
        {onClose && (
          <button onClick={onClose} aria-label="Закрыть сервисы" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted"><X className="w-4 h-4" /></button>
        )}
      </div>
      <p className="text-sm text-sv-muted">
        Подключите сервис, и Светлана сможет работать с ним из чата: «разверни мой сайт на Timeweb», «покажи открытые задачи в GitHub», «почему упал последний деплой».
      </p>
      <ol className="text-sm text-sv-muted list-decimal pl-5 space-y-0.5">
        <li>Откройте ссылку под нужным сервисом: «Как получить токен» для сервисов с токеном (создайте его с минимальными правами и сроком), «Как настроить API» для Beget, REG.RU и Selectel. Для Beget включите доступ к API и задайте отдельный пароль API. Для REG.RU в «Настройках API» задайте альтернативный пароль API и добавьте свой внешний IP-адрес. Для Selectel в панели откройте «Управление доступом» → «Сервисные пользователи» → «Добавить», задайте имя и пароль и добавьте пользователя в нужный проект (для DNS достаточно роли «DNS»), затем скопируйте номер аккаунта и имя проекта.</li>
        <li>Для сервисов с токеном скопируйте токен, вставьте его в поле и нажмите «Подключить». Для Beget и REG.RU вставьте логин и пароль API через двоеточие: логин:пароль. Для Selectel: номер_аккаунта:проект:пользователь:пароль, например 123456:my-project:svetlana:пароль.</li>
        <li>Пишите Светлане в чат. Каждое действие она покажет вам на подтверждение, изменения помечены ⚠️. Без окна может идти только просмотр в Vercel, если вы включите там галочку «чтение без подтверждения».</li>
      </ol>
      <p className="text-xs text-sv-muted">
        {storageMode === null
          ? 'Проверяю защищённое хранилище…'
          : storageMode === 'memory'
          ? 'Защищённое хранилище на этом устройстве недоступно: токены и пароли API хранятся только до закрытия приложения, потом их нужно вставить снова.'
          : 'Токены и пароли API хранятся зашифрованно на этом устройстве и повторно не показываются.'}
      </p>
      {web && <p data-testid="mcp-web-note" className="text-xs text-yellow-300">{MCP_WEB_NOTE}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map(s => <ServerCard key={s.server.id} s={s} />)}
      </div>
    </div>
  );
}
