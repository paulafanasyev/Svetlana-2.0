import React, { useState, useEffect } from 'react';
import { isAndroidApp } from '../platform';
import { aiGateway } from '../services/AIGateway';

// Локальная модель через Ollama. На компьютере — 127.0.0.1, в приложении для Android — адрес компьютера
// в домашней сети из настроек «★ Светлана Локальная» (запрос делает телефон, см. AndroidFiles).
const OllamaCard: React.FC = () => {
  const android = isAndroidApp();
  const endpoint = aiGateway.getProvider('ollama')?.endpoint || 'http://127.0.0.1:11434';
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'running' | 'not_running'>('checking');
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    checkOllama();
  }, [endpoint]);

  const checkOllama = async () => {
    try {
      const res = await fetch(`${endpoint}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        setOllamaStatus('running');
        setModels(data.models?.map((m: any) => String(m?.name ?? '')).filter(Boolean).slice(0, 50) || []);
      } else {
        setOllamaStatus('not_running');
      }
    } catch {
      setOllamaStatus('not_running');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-white my-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <span className="text-amber-400">★</span> Обученная Светлана 2.0 ({android ? 'на вашем компьютере' : 'Windows Local AI'})
        </h3>
        <span
          className={`px-2.5 py-1 text-xs rounded-full font-semibold ${
            ollamaStatus === 'running'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
          }`}
        >
          {ollamaStatus === 'running' ? 'Ollama активна' : 'Локальный движок не обнаружен'}
        </span>
      </div>

      <p className="text-sm text-slate-300 mb-4">
        {android
          ? `Телефон берёт ответы у Ollama на компьютере в той же Wi‑Fi сети (${endpoint}). На компьютере запустите модель и разрешите доступ из сети:`
          : 'Для работы обученной версии на Windows в один клик:'}
      </p>

      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-slate-200 mb-4 select-all break-all">
        <code>{android ? 'setx OLLAMA_HOST 0.0.0.0 && ollama run svetlana:latest' : 'ollama run svetlana:latest || ollama run gemma:2b'}</code>
      </div>

      {ollamaStatus === 'running' && models.length > 0 && (
        <div className="text-xs text-slate-400">
          Обнаруженные локальные модели: <span className="text-slate-200">{models.join(', ')}</span>
        </div>
      )}

      {ollamaStatus === 'not_running' && (
        <div className="text-xs text-amber-300/80 mt-2">
          {android
            ? 'Укажите адрес компьютера в «Модели ИИ» → «Локальные модели» → «★ Светлана Локальная» (например, http://192.168.1.10:11434). Телефон и компьютер должны быть в одной сети.'
            : 'Запустите Ollama или скачайте установщик с официального сайта ollama.com, чтобы Светлана отвечала локально без облачных ключей.'}
        </div>
      )}
    </div>
  );
};

export const WindowsLocalModelCard: React.FC = () => <OllamaCard />;
