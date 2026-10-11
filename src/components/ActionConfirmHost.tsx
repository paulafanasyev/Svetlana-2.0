// Окно подтверждения действий, предложенных нейросетью или распознанных голосом.
// Показывает точные параметры; по умолчанию фокус на «Отмена», Esc — отмена.
import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { setActionConfirmer, type ActionSummary } from '../services/security/ActionGate';

interface Pending { summary: ActionSummary; resolve: (ok: boolean) => void }

export default function ActionConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => setActionConfirmer((_req, summary) => new Promise<boolean>(resolve => {
    setQueue(q => [...q, { summary, resolve }]);
  })), []);

  useEffect(() => { if (current) cancelRef.current?.focus(); }, [current]);

  const answer = (ok: boolean) => {
    if (!current) return;
    current.resolve(ok);
    setQueue(q => q.slice(1));
  };

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); answer(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!current) return null;
  const s = current.summary;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true" aria-labelledby="action-confirm-title" aria-describedby="action-confirm-body">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-amber-400/40 p-5 text-white space-y-3 shadow-2xl">
        <div className="flex items-center gap-2 text-amber-300 text-sm"><ShieldAlert className="w-5 h-5" aria-hidden="true" />{s.sourceLabel}</div>
        <h2 id="action-confirm-title" className="text-lg font-semibold">{s.title}?</h2>
        <ul id="action-confirm-body" className="text-sm text-slate-200 space-y-1 bg-black/30 rounded-lg p-3 break-words">
          {s.lines.length ? s.lines.map((l, i) => <li key={i}>{l}</li>) : <li>Без параметров</li>}
        </ul>
        <p className="text-xs text-slate-400">Проверьте данные. Светлана выполнит действие только после вашего подтверждения.</p>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} onClick={() => answer(false)} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Отмена</button>
          <button onClick={() => answer(true)} className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200">Выполнить</button>
        </div>
        {queue.length > 1 && <p className="text-xs text-slate-500">Ещё в очереди: {queue.length - 1}</p>}
      </div>
    </div>
  );
}
