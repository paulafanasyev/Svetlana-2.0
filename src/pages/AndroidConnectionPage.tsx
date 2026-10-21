// Страница «Телефон»: подключение к мосту Svetlana-home на Android по домашней Wi‑Fi сети.
// На сайте (https) браузер не пускает к устройствам домашней сети, поэтому форма выключена и сразу сказано, что нужна Windows-версия.
// «Забыть код» спрашивает подтверждение и сообщает результат.
import { useState, useEffect } from 'react';
import { handsManager } from '../services/HandsManager';
import type { ConnectionStatus } from '../services/PlatformHands';
import { validateBridgeEndpoint } from '../services/security/BridgeCrypto';
import { getSecret, setSecret } from '../services/security/SecretStore';
import { appPlatform } from '../platform';
import { askConfirm } from '../components/ConfirmDialog';
import { Smartphone, Wifi, WifiOff, RefreshCw, CheckCircle, XCircle, AlertCircle, Download, Info } from 'lucide-react';

const CONFIG_KEY = 'svetlana_android_config';
const CODE_SECRET = 'bridge.code';
const SVETLANA_HOME_RELEASES = 'https://github.com/paulafanasyev/Svetlana-Home/releases';
const NET_HINT = 'Проверьте: «Подключение к ПК» на телефоне включено, телефон и ПК в одной Wi‑Fi сети (не гостевой), VPN на ПК выключен, сеть в Windows отмечена как «Частная».';
/** Текст для сайта: подключение к телефону работает только из приложения для Windows. */
export const WEB_PHONE_NOTICE = 'Подключить телефон можно только из Windows-версии Светланы: браузер не пускает сайт к устройствам домашней сети. Установите приложение для Windows, и эта страница заработает.';

/** Технические ошибки моста превращаем в понятные следующие шаги. */
function explainBridgeError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('timeout') || m.includes('health') || m.includes('refused') || m.includes('networkerror') || m.includes('not connected')) {
    return `Телефон не отвечает. ${NET_HINT}`;
  }
  if (/\b(401|403)\b/.test(m) || m.includes('unauthorized') || m.includes('forbidden')) {
    return 'Телефон не принял код. Код меняется при каждом включении подключения: введите свежий с экрана телефона.';
  }
  if (/\b426\b/.test(m) || m.includes('upgrade')) {
    return 'Версии Светланы на ПК и телефоне не совпадают. Обновите оба приложения.';
  }
  if (/invalid|недопустим|адрес/i.test(message)) return message;
  return 'Не получилось подключиться. Проверьте адрес и код на экране телефона. ' + NET_HINT;
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connected: 'Подключено, связь зашифрована',
  connecting: 'Подключаюсь…',
  disconnected: 'Не подключено',
  error: 'Ошибка подключения',
} as Record<ConnectionStatus, string>;

export default function AndroidConnectionPage() {
  const web = appPlatform() === 'web';
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = handsManager.onStatusChange(setStatus);
    let alive = true;
    void (async () => {
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
        // Миграция: код лежал открытым текстом, переносим в зашифрованное хранилище.
        await setSecret(CODE_SECRET, legacyCode);
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ transport: 'http', endpoint: JSON.parse(saved!).endpoint ?? '' })); } catch { /* noop */ }
      }
      const code = await getSecret(CODE_SECRET);
      if (alive && code) setToken(code);
    })().catch(() => {
      if (alive) setError('Не удалось прочитать сохранённый код из защищённого хранилища. Введите код с телефона заново.');
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  const normalizedEndpoint = () => {
    const value = endpoint.trim();
    if (!value) return value;
    return /^https?:\/\//i.test(value) ? value : `http://${value}`;
  };

  const handleConnect = async () => {
    if (web) { setError(WEB_PHONE_NOTICE); return; }
    setError(null); setNotice(null);
    try {
      const url = validateBridgeEndpoint(normalizedEndpoint());
      await handsManager.connect({ transport: 'http', endpoint: url, token: token.trim(), timeout: 10000, reconnect: true });
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ transport: 'http', endpoint: url }));
      await setSecret(CODE_SECRET, token.trim());
      const hands = handsManager.getHands();
      if (hands) setDeviceInfo(await hands.getDeviceInfo());
    } catch (err: any) {
      setError(explainBridgeError(String(err?.message || '')));
    }
  };

  const handleDisconnect = async () => {
    try { await handsManager.disconnect(); } catch { /* уже отключено */ }
    setDeviceInfo(null);
  };
  const handleForget = async () => {
    const sure = await askConfirm('Забыть код подключения? Связь с телефоном отключится, для нового подключения понадобится свежий код с экрана телефона.', { okText: 'Забыть код' });
    if (!sure) return;
    await handleDisconnect();
    try {
      await setSecret(CODE_SECRET, null);
      setNotice('Код удалён с этого компьютера.');
    } catch { setError('Не удалось удалить код из хранилища'); }
    setToken('');
  };
  const locked = web || status === 'connected' || status === 'connecting';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2 flex items-center gap-3"><Smartphone className="w-8 h-8 sm:w-10 sm:h-10" aria-hidden="true" />Телефон</h1>
          <p className="text-slate-300">Связь со Светланой на Android (Svetlana-home). Сейчас это проверка связи и данные устройства; команды телефону из чата появятся в следующих версиях.</p>
        </div>
        {web && (
          <div role="note" data-testid="phone-web-notice" className="mb-6 p-4 rounded-xl bg-amber-900/30 border border-amber-600 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-amber-100 text-sm">{WEB_PHONE_NOTICE}</p>
          </div>
        )}
        <section className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 sm:p-6 border border-slate-700 mb-6" aria-labelledby="phone-status-title">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 id="phone-status-title" className="text-2xl font-bold text-white">Статус</h2>
            <div className="flex items-center gap-2" role="status">
              {status === 'connected' && <CheckCircle className="w-6 h-6 text-green-400" aria-hidden="true" />}
              {status === 'connecting' && <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" aria-hidden="true" />}
              {status === 'disconnected' && <WifiOff className="w-6 h-6 text-slate-400" aria-hidden="true" />}
              {status === 'error' && <XCircle className="w-6 h-6 text-red-400" aria-hidden="true" />}
              <span className={`font-bold ${status === 'connected' ? 'text-green-400' : status === 'connecting' ? 'text-blue-300' : status === 'error' ? 'text-red-400' : 'text-slate-300'}`}>{STATUS_TEXT[status] ?? String(status)}</span>
            </div>
          </div>
          {deviceInfo && <div className="mt-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700"><h3 className="text-sm font-medium text-slate-300 mb-2">Устройство</h3><dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 text-sm"><div><dt className="inline text-slate-400">Платформа:</dt><dd className="inline text-white ml-2">{String(deviceInfo.platform ?? '')}</dd></div><div><dt className="inline text-slate-400">Модель:</dt><dd className="inline text-white ml-2">{String(deviceInfo.model ?? '')}</dd></div><div><dt className="inline text-slate-400">Версия:</dt><dd className="inline text-white ml-2">{String(deviceInfo.osVersion ?? '')}</dd></div><div><dt className="inline text-slate-400">Экран:</dt><dd className="inline text-white ml-2">{Number(deviceInfo.screenWidth) || 0}x{Number(deviceInfo.screenHeight) || 0}</dd></div></dl></div>}
        </section>
        <section className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 sm:p-6 border border-slate-700 mb-6" aria-labelledby="phone-connect-title">
          <h2 id="phone-connect-title" className="text-2xl font-bold text-white mb-4">Подключение</h2>
          <div className="space-y-4">
            <div><label htmlFor="phone-endpoint" className="block text-sm font-medium text-slate-300 mb-2">Адрес телефона</label><input id="phone-endpoint" type="text" inputMode="url" value={endpoint} placeholder="http://192.168.1.20:8080" aria-describedby="phone-endpoint-hint" onChange={(e) => setEndpoint(e.target.value)} disabled={locked} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white disabled:text-slate-400" /><p id="phone-endpoint-hint" className="text-xs text-slate-400 mt-1">Показан на главном экране Светланы под «Подключение к ПК». Только адреса домашней сети.</p></div>
            <div><label htmlFor="phone-code" className="block text-sm font-medium text-slate-300 mb-2">Код подключения</label><input id="phone-code" type="password" value={token} placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} aria-describedby="phone-code-hint" onChange={(e) => setToken(e.target.value.toUpperCase())} disabled={locked} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white tracking-widest font-mono disabled:text-slate-400" /><p id="phone-code-hint" className="text-xs text-slate-400 mt-1">Новый код появляется при каждом включении подключения на телефоне. Код хранится зашифрованным и по сети не передаётся.</p></div>
            {error && <div role="alert" className="p-4 bg-red-900/20 border border-red-700 rounded-lg"><div className="flex items-start gap-2"><AlertCircle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" /><div><p className="text-red-300 font-medium">Не удалось подключиться</p><p className="text-red-200 text-sm mt-1">{error}</p></div></div></div>}
            {notice && !error && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
            <div className="flex flex-wrap gap-3">
              {status === 'connected' ? <button onClick={handleDisconnect} className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"><WifiOff className="w-5 h-5" aria-hidden="true" />Отключить</button> : <button onClick={handleConnect} disabled={web || status === 'connecting' || !endpoint.trim() || !token.trim()} aria-busy={status === 'connecting'} className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:text-slate-300 text-white rounded-lg font-medium">{status === 'connecting' ? <><RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />Подключаюсь…</> : <><Wifi className="w-5 h-5" aria-hidden="true" />Подключить</>}</button>}
              {token && !web && <button onClick={handleForget} className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg">Забыть код</button>}
            </div>
          </div>
        </section>
        <section className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 sm:p-6 border border-slate-700" aria-labelledby="phone-howto-title">
          <h2 id="phone-howto-title" className="text-2xl font-bold text-white mb-4">Как подключить</h2>
          <ol className="space-y-3 text-slate-300 list-decimal pl-5">
            <li>Скачайте и установите Svetlana-home (файл .apk) на телефон, разрешите доступы в мастере.</li>
            <li>На главном экране Светланы нажмите «Подключение к ПК: Включить».</li>
            <li>Введите здесь адрес и код с экрана телефона.</li>
            <li>Телефон и ПК должны быть в одной домашней Wi‑Fi сети. Гостевая сеть роутера и VPN на ПК часто блокируют связь; если Windows спросит про сеть, выберите «Частная».</li>
          </ol>
          <a href={SVETLANA_HOME_RELEASES} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium"><Download className="w-4 h-4" aria-hidden="true" />Скачать Svetlana-home для Android</a>
          <div className="mt-6 p-4 bg-emerald-900/20 border border-emerald-700 rounded-lg"><p className="text-emerald-200 text-sm"><strong>Защита:</strong> каждый запрос и ответ шифруется ключом из кода подключения; сам код по сети не передаётся, перехваченный запрос нельзя повторить, а чужое устройство не выдаст себя за ваш телефон. Нужны свежие версии Светланы на ПК и телефоне.</p></div>
        </section>
      </div>
    </div>
  );
}
