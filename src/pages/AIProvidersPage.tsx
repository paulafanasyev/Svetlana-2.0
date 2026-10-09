import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { aiGateway, type AIProvider } from '../services/AIGateway';
import {
  Cpu, Server, Settings, Key, Zap, Cloud, HardDrive,
  TestTube, AlertCircle, CheckCircle2, X, Plus, Trash2,
  Loader2, Download, Terminal, RefreshCw, Check
} from 'lucide-react';

// ==================== PRESET PROVIDERS ====================
const PRESET_PROVIDERS: Omit<AIProvider, 'enabled' | 'apiKey'>[] = [
  // Offline Local Engines
  { id: 'ollama', name: '★ Светлана Локальная (Ollama)', type: 'offline', endpoint: 'http://127.0.0.1:11434', model: 'svetlana:latest' },
  { id: 'lmstudio', name: 'LM Studio Local Server', type: 'offline', endpoint: 'http://127.0.0.1:1234', model: 'local-model' },
  { id: 'llamacpp', name: 'llama.cpp Server', type: 'offline', endpoint: 'http://127.0.0.1:8080', model: 'local-model' },
  { id: 'vllm', name: 'vLLM Local Server', type: 'offline', endpoint: 'http://127.0.0.1:8000', model: 'local-model' },
  // Online Cloud APIs
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

// ==================== CONFIG MODAL ====================
function ConfigModal({ provider, onSave, onClose }: {
  provider: Omit<AIProvider, 'enabled'> & { enabled?: boolean };
  onSave: (p: AIProvider) => void;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState(provider.apiKey || '');
  const [endpoint, setEndpoint] = useState(provider.endpoint);
  const [model, setModel] = useState(provider.model);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');

    const tempProvider: AIProvider = {
      ...provider,
      apiKey,
      endpoint,
      model,
      enabled: true,
    };

    try {
      aiGateway.addProvider(tempProvider);
      const success = await aiGateway.testConnection(provider.id);
      if (success) {
        setTestStatus('success');
      } else {
        setTestStatus('error');
        setTestError('Не удалось подключиться к серверу');
      }
      aiGateway.removeProvider(provider.id);
    } catch (err: any) {
      setTestStatus('error');
      setTestError(err.message || 'Ошибка подключения');
    }
  };

  const handleSave = () => {
    onSave({
      ...provider,
      apiKey,
      endpoint,
      model,
      enabled: true,
    });
  };

  const models = MODEL_OPTIONS[provider.id] || [provider.model];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-lg glass-card rounded-2xl p-6 border border-slate-700 bg-slate-900 text-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold">{provider.name}</h3>
            <p className="text-xs text-slate-400">{provider.type === 'offline' ? 'Офлайн / Локальный движок' : 'Внешний облачный ИИ'}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {provider.type === 'online' && (
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Ключ API (API Key)</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-slate-300 mb-1 block">Адрес эндпоинта (URL)</label>
            <div className="relative">
              <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-slate-300 mb-1 block">Модель</label>
            <div className="flex gap-2">
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
              >
                {models.map(m => (
                  <option key={m} value={m} className="bg-slate-900">{m}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleTest}
            disabled={testStatus === 'testing'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-750 text-sm font-medium transition-colors"
          >
            {testStatus === 'testing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Проверка соединения...
              </>
            ) : testStatus === 'success' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Соединение успешно!</span>
              </>
            ) : testStatus === 'error' ? (
              <>
                <AlertCircle className="w-4 h-4 text-rose-400" />
                <span className="text-rose-400">{testError}</span>
              </>
            ) : (
              <>
                <TestTube className="w-4 h-4" />
                Проверить соединение
              </>
            )}
          </button>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-sm"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
          >
            Сохранить и включить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== MAIN PAGE ====================
export default function AIProvidersPage() {
  const [activeTab, setActiveTab] = useState<'offline' | 'online'>('offline');
  const [providers, setProviders] = useState<AIProvider[]>(aiGateway.getAllProviders());
  const [configuringProvider, setConfiguringProvider] = useState<(Omit<AIProvider, 'enabled'> & { enabled?: boolean }) | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setProviders(aiGateway.getAllProviders());
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const activeProvider = aiGateway.getActiveProvider();

  const handleCopy = (command: string) => {
    navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    setTimeout(() => setCopiedCommand(null), 2000);
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

  const handleSaveProvider = (provider: AIProvider) => {
    aiGateway.addProvider(provider);
    aiGateway.setActiveProvider(provider.id);
    setProviders(aiGateway.getAllProviders());
    setConfiguringProvider(null);
  };

  const handleRemoveProvider = (id: string) => {
    aiGateway.removeProvider(id);
    setProviders(aiGateway.getAllProviders());
  };

  return (
    <div className="space-y-6 text-white max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-7 h-7 text-indigo-400" />
            Модели и Провайдеры ИИ
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Переключайтесь между локальными офлайн-моделями на вашем ПК и мощными облачными ИИ.
          </p>
        </div>
      </div>

      {/* Active Provider Card */}
      {activeProvider && (
        <div className="glass-card rounded-2xl p-5 border border-emerald-500/30 bg-emerald-950/20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Активный ИИ
                </span>
                <span className="text-xs text-slate-400">{activeProvider.type === 'offline' ? 'Локальный (без интернета)' : 'Облачный API'}</span>
              </div>
              <h3 className="text-lg font-bold text-white mt-0.5">{activeProvider.name}</h3>
              <p className="text-xs font-mono text-slate-300">Модель: {activeProvider.model} • {activeProvider.endpoint}</p>
            </div>
          </div>
          <button
            onClick={() => setConfiguringProvider(activeProvider)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 flex items-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" /> Настроить
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('offline')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'offline'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          Локальные модели (Офлайн)
        </button>
        <button
          onClick={() => setActiveTab('online')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'online'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-lg shadow-purple-500/10'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Cloud className="w-4 h-4" />
          Внешние облачные ИИ (OpenAI, Claude, Groq...)
        </button>
      </div>

      {/* Tab 1: Offline Models Catalog */}
      {activeTab === 'offline' && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold flex items-center gap-2 text-cyan-300">
                <Download className="w-4 h-4" />
                Каталог локальных моделей для скачивания на Windows
              </h3>
              <span className="text-xs text-slate-400">Работают через Ollama / LM Studio без отправки данных в сеть</span>
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
                          <Check className="w-3 h-3" /> Выбрана
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
                    >
                      <span className="truncate">{m.command}</span>
                      {copiedCommand === m.command ? (
                        <span className="text-emerald-400 text-[10px] font-sans shrink-0 ml-1">Скопировано!</span>
                      ) : (
                        <Terminal className="w-3.5 h-3.5 text-slate-500 shrink-0 ml-1" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        const ollamaProvider = providers.find(p => p.id === 'ollama');
                        if (ollamaProvider) {
                          aiGateway.updateProvider('ollama', { model: m.id, enabled: true });
                          aiGateway.setActiveProvider('ollama');
                          setProviders(aiGateway.getAllProviders());
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
                    className={`glass-card rounded-xl p-4 border flex items-center justify-between ${
                      isSelected
                        ? 'border-emerald-500/40 bg-emerald-950/10'
                        : 'border-slate-800 bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400">
                        <HardDrive className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">{p.name}</h4>
                        <p className="text-xs font-mono text-slate-400">{configured?.model || p.model} • {configured?.endpoint || p.endpoint}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {configured && (
                        <button
                          onClick={() => handleSelectActive(p.id)}
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
                      >
                        <Settings className="w-4 h-4" />
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
      {activeTab === 'online' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {PRESET_PROVIDERS.filter(p => p.type === 'online').map(p => {
              const configured = providers.find(ep => ep.id === p.id);
              const isSelected = activeProvider?.id === p.id;

              return (
                <div
                  key={p.id}
                  className={`glass-card rounded-xl p-4 border flex flex-col justify-between ${
                    isSelected
                      ? 'border-purple-500/40 bg-purple-950/20 shadow-md shadow-purple-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                        <Cloud className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">{p.name}</h4>
                        <span className="text-[11px] font-mono text-slate-400">{configured?.model || p.model}</span>
                      </div>
                    </div>
                    {configured?.apiKey ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Ключ есть</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Не настроен</span>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-slate-800">
                    {configured && (
                      <button
                        onClick={() => handleSelectActive(p.id)}
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
                      <Settings className="w-3.5 h-3.5" />
                      {configured ? 'Изменить' : 'Подключить'}
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
