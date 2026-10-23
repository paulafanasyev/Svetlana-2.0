import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe, Loader2, RefreshCw, Send } from 'lucide-react';
import { browserWorkerClient, type BrowserObservation } from '../services/BrowserWorkerClient';

interface Props {
  agentId: string;
  refreshKey: number;
  onSessionChange: (sessionId: string | null) => void;
}

export default function EmbeddedBrowserPanel({ agentId, refreshKey, onSessionChange }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [url, setUrl] = useState('https://example.com');
  const [observation, setObservation] = useState<BrowserObservation | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const configured = browserWorkerClient.isConfigured();

  const observe = useCallback(async (id: string) => {
    const [page, image] = await Promise.all([
      browserWorkerClient.snapshot(id),
      browserWorkerClient.screenshot(id),
    ]);
    setObservation(page.observation);
    setUrl(page.observation.url || 'https://example.com');
    setScreenshot(image.base64 ? 'data:' + (image.mimeType || 'image/jpeg') + ';base64,' + image.base64 : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let createdId: string | null = null;
    setSessionId(null);
    setObservation(null);
    setScreenshot(null);
    onSessionChange(null);
    if (!configured) {
      setStatus('Сначала настройте локальный Browser Worker в разделе выше.');
      return () => { cancelled = true; };
    }
    setBusy(true);
    setStatus('Запуск изолированной браузерной сессии…');
    void browserWorkerClient.createSession(agentId).then(async created => {
      createdId = created.sessionId;
      if (cancelled) {
        await browserWorkerClient.closeSession(created.sessionId).catch(() => undefined);
        return;
      }
      setSessionId(created.sessionId);
      onSessionChange(created.sessionId);
      await observe(created.sessionId);
      if (!cancelled) setStatus('Браузер готов. Страницы и текст сайтов считаются недоверенными данными.');
    }).catch(error => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : 'Не удалось создать браузерную сессию.');
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => {
      cancelled = true;
      onSessionChange(null);
      if (createdId) void browserWorkerClient.closeSession(createdId).catch(() => undefined);
    };
  }, [agentId, configured, observe, onSessionChange]);

  useEffect(() => {
    if (!sessionId || refreshKey === 0) return;
    let cancelled = false;
    setBusy(true);
    void observe(sessionId).then(() => {
      if (!cancelled) setStatus('Страница обновлена после ответа агента.');
    }).catch(error => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : 'Не удалось обновить снимок браузера.');
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [refreshKey, sessionId, observe]);

  const navigate = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setStatus('Открываю страницу…');
    try {
      const target = /^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
      const result = await browserWorkerClient.navigate(sessionId, target);
      setObservation(result.observation);
      setUrl(result.observation.url);
      const image = await browserWorkerClient.screenshot(sessionId);
      setScreenshot(image.base64 ? 'data:' + (image.mimeType || 'image/jpeg') + ';base64,' + image.base64 : null);
      setStatus('Страница загружена. Агент может работать в этой же сессии.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось открыть страницу.');
    } finally { setBusy(false); }
  };

  const refresh = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await observe(sessionId);
      setStatus('Снимок обновлён.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось обновить страницу.');
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-cyan-500/25 bg-black/10 overflow-hidden" aria-label="Встроенный браузер агента">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-white/10">
        <Globe size={18} className="text-cyan-300 shrink-0"/>
        <h2 className="font-semibold text-sm">Браузер в чате</h2>
        <span className="text-xs text-sv-muted">{sessionId ? 'Сессия агента активна' : 'Сессия не активна'}</span>
        <div className="flex-1"/>
        <button type="button" onClick={() => void refresh()} disabled={!sessionId || busy} className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-lg border border-white/10 disabled:opacity-40" aria-label="Обновить браузер"><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/></button>
      </div>
      <form className="flex gap-2 p-3 border-b border-white/10" onSubmit={e => { e.preventDefault(); void navigate(); }}>
        <input aria-label="Адрес страницы браузера" value={url} onChange={e => setUrl(e.target.value)} maxLength={2048} placeholder="https://example.com" className="min-w-0 flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm" disabled={!sessionId || busy}/>
        <button type="submit" disabled={!sessionId || busy || !url.trim()} className="min-h-10 px-3 rounded-lg bg-cyan-700 disabled:opacity-40 text-white inline-flex items-center gap-2 text-sm"><Send size={14}/> Открыть</button>
      </form>
      {status && <p role="status" className="px-3 pt-3 text-xs text-sv-muted">{busy && <Loader2 size={13} className="inline mr-1 animate-spin"/>}{status}</p>}
      {screenshot && <div className="p-3"><img src={screenshot} alt={'Снимок браузера: ' + (observation?.title || observation?.url || 'страница')} className="w-full rounded-lg border border-white/10 bg-white object-contain max-h-[520px]"/><div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-sv-muted"><span className="truncate flex-1">{observation?.title || observation?.url}</span>{observation?.url && <a href={observation.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><ExternalLink size={12}/> Открыть отдельно</a>}</div></div>}
      {observation && <details className="p-3 border-t border-white/10"><summary className="cursor-pointer text-sm">Текст страницы для проверки</summary><p className="mt-2 text-xs text-sv-muted break-all">{observation.url}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{(observation.text || observation.aria || 'Текст страницы недоступен.').slice(0, 12000)}</pre></details>}
      {!configured && <div className="p-3 text-sm text-amber-200">Браузер пока не запускается автоматически: настройте Worker, затем откройте эту панель повторно. Встроенный runtime в APK/EXE ещё не включён.</div>}
    </section>
  );
}
