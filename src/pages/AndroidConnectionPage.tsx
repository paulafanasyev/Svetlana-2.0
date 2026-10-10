// Android Connection Page - Connect to the Svetlana-home bridge on the phone
import { useState, useEffect } from 'react';
import { handsManager } from '../services/HandsManager';
import type { ConnectionStatus } from '../services/PlatformHands';
import { Smartphone, Wifi, WifiOff, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

const CONFIG_KEY = 'svetlana_android_config';

export default function AndroidConnectionPage() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [transport, setTransport] = useState<'websocket' | 'http'>('http');
  const [error, setError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = handsManager.onStatusChange(setStatus);
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) {
      try {
        const config = JSON.parse(saved);
        setEndpoint(config.endpoint || '');
        setTransport(config.transport || 'http');
        setToken(config.token || '');
      } catch (e) { console.error('Failed to load config:', e); }
    }
    return unsubscribe;
  }, []);

  const normalizedEndpoint = () => {
    const value = endpoint.trim();
    if (!value) return value;
    return /^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value) ? value : `http://${value}`;
  };

  const handleConnect = async () => {
    setError(null);
    const url = normalizedEndpoint();
    try {
      await handsManager.connect({ transport, endpoint: url, token: token.trim(), timeout: 10000, reconnect: true });
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ transport, endpoint: url, token: token.trim() }));
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
              {status === 'connected' && <><CheckCircle className="w-6 h-6 text-green-500" /><span className="text-green-500 font-bold">Подключено</span></>}
              {status === 'connecting' && <><RefreshCw className="w-6 h-6 text-blue-500 animate-spin" /><span className="text-blue-500 font-bold">Подключаюсь…</span></>}
              {status === 'disconnected' && <><WifiOff className="w-6 h-6 text-slate-500" /><span className="text-slate-500 font-bold">Не подключено</span></>}
              {status === 'error' && <><XCircle className="w-6 h-6 text-red-500" /><span className="text-red-500 font-bold">Ошибка</span></>}
            </div>
          </div>
          {deviceInfo && <div className="mt-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700"><h3 className="text-sm font-medium text-slate-400 mb-2">Устройство</h3><div className="grid grid-cols-2 gap-4 text-sm"><div><span className="text-slate-400">Платформа:</span><span className="text-white ml-2">{deviceInfo.platform}</span></div><div><span className="text-slate-400">Модель:</span><span className="text-white ml-2">{deviceInfo.model}</span></div><div><span className="text-slate-400">Версия:</span><span className="text-white ml-2">{deviceInfo.osVersion}</span></div><div><span className="text-slate-400">Экран:</span><span className="text-white ml-2">{deviceInfo.screenWidth}x{deviceInfo.screenHeight}</span></div></div></div>}
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Подключение</h2>
          <div className="space-y-4">
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Адрес телефона</label><input type="text" value={endpoint} placeholder="http://192.168.1.20:8080" onChange={(e) => setEndpoint(e.target.value)} disabled={locked} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white" /><p className="text-xs text-slate-400 mt-1">Показан на главном экране Светланы под «Подключение к ПК».</p></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Код подключения</label><input type="text" value={token} placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} onChange={(e) => setToken(e.target.value.toUpperCase())} disabled={locked} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white tracking-widest font-mono" /><p className="text-xs text-slate-400 mt-1">Новый код появляется при каждом включении подключения на телефоне.</p></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Протокол</label><select value={transport} onChange={(e) => setTransport(e.target.value as any)} disabled={locked} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"><option value="http">HTTP — Svetlana-home</option><option value="websocket">WebSocket (экспериментально)</option></select></div>
            {error && <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg"><div className="flex items-start gap-2"><AlertCircle className="w-5 h-5 text-red-400" /><div><p className="text-red-400 font-medium">Не удалось подключиться</p><p className="text-red-300 text-sm mt-1">{error}</p></div></div></div>}
            {status === 'connected' ? <button onClick={handleDisconnect} className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg font-medium"><WifiOff className="w-5 h-5" />Отключить</button> : <button onClick={handleConnect} disabled={status === 'connecting' || !endpoint.trim() || (transport === 'http' && !token.trim())} className="flex items-center gap-2 px-6 py-3 bg-purple-600 disabled:bg-slate-600 text-white rounded-lg font-medium">{status === 'connecting' ? <><RefreshCw className="w-5 h-5 animate-spin" />Подключаюсь…</> : <><Wifi className="w-5 h-5" />Подключить</>}</button>}
          </div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">Как подключить</h2>
          <ol className="space-y-3 text-slate-300"><li>1. Установите Svetlana-home на телефон и разрешите доступы в мастере.</li><li>2. На главном экране Светланы нажмите «Подключение к ПК: Включить».</li><li>3. Введите здесь адрес и код с экрана телефона.</li><li>4. Телефон и ПК должны быть в одной домашней Wi‑Fi сети.</li></ol>
          <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg"><p className="text-yellow-300 text-sm"><strong>Важно:</strong> связь с телефоном идёт без шифрования — используйте только домашнюю сеть. Веб-версия по https к телефону не подключится (браузер блокирует), нужна Windows-версия.</p></div>
        </div>
      </div>
    </div>
  );
}
