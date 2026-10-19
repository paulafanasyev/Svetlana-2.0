import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { aiGateway, GIGACHAT_WEB_ONLY, CUSTOM_AI_ID, type AIProvider } from '../services/AIGateway';
import { explainAiError } from '../services/AiErrors';
import { SVETLANA_CORE_ORIGIN, SVETLANA_CORE_MODEL } from '../services/SvetlanaCore';
import { isNativeApp } from '../services/security/NativeBridge';
import { isAndroidApp, secureStoreName } from '../platform';
import { onBack } from '../services/BackStack';
import {
  Cpu, Server, Settings, Key, Zap, Cloud, HardDrive,
  TestTube, AlertCircle, CheckCircle2, X,
  Loader2, Download, Terminal, Check
} from 'lucide-react';

// Ошибки нативной части (Windows и Android) приходят строкой, остальные — Error. Технические тексты — на понятный русский.
const errorText = (e: unknown): string => {
  const m = (e as { message?: unknown } | null)?.message;
  const s = typeof m === 'string' && m ? m : String(e ?? '');
  return explainAiError(s);
};

/** Где хранится ключ на этой платформе. */
export function keyStoredText(): string {
  return isNativeApp() ? `Ключ хранится в ${secureStoreName()}.` : 'Ключ хранится в зашифрованном хранилище браузера.';
}

/** Подсказка к адресу локальной модели на телефоне: компьютер в домашней сети. */
export const PHONE_LOCAL_HINT = 'На телефоне укажите адрес компьютера в домашней Wi‑Fi сети, например http://192.168.1.10:11434 (IP видно в Windows: «Параметры → Сеть»). На компьютере Ollama должна слушать сеть: setx OLLAMA_HOST 0.0.0.0 и перезапустить Ollama. При первом запросе телефон спросит разрешение.';

/** Как получить бесплатный ключ GigaChat. */
export const GIGACHAT_KEY_HINT = 'Бесплатно для физлиц: откройте developers.sber.ru/studio → войдите через СберID → создайте проект «GigaChat API» → «Настройки API» → «Получить ключ» и скопируйте «Ключ авторизации» сюда. На бесплатном тарифе самый большой запас у модели GigaChat-2.';

/** Подсказка к своему ИИ (только Android). */
export const CUSTOM_AI_HINT = 'Подойдёт любой OpenAI-совместимый сервер по https (свой сервер, прокси, Together, Fireworks, YandexGPT через совместимый шлюз и т.п.). Укажите базовый адрес, например https://api.example.com/v1, Светлана сама добавит /chat/completions. Телефон покажет полный адрес и спросит разрешение. Чтобы сменить адрес, ключ нужно ввести заново.';

// ==================== PRESET PROVIDERS ====================
const PRESET_PROVIDERS: Omit<AIProvider, 'enabled' | 'apiKey'>[] = [
  // Offline Local Engines
  { id: 'ollama', name: '★ Светлана Локальная (Ollama)', type: 'offline', endpoint: 'http://127.0.0.1:11434', model: 'svetlana:latest' },
  { id: 'lmstudio', name: 'LM Studio Local Server', type: 'offline', endpoint: 'http://127.0.0.1:1234', model: 'local-model' },
  { id: 'llamacpp', name: 'llama.cpp Server', type: 'offline', endpoint: 'http://127.0.0.1:8080', model: 'local-model' },
  { id: 'vllm', name: 'vLLM Local Server', type: 'offline', endpoint: 'http://127.0.0.1:8000', model: 'local-model' },
  // Online Cloud APIs
  // Единая Светлана на своём сервере: одна обученная ИИ для всех сайтов, здесь — полный режим (код и команда).
  { id: 'svetlana', name: '★ Светлана Сервер (единая)', type: 'online', endpoint: SVETLANA_CORE_ORIGIN, model: SVETLANA_CORE_MODEL },
  // Свой внешний ИИ: любой OpenAI-совместимый https-сервер. Только в приложении Android.
  { id: CUSTOM_AI_ID, name: 'Свой ИИ (OpenAI-совместимый)', type: 'online', endpoint: 'https://', model: '' },
  // Шлюзы ко многим моделям с одним ключом (GPT, Claude, Gemini, DeepSeek, Kimi, Qwen, GLM…).
  { id: 'anymodel', name: 'AnyModel (GPT, Claude, Gemini дёшево)', type: 'online', endpoint: 'https://anymodel.org/v1', model: 'gpt-5' },
  { id: 'opencode', name: 'OpenCode Zen (модели для кода, есть бесплатные)', type: 'online', endpoint: 'https://opencode.ai/zen/v1', model: 'kimi-k2.5' },
  // GigaChat от Сбера: бесплатный тариф для физлиц, хорошо знает русский. Работает в приложениях Windows и Android.
  { id: 'gigachat', name: 'GigaChat (Сбер, бесплатно)', type: 'online', endpoint: 'https://api.giga.chat/v1', model: 'GigaChat-2' },
  { id: 'openai', name: 'OpenAI (GPT-4o)', type: 'online', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', name: 'Anthropic (Claude 3.5)', type: 'online', endpoint: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022' },
  { id: 'groq', name: 'Groq (Ультрабыстрый)', type: 'online', endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.1-70b-versatile' },
  { id: 'deepseek', name: 'DeepSeek V3 / R1', type: 'online', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'google', name: 'Google Gemini Pro', type: 'online', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
  { id: 'openrouter', name: 'OpenRouter (Любые модели)', type: 'online', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'mistral', name: 'Mistral AI', type: 'online', endpoint: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
];

const POPULAR_OFFLINE_MODELS = [
  { id: 'svetlana:latest', name: '★ Светлана 2.0 (Обученная)', size: '2.4 GB', desc: 'Официальная русскоязычная модель с поддержкой управления Hands', command: 'ollama run svetlana:latest' },
  { id: 'gemma:2b', name: 'Google Gemma 2 (2B)', size: '1.6 GB', desc: 'Ультралегкая модель Google, работает даже на слабых ПК и ноутбуках', command: 'ollama run gemma:2b' },
  { id: 'qwen2.5:1.5b', name: 'Qwen 2.5 (1.5B)', size: '1.0 GB', desc: 'Отличный русский язык, минимальное потребление оперативной памяти', command: 'ollama run qwen2.5:1.5b' },
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 (7B)', size: '4.7 GB', desc: 'Высокое качество рассуждений, рекомендуется видеокарта 6-8GB VRAM', command: 'ollama run qwen2.5:7b' },
  { id: 'llama3.2:3b', name: 'Meta Llama 3.2 (3B)', size: '2.0 GB', desc: 'Быстрая сбалансированная модель от Meta для повседневных задач', command: 'ollama run llama3.2:3b' },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1 (8B)', size: '4.9 GB', desc: 'Локальная модель глубоких рассуждений и написания программного кода', command: 'ollama run deepseek-r1:8b' },
];

const MODEL_OPTIONS: Record<string, string[]> = {
  svetlana: [SVETLANA_CORE_MODEL],
  anymodel: ['gpt-5', 'gpt-5.5', 'claude-sonnet-4.5', 'gemini-2.5-pro', 'deepseek-v3', 'kimi-k2', 'qwen3-coder', 'grok-4'],
  opencode: ['kimi-k2.5', 'glm-5', 'qwen3-coder', 'minimax-m2.5', 'big-pickle', 'kimi-k2.5-free', 'minimax-m2.5-free'],
  gigachat: ['GigaChat-2', 'GigaChat-2-Pro', 'GigaChat-2-Max'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash'],
  mistral: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
  groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-r1'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['svetlana:latest', 'gemma:2b', 'qwen2.5:1.5b', 'qwen2.5:7b', 'llama3.2:3b', 'deepseek-r1:8b'],
  lmstudio: ['local-model'],
  llamacpp: ['local-model'],
  vllm: ['local-model'],
};

/** GigaChat работает только в приложениях (на сайте браузер к нему не подключится). */
const appsOnly = (id: string) => id === 'gigachat' && !isNativeApp();

/** Свой ИИ: адрес https и непустая модель, иначе проверять нечего. */
export function customReady(endpoint: string, model: string): boolean {
  return /^https:\/\/[^\s/]+/i.test(endpoint.trim()) && model.trim().length > 0;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ==================== CONFIG MODAL ====================
// Клавиатура: фокус сразу в первом поле, Tab не выходит за окно, Escape = «Отмена», после закрытия фокус возвращается
// на кнопку, которой окно открыли. Щелчок мимо окна закрывает его, только если ничего не введено (введённый ключ не теряется).
function ConfigModal({ provider, onSave, onClose }: {
  provider: Omit<AIProvider, 'enabled'> & { enabled?: boolean };
  /** alreadySaved: настройки и ключ уже записаны при проверке — повторно не спрашиваем. */
  onSave: (p: AIProvider, alreadySaved: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState(provider.apiKey || '');
  const [endpoint, setEndpoint] = useState(provider.endpoint);
  const [model, setModel] = useState(provider.model);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isCore = provider.id === 'svetlana';
  const isGiga = provider.id === 'gigachat';
  const isCustom = provider.id === CUSTOM_AI_ID;
  const blocked = appsOnly(provider.id) || (isCustom && !isAndroidApp());
  const phoneLocal = isAndroidApp() && provider.type === 'offline';
  const customIncomplete = isCustom && !customReady(endpoint, model);
  const dirty = apiKey !== (provider.apiKey || '') || endpoint !== provider.endpoint || model !== provider.model;
  const titleId = `provider-title-${provider.id}`;

  // Системная кнопка «Назад» телефона = «Отмена».
  useEffect(() => onBack(onClose), []);

  // Фокус в первое доступное поле; после закрытия — обратно на кнопку, которой открыли окно.
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    const root = dialogRef.current;
    const first = root?.querySelector<HTMLElement>('input:not([disabled]):not([readonly]), select:not([disabled])')
      ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => { if (opener && opener.isConnected) opener.focus(); };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!saving) onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const firstItem = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstItem || !dialogRef.current.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) { e.preventDefault(); firstItem.focus(); }
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');

    const tempProvider: AIProvider = {
      ...provider,
      apiKey,
      endpoint: endpoint.trim(),
      model: model.trim(),
      enabled: true,
    };

    try {
      // Проверка сохраняет настройки и ЖДЁТ записи ключа (в приложении — после окна подтверждения),
      // иначе пробный запрос уходил бы ещё без ключа.
      await aiGateway.addProvider(tempProvider);
      setSaved(true);
      await aiGateway.chat([{ role: 'user', content: 'Привет! Это проверка связи.' }], { max_tokens: 50 }, provider.id);
      setTestStatus('success');
    } catch (err: unknown) {
      setTestStatus('error');
      setTestError(errorText(err));
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        ...provider,
        apiKey,
        endpoint: endpoint.trim(),
        model: model.trim(),
        enabled: true,
      }, saved);
    } catch (err: unknown) {
      setTestStatus('error');
      setTestError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const models = MODEL_OPTIONS[provider.id] || [provider.model];
  const statusText = testStatus === 'testing' ? 'Проверяю соединение' : testStatus === 'success' ? 'Соединение успешно' : saving ? 'Сохраняю' : '';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => { if (!dirty && !saving) onClose(); }}
    >
      <motion.div
        ref={dialogRef}
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto glass-card rounded-2xl p-5 sm:p-6 border border-slate-700 bg-slate-900 text-white"
        onClick={e => e.stopPropagation()}
      >
        <span role="status" className="sr-only">{statusText}</span>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 id={titleId} className="text-lg font-semibold">{provider.name}</h3>
            <p className="text-xs text-slate-400">{provider.type === 'offline' ? (phoneLocal ? 'Локальная модель на вашем компьютере (домашняя сеть)' : 'Офлайн / Локальный движок') : isCore ? 'Единая Светлана на своём сервере (мир-самозанятых.рф)' : isGiga ? 'Облачный ИИ Сбера, бесплатный тариф' : isCustom ? 'Ваш внешний ИИ по своему адресу' : 'Внешний облачный ИИ'}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400" aria-label="Закрыть">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {appsOnly(provider.id) && (
          <p data-testid="gigachat-apps-only" className="mb-4 rounded-lg p-3 border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200">{GIGACHAT_WEB_ONLY}</p>
        )}
        {isCustom && !isAndroidApp() && (
          <p data-testid="custom-ai-android-only" className="mb-4 rounded-lg p-3 border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200">Свой ИИ пока подключается только в приложении Android.</p>
        )}

        <div className="space-y-4">
          {isCustom && (
            <p data-testid="custom-ai-hint" className="rounded-lg p-3 border border-purple-500/30 bg-purple-950/20 text-xs text-purple-100">{CUSTOM_AI_HINT}</p>
          )}

          {provider.type === 'online' && (
            <div>
              <label htmlFor="provider-key" className="text-sm text-slate-300 mb-1 block">{isCore ? 'Ключ Светланы' : isGiga ? 'Ключ авторизации (Authorization key)' : 'Ключ API (API Key)'}</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                <input
                  id="provider-key"
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setSaved(false); }}
                  placeholder={isCore ? 'ключ Светланы' : isGiga ? 'ключ авторизации из Studio' : isCustom ? 'ключ (если сервер его требует)' : 'sk-...'}
                  autoComplete="off"
                  disabled={blocked}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
              </div>
              {isGiga && (
                <p data-testid="gigachat-key-hint" className="text-xs text-slate-300 mt-1.5">
                  {GIGACHAT_KEY_HINT}{' '}
                  <a href="https://developers.sber.ru/studio" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline">Открыть Studio</a>
                </p>
              )}
              <p data-testid="key-storage" className="text-xs text-slate-400 mt-1.5">
                {isCore ? 'Ключ выдаёт владелец сервера Светланы. ' : ''}{keyStoredText()}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="provider-endpoint" className="text-sm text-slate-300 mb-1 block">{phoneLocal ? 'Адрес компьютера с моделью' : isCustom ? 'Адрес сервера (https)' : 'Адрес эндпоинта (URL)'}</label>
            <div className="relative">
              <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
              <input
                id="provider-endpoint"
                type="text"
                value={endpoint}
                onChange={e => { setEndpoint(e.target.value); setSaved(false); }}
                readOnly={provider.type === 'online' && !isCustom}
                disabled={isCustom && blocked}
                inputMode={phoneLocal || isCustom ? 'url' : undefined}
                autoCapitalize={isCustom ? 'off' : undefined}
                spellCheck={isCustom ? false : undefined}
                placeholder={phoneLocal ? 'http://192.168.1.10:11434' : isCustom ? 'https://api.example.com/v1' : undefined}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </div>
            {phoneLocal && <p data-testid="phone-local-hint" className="text-xs text-slate-400 mt-1.5">{PHONE_LOCAL_HINT}</p>}
          </div>

          <div>
            <label htmlFor="provider-model" className="text-sm text-slate-300 mb-1 block">Модель</label>
            <div className="flex gap-2">
              {isCustom ? (
                <input
                  id="provider-model"
                  type="text"
                  value={model}
                  onChange={e => { setModel(e.target.value); setSaved(false); }}
                  disabled={blocked}
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="например gpt-4o-mini или llama-3.1-70b"
                  className="flex-1 min-w-0 px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
              ) : (
                <select
                  id="provider-model"
                  value={model}
                  onChange={e => { setModel(e.target.value); setSaved(false); }}
                  className="flex-1 min-w-0 px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                >
                  {models.map(m => (
                    <option key={m} value={m} className="bg-slate-900">{m}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <button
            onClick={handleTest}
            disabled={testStatus === 'testing' || saving || blocked || customIncomplete}
            aria-busy={testStatus === 'testing'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-750 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {testStatus === 'testing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Проверка соединения...
              </>
            ) : testStatus === 'success' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                <span className="text-emerald-400">Соединение успешно!</span>
              </>
            ) : testStatus === 'error' ? (
              <>
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                <span className="text-rose-400 text-left" role="alert">{testError}</span>
              </>
            ) : (
              <>
                <TestTube className="w-4 h-4" aria-hidden="true" />
                Проверить соединение
              </>
            )}
          </button>
          <p className="text-[11px] text-slate-400">
            {testStatus === 'error'
              ? 'Связи нет. Исправьте ключ или адрес и проверьте ещё раз. Сохранить можно и так, но тогда Светлана может не отвечать.'
              : 'Проверка сразу сохраняет настройки и ключ.'}
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-sm"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || testStatus === 'testing' || blocked || customIncomplete}
            aria-busy={saving}
            className={`flex-1 px-4 py-2.5 rounded-lg disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 ${testStatus === 'error' ? 'bg-amber-700 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {testStatus === 'error' ? 'Сохранить без проверки' : 'Сохранить и включить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== MAIN PAGE ====================
export default function AIProvidersPage() {
  // На телефоне локальные модели тоже есть: они работают на компьютере в домашней сети.
  const android = isAndroidApp();
  const [activeTab, setActiveTab] = useState<'offline' | 'online'>(android ? 'online' : 'offline');
  const [providers, setProviders] = useState<AIProvider[]>(aiGateway.getAllProviders());
  const [configuringProvider, setConfiguringProvider] = useState<(Omit<AIProvider, 'enabled'> & { enabled?: boolean }) | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setProviders(aiGateway.getAllProviders());
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Таймер подсказки «Скопировано!» не переживает страницу.
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const activeProvider = aiGateway.getActiveProvider();
  const tab = activeTab;

  const handleCopy = (command: string) => {
    void navigator.clipboard?.writeText(command).catch(() => undefined);
    setCopiedCommand(command);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => { copyTimer.current = null; setCopiedCommand(null); }, 2000);
  };

  const handleSelectActive = (id: string) => {
    aiGateway.setActiveProvider(id);
    setProviders(aiGateway.getAllProviders());
  };

  const handleAddPreset = (presetId: string) => {
    const preset = PRESET_PROVIDERS.find(p => p.id === presetId);
    if (preset) {
      setConfiguringProvider({ ...preset, apiKey: '' });
    }
  };

  const handleSaveProvider = async (provider: AIProvider, alreadySaved: boolean) => {
    if (!alreadySaved) await aiGateway.addProvider(provider);
    aiGateway.setActiveProvider(provider.id);
    setProviders(aiGateway.getAllProviders());
    setConfiguringProvider(null);
  };

  return (
    <div className="space-y-6 text-white max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-7 h-7 text-indigo-400" aria-hidden="true" />
            Модели и Провайдеры ИИ
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {android
              ? 'На телефоне Светлана отвечает через свой сервер, облачные ИИ (в том числе бесплатный GigaChat и ваш собственный ИИ) или локальную модель на вашем компьютере в домашней сети (Ollama, LM Studio).'
              : 'Переключайтесь между локальными офлайн-моделями на вашем ПК и мощными облачными ИИ.'}
          </p>
        </div>
      </div>

      {/* Active Provider Card */}
      {activeProvider && (
        <div className="glass-card rounded-2xl p-5 border border-emerald-500/30 bg-emerald-950/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 shrink-0 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-emerald-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Активный ИИ
                </span>
                <span className="text-xs text-slate-400">{activeProvider.type === 'offline' ? (android ? 'Локальный (компьютер в домашней сети)' : 'Локальный (без интернета)') : activeProvider.id === CUSTOM_AI_ID ? 'Свой ИИ' : 'Облачный API'}</span>
              </div>
              <h3 className="text-lg font-bold text-white mt-0.5">{activeProvider.name}</h3>
              <p className="text-xs font-mono text-slate-300 break-all">Модель: {activeProvider.model} • {activeProvider.endpoint}</p>
            </div>
          </div>
          <button
            onClick={() => setConfiguringProvider(activeProvider)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 flex items-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" aria-hidden="true" /> Настроить
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'offline'}
          onClick={() => setActiveTab('offline')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            tab === 'offline'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <HardDrive className="w-4 h-4" aria-hidden="true" />
          {android ? 'Локальные модели (на компьютере)' : 'Локальные модели (Офлайн)'}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'online'}
          onClick={() => setActiveTab('online')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            tab === 'online'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-lg shadow-purple-500/10'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Cloud className="w-4 h-4" aria-hidden="true" />
          {android ? 'Светлана Сервер и облачные ИИ' : 'Внешние облачные ИИ (GigaChat, OpenAI, Claude...)'}
        </button>
      </div>

      {/* Tab 1: Offline Models Catalog */}
      {tab === 'offline' && (
        <div className="space-y-6">
          {android && (
            <div data-testid="phone-local-note" className="rounded-xl p-4 border border-cyan-500/30 bg-cyan-950/20 text-sm text-cyan-100 flex items-start gap-2">
              <HardDrive className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{PHONE_LOCAL_HINT}</span>
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-base font-semibold flex items-center gap-2 text-cyan-300">
                <Download className="w-4 h-4" aria-hidden="true" />
                Каталог локальных моделей для компьютера
              </h3>
              <span className="text-xs text-slate-400">Работают через Ollama / LM Studio без отправки данных в интернет</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {POPULAR_OFFLINE_MODELS.map(m => (
                <div
                  key={m.id}
                  className={`glass-card rounded-xl p-5 border transition-all flex flex-col justify-between ${
                    activeProvider?.model === m.id
                      ? 'border-cyan-500/50 bg-cyan-950/20 shadow-md shadow-cyan-500/10'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                        {m.size}
                      </span>
                      {activeProvider?.model === m.id && (
                        <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                          <Check className="w-3 h-3" aria-hidden="true" /> Выбрана
                        </span>
                      )}
                    </div>
                    <h4 className="font-bold text-sm text-white mb-1">{m.name}</h4>
                    <p className="text-xs text-slate-400 leading-relaxed mb-4">{m.desc}</p>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-slate-800/80">
                    <button
                      onClick={() => handleCopy(m.command)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-cyan-300 hover:border-slate-700 transition-colors"
                      title="Нажмите, чтобы скопировать команду"
                      aria-label={`Скопировать команду ${m.command}`}
                    >
                      <span className="truncate">{m.command}</span>
                      {copiedCommand === m.command ? (
                        <span className="text-emerald-400 text-[10px] font-sans shrink-0 ml-1" role="status">Скопировано!</span>
                      ) : (
                        <Terminal className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        const ollamaProvider = providers.find(p => p.id === 'ollama');
                        if (ollamaProvider && !(android && /127\.0\.0\.1|localhost/.test(ollamaProvider.endpoint))) {
                          void aiGateway.updateProvider('ollama', { model: m.id, enabled: true }).catch(e => console.error(e));
                          aiGateway.setActiveProvider('ollama');
                          setProviders(aiGateway.getAllProviders());
                        } else if (ollamaProvider) {
                          // Телефон: сначала нужен адрес компьютера.
                          setConfiguringProvider({ ...ollamaProvider, model: m.id });
                        } else {
                          handleAddPreset('ollama');
                        }
                      }}
                      className="w-full py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-200 border border-cyan-500/40 text-xs font-medium transition-colors"
                    >
                      Использовать в приложении
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Offline Engines List */}
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Подключенные локальные движки</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PRESET_PROVIDERS.filter(p => p.type === 'offline').map(p => {
                const configured = providers.find(ep => ep.id === p.id);
                const isSelected = activeProvider?.id === p.id;

                return (
                  <div
                    key={p.id}
                    className={`glass-card rounded-xl p-4 border flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'border-emerald-500/40 bg-emerald-950/10'
                        : 'border-slate-800 bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400">
                        <HardDrive className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-sm">{p.name}</h4>
                        <p className="text-xs font-mono text-slate-400 truncate">{configured?.model || p.model} • {configured?.endpoint || p.endpoint}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {configured && (
                        <button
                          onClick={() => handleSelectActive(p.id)}
                          aria-pressed={isSelected}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isSelected
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          {isSelected ? 'Активен' : 'Выбрать'}
                        </button>
                      )}
                      <button
                        onClick={() => setConfiguringProvider(configured || { ...p, apiKey: '' })}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                        title="Настройки"
                        aria-label={`Настройки: ${p.name}`}
                      >
                        <Settings className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Online Cloud Providers */}
      {tab === 'online' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {PRESET_PROVIDERS.filter(p => p.type === 'online' && (p.id !== CUSTOM_AI_ID || android)).map(p => {
              const configured = providers.find(ep => ep.id === p.id);
              const isSelected = activeProvider?.id === p.id;
              const blocked = appsOnly(p.id);
              const isCustom = p.id === CUSTOM_AI_ID;

              return (
                <div
                  key={p.id}
                  data-testid={isCustom ? 'custom-ai-card' : undefined}
                  className={`glass-card rounded-xl p-4 border flex flex-col justify-between ${
                    isSelected
                      ? 'border-purple-500/40 bg-purple-950/20 shadow-md shadow-purple-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                        <Cloud className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-sm">{p.name}</h4>
                        <span className="text-[11px] font-mono text-slate-400 break-all">{isCustom ? (configured ? `${configured.model} • ${configured.endpoint}` : 'любой OpenAI-совместимый адрес') : (configured?.model || p.model)}</span>
                      </div>
                    </div>
                    {blocked ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">В приложении</span>
                    ) : isCustom && configured ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Подключён</span>
                    ) : configured?.apiKey ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Ключ есть</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Не настроен</span>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-slate-800">
                    {configured && !blocked && (
                      <button
                        onClick={() => handleSelectActive(p.id)}
                        aria-pressed={isSelected}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isSelected
                            ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        }`}
                      >
                        {isSelected ? 'Активен' : 'Активировать'}
                      </button>
                    )}
                    <button
                      onClick={() => setConfiguringProvider(configured || { ...p, apiKey: '' })}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1"
                    >
                      <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                      {blocked ? 'Подробнее' : configured ? 'Изменить' : 'Подключить'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Config Modal */}
      <AnimatePresence>
        {configuringProvider && (
          <ConfigModal
            provider={configuringProvider}
            onSave={handleSaveProvider}
            onClose={() => setConfiguringProvider(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
