import { useState } from 'react';
import { browserWorkerClient } from '../services/BrowserWorkerClient';

export default function BrowserWorkerSettings({ onConfigChange }: { onConfigChange?: () => void }) {
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:4178');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const save = () => {
    try {
      browserWorkerClient.saveConfig(endpoint, token);
      onConfigChange?.();
      setStatus('Настройки сохранены локально. Проверьте соединение.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить настройки.');
    }
  };
  const testConnection = async () => {
    setBusy(true);
    setStatus('');
    try {
      const response = await browserWorkerClient.testConnection();
      setStatus(response.ok ? 'Соединение подтверждено: Browser Worker отвечает.' : 'Сервис ответил неожиданно.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Соединение не подтверждено.');
    } finally { setBusy(false); }
  };
  const clear = () => {
    browserWorkerClient.clearConfig();
    onConfigChange?.();
    setToken('');
    setStatus('Локальные настройки браузера удалены.');
  };

  return (
    <section className="glass-card rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Браузер агента</h3>
        <p className="text-sm text-sv-muted mt-1">Подключение к локальному браузерному исполнителю. У каждого агента будет отдельная сессия.</p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm">Адрес локального сервиса</span>
        <input value={endpoint} onChange={e => setEndpoint(e.target.value)} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" placeholder="http://127.0.0.1:4178" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">Токен Browser Worker</span>
        <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" placeholder="Секрет не отправляется в AI-провайдер" />
      </label>
      <p className="text-xs text-sv-muted">Токен хранится в локальном хранилище этого браузера. Не используйте общедоступный адрес и не добавляйте токен в код или Vercel-переменные клиентской сборки.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={save} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">Сохранить локально</button>
        <button onClick={testConnection} disabled={busy} className="px-3 py-2 rounded-lg border border-white/15 text-sm disabled:opacity-50">{busy ? 'Проверка…' : 'Проверить соединение'}</button>
        <button onClick={clear} className="px-3 py-2 rounded-lg border border-white/15 text-sm">Удалить настройки</button>
      </div>
      {status && <p role="status" className="text-sm text-sv-muted">{status}</p>}
    </section>
  );
}
