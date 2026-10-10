import React, { useState, useEffect } from 'react';

export const WindowsLocalModelCard: React.FC = () => {
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'running' | 'not_running'>('checking');
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    checkOllama();
  }, []);

  const checkOllama = async () => {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags');
      if (res.ok) {
        const data = await res.json();
        setOllamaStatus('running');
        setModels(data.models?.map((m: any) => m.name) || []);
      } else {
        setOllamaStatus('not_running');
      }
    } catch {
      setOllamaStatus('not_running');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-white my-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <span className="text-amber-400">★</span> Обученная Светлана 2.0 (Windows Local AI)
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
        Для работы обученной версии на Windows в один клик:
      </p>

      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-slate-200 mb-4 select-all">
        <code>ollama run svetlana:latest || ollama run gemma:2b</code>
      </div>

      {ollamaStatus === 'running' && models.length > 0 && (
        <div className="text-xs text-slate-400">
          Обнаруженные локальные модели: <span className="text-slate-200">{models.join(', ')}</span>
        </div>
      )}

      {ollamaStatus === 'not_running' && (
        <div className="text-xs text-amber-300/80 mt-2">
          Запустите Ollama или скачайте установщик с официального сайта ollama.com, чтобы Светлана отвечала локально без облачных ключей.
        </div>
      )}
    </div>
  );
};
