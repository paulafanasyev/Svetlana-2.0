// «Сервисы (MCP)»: подключение GitHub, Vercel, Timeweb Cloud, Yandex Cloud, Supabase, Linear, Stripe, Sentry, Neon, Context7 и Hugging Face по токену.
// Токен уходит в зашифрованное хранилище и обратно в интерфейс не показывается.
// Изменения из чата Светлана выполняет только после подтверждения на экране.
import { useEffect, useState } from 'react';
import { Plug, ExternalLink, RefreshCw, Trash2, Loader2, X, Key } from 'lucide-react';
import { mcpManager, type ServerStatus } from '../services/mcp/McpManager';
import { appPlatform } from '../platform';

export const MCP_WEB_NOTE = 'На сайте часть сервисов может не пустить браузер (CORS). В приложениях для Windows и Android такого ограничения меньше.';

function ServerCard({ s }: { s: ServerStatus }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e: any) { setMsg({ ok: false, text: e?.message || 'Не получилось' }); } finally { setBusy(false); }
  };
  const connect = () => run(async () => { const n = await mcpManager.connect(s.server.id, token); setToken(''); return `Подключено, инструментов: ${n}`; });
  const refresh = () => run(async () => `Обновлено, инструментов: ${await mcpManager.refresh(s.server.id)}`);
  const remove = () => run(async () => { await mcpManager.disconnect(s.server.id); return 'Отключено, токен удалён'; });
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
            <input type="checkbox" checked={s.enabled} onChange={e => mcpManager.setServerEnabled(s.server.id, e.target.checked)} aria-label={`Включить ${s.server.name}`} />
            {s.enabled ? 'вкл' : 'выкл'}
          </label>
        )}
      </div>

      {!s.connected && (
        <>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={s.server.tokenRequired ? 'токен' : 'токен (необязательно)'}
              aria-label={`Токен ${s.server.name}`}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-indigo-500/50"
            />
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
            <span>{s.server.tokenHint} <a href={s.server.tokenUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline inline-flex items-center gap-0.5">Где взять <ExternalLink className="w-3 h-3" /></a></span>
          </p>
        </>
      )}

      {s.connected && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setOpen(!open)} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs">
            Инструменты: {onCount} из {s.tools.length}
          </button>
          <label className="flex items-center gap-1.5 text-xs" title="Инструменты, которые сервис пометил «только чтение», выполняются без окна подтверждения. Изменения и голосовые команды подтверждаются всегда.">
            <input type="checkbox" checked={s.autoRead} onChange={e => mcpManager.setAutoRead(s.server.id, e.target.checked)} aria-label={`Чтение без подтверждения: ${s.server.name}`} />
            чтение без подтверждения
          </label>
          <button onClick={refresh} disabled={busy} title="Обновить список" aria-label={`Обновить ${s.server.name}`} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <button onClick={remove} disabled={busy} title="Отключить и удалить токен" aria-label={`Отключить ${s.server.name}`} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 disabled:opacity-50">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {s.connected && open && (
        <ul className="max-h-60 overflow-y-auto space-y-1 pr-1">
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

      {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
    </div>
  );
}

export default function McpPanel({ onClose }: { onClose?: () => void }) {
  const [list, setList] = useState<ServerStatus[]>(() => mcpManager.status());
  useEffect(() => mcpManager.subscribe(() => setList(mcpManager.status())), []);
  const web = appPlatform() === 'web';

  return (
    <div data-testid="mcp-panel" className="glass-card rounded-xl p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2"><Plug className="w-5 h-5 text-indigo-300" />Сервисы (MCP)</h3>
        {onClose && (
          <button onClick={onClose} aria-label="Закрыть" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted"><X className="w-4 h-4" /></button>
        )}
      </div>
      <p className="text-sm text-sv-muted">
        Подключите сервис токеном, и Светлана сможет работать с ним из чата: «покажи открытые issues в моём репозитории», «разверни сайт на Timeweb». Вызовы вы подтверждаете на экране (изменения помечены ⚠️). Без подтверждения идут только справочные шаги: поиск операций Timeweb и документация Context7, а чтение можно разрешить галочкой.
      </p>
      {web && <p data-testid="mcp-web-note" className="text-xs text-yellow-300">{MCP_WEB_NOTE}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map(s => <ServerCard key={s.server.id} s={s} />)}
      </div>
    </div>
  );
}
