import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, LogIn, LogOut, UserPlus, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  boundWorkspaceOwnerId,
  clearLocalWorkspaceAndBinding,
  cloudSyncConfigured,
  enableAndSyncWorkspace,
  getCloudClient,
  signInCloud,
  signOutCloud,
  signUpCloud,
  syncBoundWorkspace,
  type SyncResult,
} from '../services/CloudWorkspaceSync';

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Операция не выполнена.';
}
function isSafeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;
}

export default function CloudSyncPanel({ onSynced }: { onSynced?: () => void }) {
  const configured = cloudSyncConfigured();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boundId, setBoundId] = useState<string | null>(() => boundWorkspaceOwnerId());
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const syncLock = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    if (!configured) return;
    const supabase = getCloudClient();
    if (!supabase) return;
    let live = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (live) setUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null);
    }).catch(() => { if (live) setUser(null); });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (live) {
        setUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
        setMessage(null);
        setError(null);
        setBoundId(boundWorkspaceOwnerId());
      }
    });
    return () => {
      live = false;
      authListener.subscription.unsubscribe();
    };
  }, [configured]);

  const runSync = useCallback(async (firstBinding: boolean) => {
    if (!user || syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = firstBinding ? await enableAndSyncWorkspace(user.id) : await syncBoundWorkspace();
      setLastSync(result);
      setBoundId(boundWorkspaceOwnerId());
      setMessage('Синхронизация завершена: агентов — ' + result.agents + ', диалогов — ' + result.threads + ', записей памяти — ' + result.memories + '.');
      onSyncedRef.current?.();
    } catch (e) {
      setError(safeError(e));
      setBoundId(boundWorkspaceOwnerId());
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [user]);

  // Once this device is bound to the signed-in account, pull/merge on entry and periodically
  // while the workspace is open. A new account is never bound silently.
  useEffect(() => {
    if (!user || boundId !== user.id) return;
    void runSync(false);
    const interval = window.setInterval(() => { void runSync(false); }, 60_000);
    return () => window.clearInterval(interval);
  }, [user?.id, boundId, runSync]);

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!isSafeEmail(email)) { setError('Введите корректный адрес электронной почты.'); return; }
    if (password.length < 10) { setError('Пароль должен содержать не менее 10 символов.'); return; }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (registerMode) {
        const result = await signUpCloud(email, password);
        setPassword('');
        if (result.needsEmailConfirmation) {
          setMessage('Аккаунт создан. Подтвердите адрес по письму в настройках Supabase, затем войдите здесь.');
        } else {
          setMessage('Аккаунт создан. Теперь отдельно подтвердите привязку и загрузку локальных данных в облако.');
        }
      } else {
        await signInCloud(email, password);
        setPassword('');
        setMessage('Вход выполнен. Проверьте привязку устройства перед первой синхронизацией.');
      }
    } catch (e) {
      setError(safeError(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectAndClear = async () => {
    if (!window.confirm('Удалить ВСЕ локальные диалоги, агентов и заметки с этого устройства, отменить его привязку и выйти? Уже загруженная облачная копия аккаунта останется на сервере. Перед продолжением экспортируйте нужные данные.')) return;
    setBusy(true);
    setError(null);
    try {
      await clearLocalWorkspaceAndBinding();
      setBoundId(null);
      setLastSync(null);
      setUser(null);
      setMessage('Локальная копия удалена, устройство отвязано. Облачные данные аккаунта не удалялись.');
      onSyncedRef.current?.();
    } catch (e) { setError(safeError(e)); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOutCloud();
      setUser(null);
      setMessage('Вы вышли из облачного аккаунта. Локальные данные не удалены, устройство остаётся привязанным к прежнему аккаунту.');
    } catch (e) { setError(safeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4 sm:p-5 space-y-4" aria-labelledby="cloud-sync-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cloud-sync-title" className="text-lg font-semibold flex items-center gap-2"><Cloud size={19} className="text-cyan-300"/> Облачная синхронизация</h2>
          <p className="text-xs text-sv-muted mt-1">Перенос агентов, истории и памяти между устройствами с проверкой аккаунта и серверными правами доступа.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs text-sv-muted">
          {configured ? <Cloud size={14}/> : <CloudOff size={14}/>}
          {configured ? 'Supabase настроен' : 'Требует настройки'}
        </span>
      </div>

      {!configured ? (
        <div className="space-y-3 text-sm">
          <p className="text-sv-muted">Синхронизация отключена, пока владелец проекта не настроит backend. Секретный service-role ключ в клиентское приложение добавлять нельзя.</p>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-sv-muted">
            <li>Создать/выбрать Supabase-проект и включить Email/Password Authentication.</li>
            <li>Применить миграцию `supabase/migrations/20261023060000_svetlana_personal_workspace_sync.sql`.</li>
            <li>В окружение веб-сборки добавить `VITE_SUPABASE_URL` и публичный `VITE_SUPABASE_ANON_KEY`, затем пересобрать и развернуть приложение.</li>
          </ol>
        </div>
      ) : !user ? (
        <form onSubmit={submitAuth} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm sm:col-span-2">Электронная почта
            <input type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} required className="mt-1 w-full min-h-11 rounded-lg bg-black/10 border border-white/10 px-3 py-2.5" placeholder="name@example.com"/>
          </label>
          <label className="text-sm sm:col-span-2">Пароль
            <input type="password" autoComplete={registerMode ? 'new-password' : 'current-password'} minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required className="mt-1 w-full min-h-11 rounded-lg bg-black/10 border border-white/10 px-3 py-2.5" placeholder="Не менее 10 символов"/>
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button disabled={busy} type="submit" className="inline-flex items-center gap-2 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm text-white disabled:opacity-50">{registerMode ? <UserPlus size={16}/> : <LogIn size={16}/>} {busy ? 'Подождите…' : registerMode ? 'Создать аккаунт' : 'Войти'}</button>
            <button type="button" disabled={busy} onClick={() => { setRegisterMode(v => !v); setError(null); setMessage(null); }} className="min-h-11 rounded-lg border border-white/10 px-3 text-xs text-sv-muted">{registerMode ? 'Уже есть аккаунт' : 'Создать аккаунт'}</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3 flex items-start gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-300 shrink-0 mt-0.5"/>
            <div className="min-w-0 text-sm">
              <p className="font-medium break-words">{user.email || 'Вход выполнен'}</p>
              <p className="text-xs text-sv-muted mt-1">Облачные записи принадлежат этому аккаунту. В сервере включена проверка владельца; прямой доступ к чужим рабочим данным запрещён политиками RLS.</p>
            </div>
          </div>
          {boundId && boundId !== user.id ? (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 space-y-2">
              <p className="text-sm text-red-200">Локальная копия привязана к другому аккаунту. Синхронизация блокируется, чтобы не смешать персональные данные.</p>
              <button onClick={() => void disconnectAndClear()} disabled={busy} className="inline-flex items-center gap-2 min-h-11 rounded-lg border border-red-500/30 px-3 text-xs text-red-100 disabled:opacity-50"><LogOut size={15}/> Отвязать и очистить локальную копию</button>
            </div>
          ) : boundId !== user.id ? (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
              <p className="text-sm">Устройство ещё не привязано к аккаунту. Первое нажатие загрузит в этот аккаунт текущих локальных агентов, чаты и память, а также объединит их с уже существующей облачной копией.</p>
              <button onClick={() => { if (window.confirm('Разрешить отправку локальных агентов, сообщений и заметок памяти в облачный аккаунт ' + (user.email || '') + '? Это объединит данные устройства и аккаунта.')) void runSync(true); }} disabled={busy || syncing} className="inline-flex items-center gap-2 min-h-11 rounded-lg bg-indigo-600 px-3 text-xs text-white disabled:opacity-50"><Cloud size={15}/> Разрешить и синхронизировать</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => void runSync(false)} disabled={syncing || busy} className="inline-flex items-center gap-2 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm text-white disabled:opacity-50"><RefreshCw size={15} className={syncing ? 'animate-spin' : ''}/>{syncing ? 'Синхронизация…' : 'Синхронизировать сейчас'}</button>
              <button onClick={() => void signOut()} disabled={busy || syncing} className="inline-flex items-center gap-2 min-h-11 rounded-lg border border-white/10 px-3 text-xs text-sv-muted disabled:opacity-50"><LogOut size={15}/> Выйти</button>
              <button onClick={() => void disconnectAndClear()} disabled={busy || syncing} className="inline-flex items-center gap-2 min-h-11 rounded-lg border border-red-500/20 px-3 text-xs text-red-200 disabled:opacity-50"><CloudOff size={15}/> Отвязать устройство</button>
            </div>
          )}
          {lastSync && <p className="text-xs text-sv-muted">Последняя успешная синхронизация: {new Date(lastSync.syncedAt).toLocaleString()} · ревизия {lastSync.revision}</p>}
          {boundId === user.id && <p className="text-xs text-sv-muted">Автоматическая проверка изменений выполняется, пока открыт раздел «Мои агенты» (раз в минуту). Принудительная синхронизация доступна по кнопке.</p>}
        </div>
      )}
      {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200 flex items-start gap-2"><CheckCircle2 size={15} className="shrink-0 mt-0.5"/>{message}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-200 flex items-start gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5"/>{error}</p>}
      <p className="text-[11px] text-sv-muted">Облачная синхронизация не включается молча. При первой привязке требуется подтверждение. Выход не удаляет удалённые данные; очистка устройства удаляет только локальную копию и её привязку, но не серверный архив.</p>
    </section>
  );
}
