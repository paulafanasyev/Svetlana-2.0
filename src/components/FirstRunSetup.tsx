// Мастер первого запуска: один понятный шаг до первого ответа. Одинаковый на сайте, в Windows и в Android.
// 1) «★ Светлана Сервер»: вставить ключ → ключ уходит в хранилище (Windows — Диспетчер учётных данных, Android — Keystore)
//    → пробный запрос. Ключ сохраняется один раз: если пробный запрос не прошёл, «Повторить проверку» не
//    спрашивает ключ заново. Если сохранить ключ не удалось («Отмена» в окне подтверждения), новый провайдер
//    убирается, чтобы не висел «выбранным» без ключа.
// 2) GigaChat от Сбера — бесплатно, только в приложениях (Windows и Android): та же схема «ключ → хранилище → пробный запрос».
//    На сайте — только подсказка, что он работает в приложении.
// 3) Локально через Ollama: проверяем, запущена ли Ollama, и берём УЖЕ скачанную модель
//    (имя по умолчанию svetlana:latest в открытом каталоге Ollama нет, поэтому не надеемся на него).
//    На компьютере Ollama на этом же ПК (127.0.0.1). На телефоне Ollama работает на компьютере в той же
//    Wi-Fi сети: вводим адрес ПК (например 192.168.1.10), запросы идут через нативный lan_http.
// Крестик, Escape и системная кнопка «Назад» телефона только закрывают мастер (при следующем запуске он
// покажется снова); считать настройку законченной без ИИ можно только явной кнопкой «Пока пропустить».
// Клавиатура: фокус сразу в поле ключа, Tab не уходит за пределы окна, после закрытия фокус возвращается назад.
// Пока мастер открыт, остальная страница inert: чтение экрана и мышь не уходят на фон.
// Ошибки показываются по-русски и без сырого текста сервера (explainAiError).
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Key, HardDrive, Loader2, CheckCircle2, AlertCircle, X, Sparkles, Gift } from 'lucide-react';
import { aiGateway, GIGACHAT_WEB_ONLY } from '../services/AIGateway';
import { explainAiError } from '../services/AiErrors';
import { SVETLANA_CORE_ORIGIN, SVETLANA_CORE_MODEL } from '../services/SvetlanaCore';
import { isNativeApp } from '../services/security/NativeBridge';
import { isAndroidApp } from '../platform';
import { onBack } from '../services/BackStack';
import { GIGACHAT_KEY_HINT } from '../pages/AIProvidersPage';
import { isolateDialog } from './useDialogFocus';

const DONE_KEY = 'svetlana_setup_done_v1';
const OLLAMA = 'http://127.0.0.1:11434';
const PING = 'Привет! Это проверка связи, ответь одним словом.';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function isSetupDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return true; }
}
export function markSetupDone() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* нет хранилища */ }
}
/** Ошибки нативной части приходят строкой, остальные — Error. */
export const errorText = (e: unknown): string => {
  const m = (e as { message?: unknown } | null)?.message;
  const s = typeof m === 'string' && m ? m : String(e ?? '');
  return s.slice(0, 300) || 'Неизвестная ошибка';
};

/** Понятный текст для частых ошибок пробного запроса к серверу Светланы (ключ уже сохранён). */
export function explainServerError(raw: string): string {
  if (/Отменено пользователем/.test(raw)) return 'В окне подтверждения нажата «Отмена». Нажми «Повторить проверку» и разреши запрос.';
  if (/\b(401|403)\b/.test(raw)) return 'Сервер Светланы не принял ключ. Проверь его и вставь заново.';
  if (/\b(429)\b/.test(raw)) return 'Сервер просит подождать: слишком много запросов. Попробуй через минуту.';
  if (/\b(5\d\d)\b/.test(raw)) return `Сервер Светланы сейчас не отвечает (${raw.match(/\b5\d\d\b/)?.[0]}). Попробуй позже.`;
  if (/error sending request|dns|connect|Failed to fetch|NetworkError/i.test(raw)) return 'Нет связи с сервером Светланы. Проверь интернет.';
  return explainAiError(raw);
}

/** Ошибка на шаге сохранения ключа (до пробного запроса). */
export function explainKeySaveError(raw: string): string {
  if (/Отменено пользователем/.test(raw)) return 'Ключ не сохранён: в окне подтверждения нажата «Отмена». Нажми «Подключить» ещё раз и подтверди сохранение.';
  return `Ключ не сохранён: ${explainAiError(raw)}`;
}

/**
 * Адрес Ollama из того, что ввёл человек: «192.168.1.10», «192.168.1.10:11434» или «http://192.168.1.10:11434».
 * Только http и IP-адрес из домашней сети (или 127.0.0.1 / localhost). Иначе null.
 */
export function normalizeOllamaEndpoint(raw: string): string | null {
  let s = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' || u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) return null;
  const host = u.hostname;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (host !== 'localhost') {
    if (!ip) return null;
    const o = ip.slice(1).map(Number);
    if (o.some(n => n > 255)) return null;
    const lan = o[0] === 127 || o[0] === 10 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31);
    if (!lan) return null;
  }
  return `http://${host}:${u.port || '11434'}`;
}

/** Модели, уже скачанные в Ollama. Бросает ошибку, если Ollama не отвечает. */
export async function listOllamaModels(endpoint = OLLAMA, timeoutMs = 3000, f: typeof fetch = fetch): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await f(`${endpoint}/api/tags`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Ollama ответила ${r.status}`);
    const data = (await r.json()) as { models?: unknown } | null;
    const raw = data?.models;
    const list: unknown[] = Array.isArray(raw) ? raw : [];
    return list
      .map(m => String((m as { name?: unknown } | null)?.name ?? ''))
      .filter(n => /^[A-Za-z0-9._:/-]{1,100}$/.test(n))
      .slice(0, 50);
  } finally {
    clearTimeout(timer);
  }
}

/** Какую модель предложить: сначала свою Светлану, потом хорошо говорящие по-русски, иначе первую. */
export function pickOllamaModel(models: string[]): string | null {
  const prefer = ['svetlana', 'qwen2.5', 'qwen3', 'gemma', 'llama3'];
  for (const p of prefer) {
    const m = models.find(x => x.toLowerCase().startsWith(p));
    if (m) return m;
  }
  return models[0] ?? null;
}

/** Подсказка, куда попадёт ключ и какие окна подтверждения ждать. */
export function keyStorageHint(platform: 'windows' | 'android' | 'web'): string {
  if (platform === 'android') return ' Ключ сохранится в защищённом хранилище телефона (Android Keystore). Телефон спросит два раза: «Сохранить ключ?» и «Разрешить отправить переписку?», нажми ОК в обоих.';
  if (platform === 'windows') return ' Ключ сохранится в Диспетчере учётных данных Windows. Будет два окна Windows: «Сохранить ключ?» и «Разрешить отправить переписку?», нажми ОК в обоих.';
  return ' Ключ хранится в зашифрованном хранилище браузера.';
}

/** Почему Ollama не нашлась: на телефоне Ollama стоит на компьютере в той же Wi-Fi сети. */
export function ollamaNotFoundText(android: boolean, endpoint: string): string {
  if (android) return `Ollama по адресу ${endpoint} не отвечает. На компьютере: установи Ollama (ollama.com/download), выполни ollama pull qwen2.5:7b, запусти Ollama с переменной OLLAMA_HOST=0.0.0.0 и разреши её в брандмауэре Windows. Телефон и компьютер должны быть в одной Wi-Fi сети. Потом нажми «Найти Ollama» ещё раз.`;
  return 'Ollama на этом ПК не отвечает. Установи её с сайта ollama.com/download, запусти, выполни ollama pull qwen2.5:7b и нажми «Найти Ollama» ещё раз.';
}

type Status = 'idle' | 'busy' | 'ok' | 'error';

export default function FirstRunSetup({ onClose, onReady, onOpenProviders }: {
  onClose: () => void;
  onReady: () => void;
  onOpenProviders: () => void;
}) {
  const android = isAndroidApp();
  const native = isNativeApp();
  const platform = android ? 'android' : native ? 'windows' : 'web';
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [sv, setSv] = useState<Status>('idle');
  const [svError, setSvError] = useState('');
  const [gKey, setGKey] = useState('');
  const [gSaved, setGSaved] = useState(false);
  const [gs, setGs] = useState<Status>('idle');
  const [gError, setGError] = useState('');
  const [ol, setOl] = useState<Status>('idle');
  const [olError, setOlError] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // На телефоне — адрес компьютера с Ollama в домашней сети. На ПК и сайте — этот же компьютер.
  const savedEndpoint = aiGateway.getProvider('ollama')?.endpoint ?? '';
  const [olAddr, setOlAddr] = useState(android ? (savedEndpoint.includes('127.0.0.1') ? '' : savedEndpoint) : OLLAMA);

  const finish = () => {
    markSetupDone();
    if (readyTimer.current) clearTimeout(readyTimer.current);
    readyTimer.current = setTimeout(() => { readyTimer.current = null; onReady(); }, 700);
  };
  // Крестик, Escape и «Назад» только закрывают: случайное нажатие не оставляет человека навсегда без ИИ.
  const close = () => { onClose(); };
  const skip = () => { markSetupDone(); onClose(); };
  const retryOnly = keySaved && !key.trim();
  const gRetryOnly = gSaved && !gKey.trim();
  const anyBusy = sv === 'busy' || gs === 'busy' || ol === 'busy';

  // Системная кнопка «Назад» телефона = крестик «Закрыть».
  useEffect(() => onBack(close), []);

  // Фон недоступен (inert), фокус в поле ключа; после закрытия фон освобождается и фокус
  // возвращается туда, где был. Таймер «Открываю чат» не переживает окно.
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    const root = dialogRef.current;
    const release = root ? isolateDialog(root) : () => undefined;
    keyRef.current?.focus();
    return () => {
      if (readyTimer.current) clearTimeout(readyTimer.current);
      release();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!anyBusy) close();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) { e.preventDefault(); first.focus(); }
  };

  /** Сохранить ключ. При неудаче нового провайдера убираем (раньше настроенного не трогаем). */
  const saveKey = async (value: string): Promise<boolean> => {
    const existed = !!aiGateway.getProvider('svetlana');
    try {
      await aiGateway.addProvider({
        id: 'svetlana', name: '★ Светлана Сервер (единая)', type: 'online',
        endpoint: SVETLANA_CORE_ORIGIN, model: SVETLANA_CORE_MODEL, enabled: true, apiKey: value,
      });
      return true;
    } catch (e) {
      if (!existed) await aiGateway.removeProvider('svetlana').catch(() => undefined);
      setSv('error');
      setSvError(explainKeySaveError(errorText(e)));
      return false;
    }
  };

  const connectServer = async () => {
    if (sv === 'busy' || (!key.trim() && !keySaved)) return;
    setSv('busy');
    setSvError('');
    if (key.trim()) {
      // Ключ сохраняем один раз (одно окно подтверждения), повторная проверка его не трогает.
      if (!(await saveKey(key.trim()))) return;
      setKey('');
      setKeySaved(true);
    }
    try {
      aiGateway.setActiveProvider('svetlana');
      await aiGateway.chat([{ role: 'user', content: PING }], { max_tokens: 50 }, 'svetlana');
      setSv('ok');
      finish();
    } catch (e) {
      setSv('error');
      setSvError(explainServerError(errorText(e)));
    }
  };

  /** GigaChat: ключ авторизации → хранилище приложения → пробный запрос. Ключ сохраняется один раз. */
  const connectGiga = async () => {
    if (!native || gs === 'busy' || (!gKey.trim() && !gSaved)) return;
    setGs('busy');
    setGError('');
    if (gKey.trim()) {
      const existed = !!aiGateway.getProvider('gigachat');
      try {
        await aiGateway.addProvider({
          id: 'gigachat', name: 'GigaChat (Сбер, бесплатно)', type: 'online',
          endpoint: 'https://api.giga.chat/v1', model: 'GigaChat-2', enabled: true, apiKey: gKey.trim(),
        });
      } catch (e) {
        if (!existed) await aiGateway.removeProvider('gigachat').catch(() => undefined);
        setGs('error');
        setGError(explainKeySaveError(errorText(e)));
        return;
      }
      setGKey('');
      setGSaved(true);
    }
    try {
      aiGateway.setActiveProvider('gigachat');
      await aiGateway.chat([{ role: 'user', content: PING }], { max_tokens: 50 }, 'gigachat');
      setGs('ok');
      finish();
    } catch (e) {
      setGs('error');
      setGError(explainAiError(errorText(e)));
    }
  };

  /** Адрес Ollama или null (с понятной ошибкой). */
  const endpointOrError = (): string | null => {
    const ep = normalizeOllamaEndpoint(olAddr);
    if (!ep) {
      setOl('error');
      setOlError(android
        ? 'Впиши адрес компьютера с Ollama в домашней сети, например 192.168.1.10 (на ПК: ipconfig → «IPv4-адрес»).'
        : 'Адрес Ollama должен быть вида http://127.0.0.1:11434.');
      return null;
    }
    return ep;
  };

  const findOllama = async () => {
    setOl('busy');
    setOlError('');
    const ep = endpointOrError();
    if (!ep) return;
    try {
      const list = await listOllamaModels(ep, android ? 5000 : 3000);
      setModels(list);
      setModel(pickOllamaModel(list) ?? '');
      if (!list.length) {
        setOl('error');
        setOlError('Ollama запущена, но моделей нет. В командной строке компьютера: ollama pull qwen2.5:7b (или qwen2.5:1.5b для слабого ПК), затем нажми «Найти Ollama» ещё раз.');
        return;
      }
      setOl('idle');
    } catch {
      setModels([]);
      setOl('error');
      setOlError(ollamaNotFoundText(android, ep));
    }
  };

  const useOllama = async () => {
    if (!model || ol === 'busy') return;
    const ep = endpointOrError();
    if (!ep) return;
    setOl('busy');
    setOlError('');
    try {
      if (aiGateway.getProvider('ollama')) {
        await aiGateway.updateProvider('ollama', { endpoint: ep, model, enabled: true });
      } else {
        await aiGateway.addProvider({ id: 'ollama', name: '★ Светлана Локальная (Ollama / Offline)', type: 'offline', endpoint: ep, model, enabled: true });
      }
      aiGateway.setActiveProvider('ollama');
      await aiGateway.chat([{ role: 'user', content: PING }], { max_tokens: 50 }, 'ollama');
      setOl('ok');
      finish();
    } catch (e) {
      setOl('error');
      setOlError(explainAiError(errorText(e)));
    }
  };

  const statusLine = (s: Status, err: string, okText: string) => (
    <>
      {s === 'busy' && <p role="status" className="sr-only">Проверяю…</p>}
      {s === 'ok' && <p role="status" className="text-xs text-emerald-400 flex items-center gap-1.5 mt-2"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />{okText}</p>}
      {s === 'error' && <p role="alert" className="text-xs text-rose-300 flex items-start gap-1.5 mt-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{err}</p>}
    </>
  );

  return (
    <div ref={dialogRef} onKeyDown={onKeyDown} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-white p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 id="first-run-title" className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-pink-400" aria-hidden="true" />Добро пожаловать в Светлану 2.0</h2>
            <p className="text-sm text-slate-400 mt-1">Выбери, через какой ИИ Светлана будет отвечать. Это можно поменять потом во вкладке «Модели ИИ».</p>
          </div>
          <button onClick={close} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400" title="Закрыть" aria-label="Закрыть"><X className="w-5 h-5" aria-hidden="true" /></button>
        </div>

        <section aria-labelledby="setup-server-title" className="rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4 mb-4">
          <h3 id="setup-server-title" className="font-semibold flex items-center gap-2"><Key className="w-4 h-4 text-indigo-300" aria-hidden="true" />★ Светлана Сервер (рекомендуется)</h3>
          <p className="text-xs text-slate-400 mt-1">Единая обученная Светлана на мир-самозанятых.рф, полный режим. Нужен ключ Светланы, который вы получили от владельца сервера.
            {keyStorageHint(platform)}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <input
              ref={keyRef}
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connectServer()}
              placeholder={keySaved ? 'ключ сохранён (можно вставить другой)' : 'ключ Светланы'}
              autoComplete="off"
              aria-label="Ключ Светланы"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
              disabled={sv === 'busy'}
            />
            <button
              onClick={connectServer}
              disabled={(!key.trim() && !keySaved) || sv === 'busy'}
              aria-busy={sv === 'busy'}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2"
            >
              {sv === 'busy' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}{retryOnly ? 'Повторить проверку' : 'Подключить'}
            </button>
          </div>
          {statusLine(sv, svError, 'Светлана ответила. Открываю чат…')}
        </section>

        {/* GigaChat: бесплатно, только в приложениях Windows и Android. */}
        <section aria-labelledby="setup-giga-title" className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4 mb-4" data-testid="setup-gigachat">
          <h3 id="setup-giga-title" className="font-semibold flex items-center gap-2"><Gift className="w-4 h-4 text-emerald-300" aria-hidden="true" />GigaChat от Сбера: бесплатно</h3>
          <p className="text-xs text-slate-400 mt-1">Хорошо говорит по-русски, ничего устанавливать не нужно. {GIGACHAT_KEY_HINT}{native ? keyStorageHint(platform) : ''}</p>
          {native ? (
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <input
                type="password"
                value={gKey}
                onChange={e => setGKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && connectGiga()}
                placeholder={gSaved ? 'ключ сохранён (можно вставить другой)' : 'ключ авторизации из Studio'}
                autoComplete="off"
                aria-label="Ключ авторизации GigaChat"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-emerald-500"
                disabled={gs === 'busy'}
              />
              <button
                onClick={connectGiga}
                disabled={(!gKey.trim() && !gSaved) || gs === 'busy'}
                aria-busy={gs === 'busy'}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2"
              >
                {gs === 'busy' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}{gRetryOnly ? 'Повторить проверку' : 'Подключить'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-200 mt-2">{GIGACHAT_WEB_ONLY}</p>
          )}
          {statusLine(gs, gError, 'GigaChat ответил. Открываю чат…')}
        </section>

        {/* Ollama: на ПК и сайте — этот компьютер, на телефоне — компьютер в той же Wi-Fi сети. */}
        <section aria-labelledby="setup-ollama-title" className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 mb-4" data-testid="setup-ollama">
          <h3 id="setup-ollama-title" className="font-semibold flex items-center gap-2"><HardDrive className="w-4 h-4 text-cyan-300" aria-hidden="true" />Без интернета: локальная модель через Ollama (для опытных)</h3>
          {android ? (
            <p className="text-xs text-slate-400 mt-1">Модель работает на твоём компьютере, телефон обращается к нему по домашней Wi-Fi сети, в интернет переписка не уходит. На ПК нужна Ollama (ollama.com/download), модель («ollama pull qwen2.5:7b») и запуск с OLLAMA_HOST=0.0.0.0.</p>
          ) : (
            <p className="text-xs text-slate-400 mt-1">Переписка не покидает компьютер. Нужна установленная Ollama (ollama.com/download) и скачанная модель, например «ollama pull qwen2.5:7b».</p>
          )}
          {android && (
            <input
              value={olAddr}
              onChange={e => setOlAddr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && findOllama()}
              placeholder="адрес ПК, например 192.168.1.10"
              inputMode="url"
              autoComplete="off"
              aria-label="Адрес компьютера с Ollama"
              className="w-full min-w-0 mt-3 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-cyan-500"
              disabled={ol === 'busy'}
            />
          )}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-3">
            <button
              onClick={findOllama}
              disabled={ol === 'busy'}
              aria-busy={ol === 'busy' && !models.length}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
            >
              {ol === 'busy' && !models.length && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Найти Ollama
            </button>
            {models.length > 0 && (
              <>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  aria-label="Модель Ollama"
                  className="min-w-0 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm"
                >
                  {models.map(m => <option key={m} value={m} className="bg-slate-900">{m}</option>)}
                </select>
                <button
                  onClick={useOllama}
                  disabled={!model || ol === 'busy'}
                  aria-busy={ol === 'busy'}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2"
                >
                  {ol === 'busy' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Использовать
                </button>
              </>
            )}
          </div>
          {statusLine(ol, olError, 'Локальная модель ответила. Открываю чат…')}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => { markSetupDone(); onOpenProviders(); }} className="text-sm text-indigo-300 hover:text-indigo-200">Другие ИИ (OpenAI, Claude, Groq, DeepSeek…) →</button>
          <button onClick={skip} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm">Пока пропустить</button>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Команды CRM («Сводка CRM») работают и без ИИ. Мастер можно открыть снова кнопкой «Настройка».</p>
      </div>
    </div>
  );
}
