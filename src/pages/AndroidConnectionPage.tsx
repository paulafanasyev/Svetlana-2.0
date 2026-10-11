// Android Connection Page - Connect to the Svetlana-home bridge on the phone
import { useState, useEffect } from 'react';
import { handsManager } from '../services/HandsManager';
import type { ConnectionStatus } from '../services/PlatformHands';
import { validateBridgeEndpoint } from '../services/security/BridgeCrypto';
import { getSecret, setSecret } from '../services/security/SecretStore';
import { Smartphone, Wifi, WifiOff, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

const CONFIG_KEY = 'svetlana_android_config';
const CODE_SECRET = 'bridge.code';

export default function AndroidConnectionPage() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = handsManager.onStatusChange(setStatus);
    let alive = true;
    (async () => {
      const saved = localStorage.getItem(CONFIG_KEY);
      let legacyCode = '';
      if (saved && saved.length < 2000) {
        try {
          const config = JSON.parse(saved);
          if (typeof config?.endpoint === 'string') setEndpoint(config.endpoint);
          if (typeof config?.token === 'string') legacyCode = config.token;
        } catch { /* повреждённые настройки игнорируем */ }
      }
      if (legacyCode) {
        // Миграция: код лежал открытым текстом — переносим в зашифрованное хранилище.
        await setSecret(CODE_SECRET, legacyCode);
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ transport: 'http', endpoint: JSON.parse(saved!).endpoint ?? '' })); } catch { /* noop */ }
      }
      const code = await getSecret(CODE_SECRET);
      if (alive && code) setToken(code);
    })();
    return () => { alive = false; unsubscribe(); };
  }, []);

  const normalizedEndpoint = () => {
    const value = endpoint.trim();
    if (!value) return value;
    return /^https?:\/\//i.test(value) ? value : `http://${value}`;
  };

  const handleConnect = async () => {
    setError(null);
    try {
      const url = validateBridgeEndpoint(normalizedEndpoint());
      await handsManager.connect({ transport: 'http', endpoint: url, token: token.trim(), timeout: 10000, reconnect: true });
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ transport: 'http', endpoint: url }));
      await setSecret(CODE_SECRET, token.trim());
      const hands = handsManager.getHands();
      if (hands) setDeviceInfo(await hands.getDeviceInfo());
    } catch (err: any) {
      const message = err?.message || 'Failed to connect';
      setError(message === 'Failed to fetch'
        ? 'Телефон не отвечает. Проверьте, что «Подключение к ПК» включено и ПК в той же Wi‑Fi сети.'
        : message);
    }
  };

  const handleDisconnect = async () => { await handsManager.disconnect(); setDeviceInfo(null); };
  const handleForget = async () => { await handleDisconnect(); await setSecret(CODE_SECRET, null); setToken(''); };
  const locked = status === 'connected' || status === 'connecting';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3"><Smartphone className="w-10 h-10" />Телефон</h1>
          <p className="text-slate-300">Подключение к Светлане на Android (Svetlana-home)</p>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">Статус</h2>
            <div className="flex items-center gap-2">
              {status === 'connected' && <><CheckCircle className="w-6 h-6 text-green-500" /><span className="text-green-500 font-bold">Подключено, связь зашифрована</span></>}
              {status === 'connecting' && <><RefreshCw className="w-6 h-6 text-blue-500 animate-spin" /><span className="text-blue-500 font-bold">Подключаюсь…</span></>}
              {status === 'disconnected' && <><WifiOff className="w-6 h-6 text-slate-500" /><span className="text-slate-500 font-bold">Не подключено</span></>}
              {status === 'error' && <><XCircle className="w-6 h-6 text-red-500" /><span className="text-red-500 font-bold">Ошибка</span></>}
            </div>
          </div>
          {deviceInfo && <div className="mt-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700"><h3 className="text-sm font-medium text-slate-400 mb-2">Устройство</h3><div className="grid grid-cols-2 gap-4 text-sm"><div><span className="text-slate-400">Платформа:</span><span className="text-white ml-2">{String(deviceInfo.platform ?? '')}</span></div><div><span className="text-slate-400">Модель:</span><span className="text-white ml-2">{String(deviceInfo.model ?? '')}</span></div><div><span className="text-slate-400">Версия:</span><span className="text-white ml-2">{String(deviceInfo.osVersion ?? '')}</span></div><div><span className="text-slate-400">Экран:</span><span className="text-white ml-2">{Number(deviceInfo.screenWidth) || 0}x{Number(deviceInfo.screenHeight) || 0}</span></div></div></div>}
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Подключение</h2>
          <div className="space-y-4">
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Адрес телефона</label><input type="text" value={endpoint} placeholder="http://192.168.1.20:8080" onChange={(e) => setEndpoint(e.target.value)} disabled={locked} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white" /><p className="text-xs text-slate-400 mt-1">Показан на главном экране Светланы под «Подключение к ПК». Только адреса домашней сети.</p></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Код подключения</label><input type="password" value={token} placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} onChange={(e) => setToken(e.target.value.toUpperCase())} disabled={locked} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white tracking-widest font-mono" /><p className="text-xs text-slate-400 mt-1">Новый код появляется при каждом включении подключения на телефоне. Код хранится зашифрованным и по сети не передаётся.</p></div>
            {error && <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg"><div className="flex items-start gap-2"><AlertCircle className="w-5 h-5 text-red-400" /><div><p className="text-red-400 font-medium">Не удалось подключиться</p><p className="text-red-300 text-sm mt-1">{error}</p></div></div></div>}
            <div className="flex gap-3">
              {status === 'connected' ? <button onClick={handleDisconnect} className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg font-medium"><WifiOff className="w-5 h-5" />Отключить</button> : <button onClick={handleConnect} disabled={status === 'connecting' || !endpoint.trim() || !token.trim()} className="flex items-center gap-2 px-6 py-3 bg-purple-600 disabled:bg-slate-600 text-white rounded-lg font-medium">{status === 'connecting' ? <><RefreshCw className="w-5 h-5 animate-spin" />Подключаюсь…</> : <><Wifi className="w-5 h-5" />Подключить</>}</button>}
              {token && <button onClick={handleForget} className="px-4 py-3 bg-slate-700 text-slate-200 rounded-lg">Забыть код</button>}
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">Как подключить</h2>
          <ol className="space-y-3 text-slate-300"><li>1. Установите Svetlana-home на телефон и разрешите доступы в мастере.</li><li>2. На главном экране Светланы нажмите «Подключение к ПК: Включить».</li><li>3. Введите здесь адрес и код с экрана телефона.</li><li>4. Телефон и ПК должны быть в одной домашней Wi‑Fi сети.</li></ol>
          <div className="mt-6 p-4 bg-emerald-900/20 border border-emerald-700 rounded-lg"><p className="text-emerald-300 text-sm"><strong>Защита:</strong> каждый запрос и ответ шифруется ключом из кода подключения; сам код по сети не передаётся, перехваченный запрос нельзя повторить, а чужое устройство не выдаст себя за ваш телефон. Нужны свежие версии Светланы на ПК и телефоне. Веб-версия по https к телефону не подключится (браузер блокирует), нужна Windows-версия.</p></div>
        </div>
      </div>
    </div>
  );
}
