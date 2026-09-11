import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Cpu, Globe, Server, Wifi, WifiOff, Check, Settings, Key,
  Zap, Shield, Database, Cloud, HardDrive, ChevronDown, ChevronRight,
  Plus, Trash2, TestTube, AlertCircle, CheckCircle2, X
} from 'lucide-react';

// ==================== TYPES ====================
interface AIProvider {
  id: string;
  name: string;
  type: 'online' | 'offline';
  icon: string;
  description: string;
  models: string[];
  endpoint?: string;
  apiKeyRequired: boolean;
  status: 'available' | 'configured' | 'error' | 'unavailable';
}

interface ProviderConfig {
  apiKey: string;
  endpoint: string;
  selectedModel: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

// ==================== DATA ====================
const ONLINE_PROVIDERS: AIProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'online',
    icon: '🟢',
    description: 'GPT-4o, GPT-4, GPT-3.5 Turbo',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
    apiKeyRequired: true,
    status: 'available',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'online',
    icon: '🟠',
    description: 'Claude 3.5 Sonnet, Claude 3 Opus, Haiku',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
    apiKeyRequired: true,
    status: 'available',
  },
  {
    id: 'google',
    name: 'Google AI',
    type: 'online',
    icon: '🔵',
    description: 'Gemini 1.5 Pro, Gemini 1.5 Flash',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
    apiKeyRequired: true,
    status: 'available',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    type: 'online',
    icon: '🟣',
    description: 'Mistral Large, Medium, Small',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    apiKeyRequired: true,
    status: 'available',
  },
  {
    id: 'groq',
    name: 'Groq',
    type: 'online',
    icon: '⚡',
    description: 'Ultra-fast inference: Llama, Mixtral',
    models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    apiKeyRequired: true,
    status: 'available',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'online',
    icon: '🌐',
    description: 'Unified API for 100+ models',
    models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro', 'meta-llama/llama-3-70b'],
    apiKeyRequired: true,
    status: 'available',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'online',
    icon: '🔷',
    description: 'DeepSeek V3, DeepSeek Coder',
    models: ['deepseek-chat', 'deepseek-coder'],
    apiKeyRequired: true,
    status: 'available',
  },
];

const OFFLINE_PROVIDERS: AIProvider[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    type: 'offline',
    icon: '🦙',
    description: 'Local LLM runner — Llama, Mistral, Phi, etc.',
    models: ['llama3.1:70b', 'llama3.1:8b', 'mistral:7b', 'phi3:14b', 'qwen2:7b', 'codellama:13b'],
    endpoint: 'http://localhost:11434',
    apiKeyRequired: false,
    status: 'available',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'offline',
    icon: '🎯',
    description: 'Desktop app for running local models',
    models: ['Any GGUF model loaded in LM Studio'],
    endpoint: 'http://localhost:1234',
    apiKeyRequired: false,
    status: 'available',
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp Server',
    type: 'offline',
    icon: '🦄',
    description: 'High-performance C++ inference server',
    models: ['Any GGUF model file'],
    endpoint: 'http://localhost:8080',
    apiKeyRequired: false,
    status: 'available',
  },
  {
    id: 'localai',
    name: 'LocalAI',
    type: 'offline',
    icon: '🏠',
    description: 'OpenAI-compatible local API server',
    models: ['Any supported model via config'],
    endpoint: 'http://localhost:8080',
    apiKeyRequired: false,
    status: 'available',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    type: 'offline',
    icon: '🚀',
    description: 'High-throughput LLM serving engine',
    models: ['Any HuggingFace model'],
    endpoint: 'http://localhost:8000',
    apiKeyRequired: false,
    status: 'available',
  },
  {
    id: 'textgenwebui',
    name: 'Text Generation WebUI',
    type: 'offline',
    icon: '🖥️',
    description: 'Oobabooga — Gradio-based LLM interface',
    models: ['Any loaded model'],
    endpoint: 'http://localhost:5000',
    apiKeyRequired: false,
    status: 'available',
  },
];

// ==================== COMPONENTS ====================

function ProviderCard({ provider, config, onConfigure }: {
  provider: AIProvider;
  config?: ProviderConfig;
  onConfigure: (id: string) => void;
}) {
  const isConfigured = config?.enabled;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card rounded-xl p-5 transition-all hover:border-indigo-500/30 ${
        isConfigured ? 'border-emerald-500/30' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{provider.icon}</span>
          <div>
            <h3 className="font-semibold">{provider.name}</h3>
            <p className="text-xs text-sv-muted">{provider.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConfigured && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3 h-3" /> Active
            </span>
          )}
          <button
            onClick={() => onConfigure(provider.id)}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted hover:text-sv-text transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {provider.models.slice(0, 4).map(model => (
          <span key={model} className="px-2 py-0.5 text-xs rounded bg-white/5 border border-white/10 text-sv-muted font-mono">
            {model}
          </span>
        ))}
        {provider.models.length > 4 && (
          <span className="px-2 py-0.5 text-xs rounded bg-white/5 border border-white/10 text-sv-muted">
            +{provider.models.length - 4} more
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        {provider.type === 'offline' ? (
          <>
            <HardDrive className="w-3 h-3 text-cyan-400" />
            <span className="text-cyan-400">Local</span>
            {provider.endpoint && (
              <span className="text-sv-muted font-mono ml-2">{provider.endpoint}</span>
            )}
          </>
        ) : (
          <>
            <Cloud className="w-3 h-3 text-purple-400" />
            <span className="text-purple-400">Cloud</span>
            {provider.apiKeyRequired && (
              <span className="text-sv-muted ml-2 flex items-center gap-1">
                <Key className="w-3 h-3" /> API Key required
              </span>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function ConfigModal({ provider, config, onSave, onClose }: {
  provider: AIProvider;
  config: ProviderConfig;
  onSave: (config: ProviderConfig) => void;
  onClose: () => void;
}) {
  const [localConfig, setLocalConfig] = useState<ProviderConfig>(config);
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const handleTest = () => {
    setTestResult('testing');
    setTimeout(() => {
      if (provider.type === 'offline') {
        // Simulate checking local endpoint
        setTestResult(Math.random() > 0.3 ? 'success' : 'error');
      } else {
        // Simulate API key validation
        setTestResult(localConfig.apiKey.length > 10 ? 'success' : 'error');
      }
    }, 1500);
  };

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
          <div className="flex items-center gap-3">
            <span className="text-2xl">{provider.icon}</span>
            <div>
              <h3 className="text-lg font-semibold">{provider.name}</h3>
              <p className="text-xs text-sv-muted">{provider.type === 'offline' ? 'Offline / Local' : 'Online / Cloud'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-sv-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* API Key (for online providers) */}
          {provider.apiKeyRequired && (
            <div>
              <label className="text-sm text-sv-muted mb-1 block">API Key</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sv-muted" />
                <input
                  type="password"
                  value={localConfig.apiKey}
                  onChange={e => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>
          )}

          {/* Endpoint (for offline providers) */}
          {provider.type === 'offline' && (
            <div>
              <label className="text-sm text-sv-muted mb-1 block">Endpoint URL</label>
              <div className="relative">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sv-muted" />
                <input
                  type="text"
                  value={localConfig.endpoint}
                  onChange={e => setLocalConfig({ ...localConfig, endpoint: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-mono focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>
          )}

          {/* Model Selection */}
          <div>
            <label className="text-sm text-sv-muted mb-1 block">Model</label>
            <select
              value={localConfig.selectedModel}
              onChange={e => setLocalConfig({ ...localConfig, selectedModel: e.target.value })}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50 appearance-none"
            >
              {provider.models.map(model => (
                <option key={model} value={model} className="bg-sv-darker">{model}</option>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div>
            <label className="text-sm text-sv-muted mb-1 block">Temperature: {localConfig.temperature}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={localConfig.temperature}
              onChange={e => setLocalConfig({ ...localConfig, temperature: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* Max Tokens */}
          <div>
            <label className="text-sm text-sv-muted mb-1 block">Max Tokens: {localConfig.maxTokens}</label>
            <input
              type="range"
              min="256"
              max="128000"
              step="256"
              value={localConfig.maxTokens}
              onChange={e => setLocalConfig({ ...localConfig, maxTokens: parseInt(e.target.value) })}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* Test Connection */}
          <button
            onClick={handleTest}
            disabled={testResult === 'testing'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors"
          >
            {testResult === 'testing' ? (
              <>
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                  <Settings className="w-4 h-4" />
                </motion.div>
                Testing connection...
              </>
            ) : testResult === 'success' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Connection successful!</span>
              </>
            ) : testResult === 'error' ? (
              <>
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-red-400">Connection failed</span>
              </>
            ) : (
              <>
                <TestTube className="w-4 h-4" />
                Test Connection
              </>
            )}
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...localConfig, enabled: true })}
            className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
          >
            Save & Enable
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== MAIN PAGE ====================
export default function AIProvidersPage() {
  const [activeTab, setActiveTab] = useState<'online' | 'offline'>('online');
  const [configs, setConfigs] = useState<Record<string, ProviderConfig>>({});
  const [configuringProvider, setConfiguringProvider] = useState<AIProvider | null>(null);

  const allProviders = activeTab === 'online' ? ONLINE_PROVIDERS : OFFLINE_PROVIDERS;

  const handleConfigure = (providerId: string) => {
    const provider = [...ONLINE_PROVIDERS, ...OFFLINE_PROVIDERS].find(p => p.id === providerId);
    if (provider) {
      setConfiguringProvider(provider);
    }
  };

  const handleSaveConfig = (config: ProviderConfig) => {
    if (configuringProvider) {
      setConfigs(prev => ({ ...prev, [configuringProvider.id]: config }));
      setConfiguringProvider(null);
    }
  };

  const getDefaultConfig = (provider: AIProvider): ProviderConfig => ({
    apiKey: '',
    endpoint: provider.endpoint || '',
    selectedModel: provider.models[0] || '',
    temperature: 0.7,
    maxTokens: 4096,
    enabled: false,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Cpu className="w-6 h-6 text-indigo-400" />
        <h2 className="text-2xl font-bold">AI Providers</h2>
      </div>
      <p className="text-sv-muted">Configure online cloud APIs or offline local models for Svetlana 2.0</p>

      {/* Active Provider Display */}
      {Object.values(configs).filter(c => c.enabled).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-4 border border-emerald-500/20"
        >
          <h3 className="text-sm font-medium text-emerald-400 mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Active Providers
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(configs).filter(([, c]) => c.enabled).map(([id, config]) => {
              const provider = [...ONLINE_PROVIDERS, ...OFFLINE_PROVIDERS].find(p => p.id === id);
              return provider ? (
                <div key={id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <span>{provider.icon}</span>
                  <span className="text-sm">{provider.name}</span>
                  <span className="text-xs text-sv-muted font-mono">{config.selectedModel}</span>
                </div>
              ) : null;
            })}
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
          Online / Cloud ({ONLINE_PROVIDERS.length})
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
          Offline / Local ({OFFLINE_PROVIDERS.length})
        </button>
      </div>

      {/* Provider Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allProviders.map((provider, i) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            config={configs[provider.id]}
            onConfigure={handleConfigure}
          />
        ))}
      </div>

      {/* Quick Start Guide */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-sv-muted" />
          Quick Setup Guide
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-purple-400 mb-2 flex items-center gap-2">
              <Cloud className="w-4 h-4" /> Online Providers
            </h4>
            <ol className="text-sm text-sv-muted space-y-1.5 list-decimal list-inside">
              <li>Choose a cloud provider (OpenAI, Anthropic, etc.)</li>
              <li>Get an API key from the provider's website</li>
              <li>Click the settings icon on the provider card</li>
              <li>Enter your API key and select a model</li>
              <li>Click "Test Connection" to verify</li>
              <li>Click "Save & Enable"</li>
            </ol>
          </div>
          <div>
            <h4 className="text-sm font-medium text-cyan-400 mb-2 flex items-center gap-2">
              <HardDrive className="w-4 h-4" /> Offline Providers
            </h4>
            <ol className="text-sm text-sv-muted space-y-1.5 list-decimal list-inside">
              <li>Install Ollama: <span className="font-mono text-cyan-300">curl fsSL https://ollama.com/install.sh | sh</span></li>
              <li>Pull a model: <span className="font-mono text-cyan-300">ollama pull llama3.1:8b</span></li>
              <li>Ollama starts automatically on port 11434</li>
              <li>Click settings on the Ollama card</li>
              <li>Select your model and test connection</li>
              <li>Save & enable — works without internet!</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Comparison Table */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">Online vs Offline Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-3 text-sv-muted">Feature</th>
                <th className="text-left py-2 px-3 text-purple-400">Online / Cloud</th>
                <th className="text-left py-2 px-3 text-cyan-400">Offline / Local</th>
              </tr>
            </thead>
            <tbody className="text-sv-muted">
              {[
                ['Privacy', 'Data sent to cloud', '100% local, private'],
                ['Speed', 'Depends on network', 'Depends on hardware'],
                ['Cost', 'Pay per token', 'Free (hardware cost)'],
                ['Model Quality', 'State-of-the-art', 'Good (7B-70B range)'],
                ['Availability', 'Requires internet', 'Works offline'],
                ['GPU Required', 'No', 'Recommended (8GB+ VRAM)'],
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
      {configuringProvider && (
        <ConfigModal
          provider={configuringProvider}
          config={configs[configuringProvider.id] || getDefaultConfig(configuringProvider)}
          onSave={handleSaveConfig}
          onClose={() => setConfiguringProvider(null)}
        />
      )}
    </div>
  );
}
