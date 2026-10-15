// Мастер первого запуска: один понятный шаг до первого ответа. Одинаковый на сайте, в Windows и в Android.
// 1) «★ Светлана Сервер»: вставить ключ → ключ уходит в хранилище (Windows — Диспетчер учётных данных, Android — Keystore)
//    → пробный запрос. Ключ сохраняется один раз: если пробный запрос не прошёл, «Повторить проверку» не
//    спрашивает ключ заново. Если сохранить ключ не удалось («Отмена» в окне подтверждения), новый провайдер
//    убирается, чтобы не висел «выбранным» без ключа.
// 2) Локально через Ollama (только компьютер): проверяем, запущена ли Ollama, и берём УЖЕ скачанную модель
//    (имя по умолчанию svetlana:latest в открытом каталоге Ollama нет, поэтому не надеемся на него).
// На телефоне системная кнопка «Назад» закрывает мастер так же, как крестик (BackStack).
import { useEffect, useState } from 'react';
import { Key, HardDrive, Loader2, CheckCircle2, AlertCircle, X, Sparkles } from 'lucide-react';
import { aiGateway } from '../services/AIGateway';
import { SVETLANA_CORE_ORIGIN, SVETLANA_CORE_MODEL } from '../services/SvetlanaCore';
import { isNativeApp } from '../services/security/NativeBridge';
import { isAndroidApp } from '../platform';
import { onBack } from '../services/BackStack';

const DONE_KEY = 'svetlana_setup_done_v1';
const OLLAMA = 'http://127.0.0.1:11434';
const PING = 'Привет! Это проверка связи, ответь одним словом.';

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
  return raw;
}

/** Ошибка на шаге сохранения ключа (до пробного запроса). */
export function explainKeySaveError(raw: string): string {
  if (/Отменено пользователем/.test(raw)) return 'Ключ не сохранён: в окне подтверждения нажата «Отмена». Нажми «Подключить» ещё раз и подтверди сохранение.';
  return `Ключ не сохранён: ${raw}`;
}

/** Модели, уже скачанные в Ollama на этом компьютере. Бросает ошибку, если Ollama не отвечает. */
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

type Status = 'idle' | 'busy' | 'ok' | 'error';

export default function FirstRunSetup({ onClose, onReady, onOpenProviders }: {
  onClose: () => void;
  onReady: () => void;
  onOpenProviders: () => void;
}) {
  const android = isAndroidApp();
  const platform = android ? 'android' : isNativeApp() ? 'windows' : 'web';
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [sv, setSv] = useState<Status>('idle');
  const [svError, setSvError] = useState('');
  const [ol, setOl] = useState<Status>('idle');
  const [olError, setOlError] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');

  const finish = () => { markSetupDone(); setTimeout(onReady, 700); };
  const skip = () => { markSetupDone(); onClose(); };
  const retryOnly = keySaved && !key.trim();

  // Системная кнопка «Назад» телефона = крестик «Закрыть».
  useEffect(() => onBack(skip), []);

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

  const findOllama = async () => {
    setOl('busy');
    setOlError('');
    try {
      const list = await listOllamaModels();
      setModels(list);
      setModel(pickOllamaModel(list) ?? '');
      if (!list.length) {
        setOl('error');
        setOlError('Ollama запущена, но моделей нет. В командной строке: ollama pull qwen2.5:7b (или qwen2.5:1.5b для слабого ПК), затем нажми «Найти Ollama» ещё раз.');
        return;
      }
      setOl('idle');
    } catch {
      setModels([]);
      setOl('error');
      setOlError('Ollama на этом ПК не отвечает. Установи её с сайта ollama.com/download, запусти, выполни ollama pull qwen2.5:7b и нажми «Найти Ollama» ещё раз.');
    }
  };

  const useOllama = async () => {
    if (!model || ol === 'busy') return;
    setOl('busy');
    setOlError('');
    try {
      if (aiGateway.getProvider('ollama')) {
        await aiGateway.updateProvider('ollama', { model, enabled: true });
      } else {
        await aiGateway.addProvider({ id: 'ollama', name: '★ Светлана Локальная (Ollama / Offline)', type: 'offline', endpoint: OLLAMA, model, enabled: true });
      }
      aiGateway.setActiveProvider('ollama');
      await aiGateway.chat([{ role: 'user', content: PING }], { max_tokens: 50 }, 'ollama');
      setOl('ok');
      finish();
    } catch (e) {
      setOl('error');
      setOlError(errorText(e));
    }
  };

  const statusLine = (s: Status, err: string, okText: string) => (
    <>
      {s === 'ok' && <p className="text-xs text-emerald-400 flex items-center gap-1.5 mt-2"><CheckCircle2 className="w-4 h-4" />{okText}</p>}
      {s === 'error' && <p className="text-xs text-rose-300 flex items-start gap-1.5 mt-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{err}</p>}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-white p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-pink-400" />Добро пожаловать в Светлану 2.0</h2>
            <p className="text-sm text-slate-400 mt-1">Выбери, через какой ИИ Светлана будет отвечать. Это можно поменять потом во вкладке «Модели ИИ».</p>
          </div>
          <button onClick={skip} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400" title="Закрыть" aria-label="Закрыть"><X className="w-5 h-5" /></button>
        </div>

        <section className="rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4 mb-4">
          <h3 className="font-semibold flex items-center gap-2"><Key className="w-4 h-4 text-indigo-300" />★ Светлана Сервер (рекомендуется)</h3>
          <p className="text-xs text-slate-400 mt-1">Единая обученная Светлана на мир-самозанятых.рф, полный режим. Нужен ключ Светланы, который вы получили от владельца сервера.
            {keyStorageHint(platform)}
          </p>
          <div className="flex gap-2 mt-3">
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connectServer()}
              placeholder={keySaved ? 'ключ сохранён (можно вставить другой)' : 'ключ Светланы'}
              autoComplete="off"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
              disabled={sv === 'busy'}
            />
            <button
              onClick={connectServer}
              disabled={(!key.trim() && !keySaved) || sv === 'busy'}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
            >
              {sv === 'busy' && <Loader2 className="w-4 h-4 animate-spin" />}{retryOnly ? 'Повторить проверку' : 'Подключить'}
            </button>
          </div>
          {statusLine(sv, svError, 'Светлана ответила. Открываю чат…')}
        </section>

        {/* Ollama работает на компьютере; в телефоне её нет. */}
        {!android && (
          <section className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 mb-4">
            <h3 className="font-semibold flex items-center gap-2"><HardDrive className="w-4 h-4 text-cyan-300" />Без интернета: локальная модель через Ollama</h3>
            <p className="text-xs text-slate-400 mt-1">Переписка не покидает компьютер. Нужна установленная Ollama (ollama.com/download) и скачанная модель, например «ollama pull qwen2.5:7b».</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={findOllama}
                disabled={ol === 'busy'}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-sm flex items-center gap-2"
              >
                {ol === 'busy' && !models.length && <Loader2 className="w-4 h-4 animate-spin" />}Найти Ollama
              </button>
              {models.length > 0 && (
                <>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm"
                  >
                    {models.map(m => <option key={m} value={m} className="bg-slate-900">{m}</option>)}
                  </select>
                  <button
                    onClick={useOllama}
                    disabled={!model || ol === 'busy'}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
                  >
                    {ol === 'busy' && <Loader2 className="w-4 h-4 animate-spin" />}Использовать
                  </button>
                </>
              )}
            </div>
            {statusLine(ol, olError, 'Локальная модель ответила. Открываю чат…')}
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => { markSetupDone(); onOpenProviders(); }} className="text-sm text-indigo-300 hover:text-indigo-200">Другие ИИ (OpenAI, Claude, Groq, DeepSeek…) →</button>
          <button onClick={skip} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm">Пока пропустить</button>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">Команды CRM («Сводка CRM») работают и без ИИ. Мастер можно открыть снова кнопкой «Настройка».</p>
      </div>
    </div>
  );
}
