// Окно подтверждения действий, предложенных нейросетью или распознанных голосом.
// Показывает точные параметры и предупреждение о последствиях (изменение данных, списание денег);
// по умолчанию фокус на «Отмена», Esc и системная кнопка «Назад» телефона — отмена.
// Пока окно открыто, остальная страница недоступна (inert), а Tab не выходит за пределы окна.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import { setActionConfirmer, type ActionSummary } from '../services/security/ActionGate';
import { onBack } from '../services/BackStack';

interface Pending { summary: ActionSummary; resolve: (ok: boolean) => void }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ActionConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const current = queue[0];

  useEffect(() => setActionConfirmer((_req, summary) => new Promise<boolean>(resolve => {
    setQueue(q => [...q, { summary, resolve }]);
  })), []);

  useEffect(() => { if (current) cancelRef.current?.focus(); }, [current]);

  // Фон недоступен для мыши, клавиатуры и экранного диктора, пока открыто окно.
  useEffect(() => {
    if (!current || typeof document === 'undefined') return;
    const root = document.getElementById('root');
    if (!root || root.contains(dialogRef.current)) return;
    const had = root.hasAttribute('inert');
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
    return () => { if (!had) root.removeAttribute('inert'); root.removeAttribute('aria-hidden'); };
  }, [current]);

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

  // «Назад» на телефоне отменяет текущее действие (окно подтверждения всегда поверх остальных).
  useEffect(() => (current ? onBack(() => answer(false)) : undefined), [current]);

  /** Tab и Shift+Tab ходят по кругу внутри окна. */
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) { e.preventDefault(); first.focus(); }
  };

  if (!current) return null;
  const s = current.summary;
  const dialog = (
    <div ref={dialogRef} onKeyDown={trapTab} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true" aria-labelledby="action-confirm-title" aria-describedby="action-confirm-body action-confirm-warning">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-amber-400/40 p-5 text-white space-y-3 shadow-2xl">
        <div className="flex items-center gap-2 text-amber-300 text-sm"><ShieldAlert className="w-5 h-5" aria-hidden="true" />{s.sourceLabel}</div>
        <h2 id="action-confirm-title" className="text-lg font-semibold">{s.title}?</h2>
        <ul id="action-confirm-body" className="text-sm text-slate-200 space-y-1 bg-black/30 rounded-lg p-3 break-words whitespace-pre-wrap max-h-80 overflow-y-auto">
          {s.lines.length ? s.lines.map((l, i) => <li key={i}>{l}</li>) : <li>Без параметров</li>}
        </ul>
        {s.warning
          ? <p id="action-confirm-warning" className="text-sm text-amber-200 flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><span>{s.warning}</span></p>
          : <p id="action-confirm-warning" className="text-xs text-slate-400">Проверьте данные. Светлана выполнит действие только после вашего подтверждения.</p>}
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} onClick={() => answer(false)} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Отмена</button>
          <button onClick={() => answer(true)} className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200">Выполнить</button>
        </div>
        {queue.length > 1 && <p className="text-xs text-slate-500">Ещё в очереди: {queue.length - 1}</p>}
      </div>
    </div>
  );
  return typeof document !== 'undefined' && document.body ? createPortal(dialog, document.body) : dialog;
}
