import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { aiGateway, type AIProvider } from '../services/AIGateway';
import {
  Cpu, Server, Settings, Key, Zap, Cloud, HardDrive,
  TestTube, AlertCircle, CheckCircle2, X, Plus, Trash2,
  Loader2, Wifi, WifiOff, ArrowRight
} from 'lucide-react';

// ==================== PRESET PROVIDERS ====================
const PRESET_PROVIDERS: Omit<AIProvider, 'enabled' | 'apiKey'>[] = [
  // Online
  { id: 'openai', name: 'OpenAI', type: 'online', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', name: 'Anthropic', type: 'online', endpoint: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022' },
  { id: 'google', name: 'Google AI', type: 'online', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
  { id: 'mistral', name: 'Mistral AI', type: 'online', endpoint: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { id: 'groq', name: 'Groq', type: 'online', endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.1-70b-versatile' },
  { id: 'openrouter', name: 'OpenRouter', type: 'online', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'deepseek', name: 'DeepSeek', type: 'online', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  // Offline
  { id: 'ollama', name: 'Ollama', type: 'offline', endpoint: 'http://localhost:11434', model: 'llama3.1:8b' },
  { id: 'lmstudio', name: 'LM Studio', type: 'offline', endpoint: 'http://localhost:1234', model: 'local-model' },
  { id: 'llamacpp', name: 'llama.cpp', type: 'offline', endpoint: 'http://localhost:8080', model: 'local-model' },
  { id: 'localai', name: 'LocalAI', type: 'offline', endpoint: 'http://localhost:8080', model: 'gpt-4' },
  { id: 'vllm', name: 'vLLM', type: 'offline', endpoint: 'http://localhost:8000', model: 'local-model' },
  { id: 'textgenwebui', name: 'Text Gen WebUI', type: 'offline', endpoint: 'http://localhost:5000', model: 'local-model' },
];

const MODEL_OPTIONS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
  mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mistral-nemo'],
  groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro', 'meta-llama/llama-3-70b'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  ollama: ['llama3.1:70b', 'llama3.1:8b', 'mistral:7b', 'phi3:14b', 'qwen2:7b', 'codellama:13b'],
  lmstudio: ['local-model'],
  llamacpp: ['local-model'],
  localai: ['gpt-4', 'gpt-3.5-turbo'],
  vllm: ['local-model'],
  textgenwebui: ['local-model'],
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

    // Save temporarily for testing
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
        setTestError('Connection failed');
      }
      aiGateway.removeProvider(provider.id);
    } catch (err: any) {
      setTestStatus('error');
      setTestError(err.message || 'Unknown error');
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-lg glass-card rounded-2xl p-6 border border-sv-border"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold">{provider.name}</h3>
            <p className="text-xs text-sv-muted">{provider.type === 'offline' ? 'Offline / Local' : 'Online / Cloud API'}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-sv-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {provider.type === 'online' && (
            <div>
              <label className="text-sm text-sv-muted mb-1 block">API Key</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sv-muted" />
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={provider.id === 'ollama' ? 'Not required' : 'sk-...'}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <p className="text-xs text-sv-muted mt-1">
                {provider.id === 'openai' && 'Get key at platform.openai.com/api-keys'}
                {provider.id === 'anthropic' && 'Get key at console.anthropic.com'}
                {provider.id === 'google' && 'Get key at aistudio.google.com'}
                {provider.id === 'groq' && 'Get key at console.groq.com'}
                {provider.id === 'openrouter' && 'Get key at openrouter.ai/keys'}
                {provider.id === 'deepseek' && 'Get key at platform.deepseek.com'}
                {provider.id === 'mistral' && 'Get key at console.mistral.ai'}
              </p>
            </div>
          )}

          <div>
            <label className="text-sm text-sv-muted mb-1 block">Endpoint URL</label>
            <div className="relative">
              <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sv-muted" />
              <input
                type="text"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-mono focus:outline-none focus:border-indigo-500/50"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-sv-muted mb-1 block">Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50"
            >
              {models.map(m => (
                <option key={m} value={m} className="bg-sv-darker">{m}</option>
              ))}
            </select>
            {provider.id === 'ollama' && (
              <p className="text-xs text-sv-muted mt-1">
                Install Ollama: <code className="text-cyan-400">curl fsSL https://ollama.com/install.sh | sh</code>
                <br />Pull model: <code className="text-cyan-400">ollama pull llama3.1:8b</code>
              </p>
            )}
          </div>

          {/* Test Connection */}
          <button
            onClick={handleTest}
            disabled={testStatus === 'testing'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors"
          >
            {testStatus === 'testing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testing connection...
              </>
            ) : testStatus === 'success' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Connection successful!</span>
              </>
            ) : testStatus === 'error' ? (
              <>
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-red-400">{testError || 'Connection failed'}</span>
              </>
            ) : (
              <>
                <TestTube className="w-4 h-4" />
                Test Connection
              </>
            )}
          </button>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
          >
            Save & Enable
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== PROVIDER CARD ====================
function ProviderCard({ provider, onConfigure, onRemove, isActive }: {
  provider: AIProvider;
  onConfigure: () => void;
  onRemove: () => void;
  isActive: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card rounded-xl p-5 transition-all hover:border-indigo-500/30 ${
        isActive ? 'border-emerald-500/30 shadow-lg shadow-emerald-500/5' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${provider.type === 'offline' ? 'bg-cyan-500/10' : 'bg-purple-500/10'}`}>
            {provider.type === 'offline' ? <HardDrive className="w-5 h-5 text-cyan-400" /> : <Cloud className="w-5 h-5 text-purple-400" />}
          </div>
          <div>
            <h3 className="font-semibold">{provider.name}</h3>
            <p className="text-xs text-sv-muted font-mono">{provider.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Zap className="w-3 h-3" /> Active
            </span>
          )}
          <button onClick={onConfigure} className="p-1.5 rounded-lg hover:bg-white/10 text-sv-muted">
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={onRemove} className="p-1.5 rounded-lg hover:bg-red-500/10 text-sv-muted hover:text-red-400">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className={`px-2 py-0.5 rounded ${provider.type === 'offline' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'}`}>
          {provider.type === 'offline' ? 'Local' : 'Cloud'}
        </span>
        <span className="text-sv-muted font-mono truncate">{provider.endpoint}</span>
      </div>
    </motion.div>
  );
}

// ==================== MAIN PAGE ====================
export default function AIProvidersPage() {
  const [activeTab, setActiveTab] = useState<'online' | 'offline'>('online');
  const [providers, setProviders] = useState<AIProvider[]>(aiGateway.getAllProviders());
  const [configuringProvider, setConfiguringProvider] = useState<(Omit<AIProvider, 'enabled'> & { enabled?: boolean }) | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setProviders(aiGateway.getAllProviders());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const activeProvider = aiGateway.getActiveProvider();

  const handleAddProvider = (presetId: string) => {
    const preset = PRESET_PROVIDERS.find(p => p.id === presetId);
    if (preset) {
      setConfiguringProvider({ ...preset, apiKey: '' });
    }
  };

  const handleSaveProvider = (provider: AIProvider) => {
    aiGateway.addProvider(provider);
    setProviders(aiGateway.getAllProviders());
    setConfiguringProvider(null);
  };

  const handleRemoveProvider = (id: string) => {
    aiGateway.removeProvider(id);
    setProviders(aiGateway.getAllProviders());
  };

  const handleConfigureExisting = (provider: AIProvider) => {
    setConfiguringProvider(provider);
  };

  const availablePresets = PRESET_PROVIDERS.filter(
    p => p.type === activeTab && !providers.find(ep => ep.id === p.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Cpu className="w-6 h-6 text-indigo-400" />
        <h2 className="text-2xl font-bold">AI Providers</h2>
      </div>
      <p className="text-sv-muted">Configure real AI providers. Chat with Svetlana uses these connections.</p>

      {/* Active Provider */}
      {activeProvider && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-4 border border-emerald-500/20"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-sm font-medium text-emerald-400">Active Provider</h3>
                <p className="text-xs text-sv-muted">{activeProvider.name} — {activeProvider.model}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Connected
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {!activeProvider && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-4 border border-yellow-500/20"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400" />
            <div>
              <h3 className="text-sm font-medium text-yellow-400">No Active Provider</h3>
              <p className="text-xs text-sv-muted">Configure a provider below to enable AI chat with Svetlana</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('online')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'online'
              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
              : 'bg-white/5 text-sv-muted hover:bg-white/10 border border-white/10'
          }`}
        >
          <Cloud className="w-4 h-4" />
          Online / Cloud
        </button>
        <button
          onClick={() => setActiveTab('offline')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'offline'
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
              : 'bg-white/5 text-sv-muted hover:bg-white/10 border border-white/10'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          Offline / Local
        </button>
      </div>

      {/* Configured Providers */}
      {providers.filter(p => p.type === activeTab).length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-sv-muted mb-3">Configured</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.filter(p => p.type === activeTab).map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isActive={activeProvider?.id === provider.id}
                onConfigure={() => handleConfigureExisting(provider)}
                onRemove={() => handleRemoveProvider(provider.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Available Providers */}
      {availablePresets.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-sv-muted mb-3">
            {providers.filter(p => p.type === activeTab).length > 0 ? 'Add Another' : 'Available Providers'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {availablePresets.map(preset => (
              <motion.button
                key={preset.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => handleAddProvider(preset.id)}
                className="p-4 rounded-xl glass-card text-left hover:border-indigo-500/30 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${preset.type === 'offline' ? 'bg-cyan-500/10' : 'bg-purple-500/10'} group-hover:scale-110 transition-transform`}>
                    {preset.type === 'offline' ? <HardDrive className="w-4 h-4 text-cyan-400" /> : <Cloud className="w-4 h-4 text-purple-400" />}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium">{preset.name}</h4>
                    <p className="text-xs text-sv-muted">{preset.model}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-sv-muted group-hover:text-indigo-400 transition-colors" />
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Start Guide */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Start</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-purple-400 mb-2 flex items-center gap-2">
              <Cloud className="w-4 h-4" /> Cloud Providers
            </h4>
            <ol className="text-sm text-sv-muted space-y-1.5 list-decimal list-inside">
              <li>Click a cloud provider card above</li>
              <li>Enter your API key</li>
              <li>Select a model</li>
              <li>Click "Test Connection"</li>
              <li>Click "Save & Enable"</li>
              <li>Go to "Аватар & Голос" to chat!</li>
            </ol>
          </div>
          <div>
            <h4 className="text-sm font-medium text-cyan-400 mb-2 flex items-center gap-2">
              <HardDrive className="w-4 h-4" /> Offline (Ollama)
            </h4>
            <ol className="text-sm text-sv-muted space-y-1.5 list-decimal list-inside">
              <li>Install: <code className="text-cyan-300 text-xs">curl fsSL https://ollama.com/install.sh | sh</code></li>
              <li>Pull: <code className="text-cyan-300 text-xs">ollama pull llama3.1:8b</code></li>
              <li>Click "Ollama" card above</li>
              <li>Select model, test connection</li>
              <li>Save & Enable — works offline!</li>
              <li>No API key needed</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Comparison */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">Online vs Offline</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-3 text-sv-muted">Feature</th>
                <th className="text-left py-2 px-3 text-purple-400">Cloud</th>
                <th className="text-left py-2 px-3 text-cyan-400">Local</th>
              </tr>
            </thead>
            <tbody className="text-sv-muted">
              {[
                ['Privacy', 'Data sent to cloud', '100% local'],
                ['Speed', 'Network dependent', 'Hardware dependent'],
                ['Cost', 'Pay per token', 'Free (hardware)'],
                ['Quality', 'State-of-the-art', 'Good (7B-70B)'],
                ['Offline', '❌', '✅'],
                ['GPU', 'Not needed', 'Recommended (8GB+)'],
              ].map(([feature, online, offline]) => (
                <tr key={feature} className="border-b border-white/5">
                  <td className="py-2 px-3 font-medium text-sv-text">{feature}</td>
                  <td className="py-2 px-3">{online}</td>
                  <td className="py-2 px-3">{offline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
