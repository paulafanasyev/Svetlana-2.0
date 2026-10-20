// Окна подтверждения и ввода внутри Светланы вместо window.confirm / window.prompt.
// В окне приложений (WebView2 в Windows, WebView в Android) системные окна браузера могут не показываться
// и молча отвечать «нет»: тогда не работали бы удаление, восстановление и чеки. Здесь окно своё: подписано для
// экранного диктора (alertdialog), фокус сразу на «Отмена» (случайный Enter ничего не удалит), Tab не уходит за окно,
// Escape и нажатие мимо окна — «Отмена», после закрытия фокус возвращается. Окно само встраивается в страницу
// при первом вызове; если страницы нет (тесты, фон), ответ безопасный: «нет».
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';

type Kind = 'confirm' | 'prompt' | 'copy';
interface DialogRequest {
  id: number;
  kind: Kind;
  message: string;
  okText: string;
  danger: boolean;
  value: string;
  resolve: (v: string | null) => void;
}

let current: DialogRequest | null = null;
let seq = 0;
let mounted = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

function ensureHost(): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  if (!mounted) {
    mounted = true;
    const el = document.createElement('div');
    el.setAttribute('data-svetlana-dialogs', '');
    document.body.appendChild(el);
    createRoot(el).render(<DialogHost />);
  }
  return true;
}

function open(kind: Kind, message: string, opts: { okText?: string; danger?: boolean; value?: string }): Promise<string | null> {
  return new Promise(resolve => {
    if (!ensureHost()) { resolve(null); return; }
    // Новое окно закрывает прежнее как «Отмена».
    current?.resolve(null);
    current = {
      id: ++seq, kind,
      message: String(message ?? '').slice(0, 2000),
      okText: opts.okText ?? (kind === 'copy' ? 'Закрыть' : 'Да'),
      danger: !!opts.danger,
      value: String(opts.value ?? '').slice(0, 100_000),
      resolve,
    };
    notify();
  });
}

function settle(id: number, v: string | null): void {
  if (!current || current.id !== id) return;
  const r = current;
  current = null;
  notify();
  r.resolve(v);
}

/** «Да / Отмена». По умолчанию красная кнопка: так подтверждаются удаления и замена данных. */
export function askConfirm(message: string, opts: { okText?: string; danger?: boolean } = {}): Promise<boolean> {
  return open('confirm', message, { danger: true, ...opts }).then(v => v !== null);
}

/** Поле ввода: строка (можно пустая) или null, если нажали «Отмена». */
export function askText(message: string, opts: { okText?: string; value?: string } = {}): Promise<string | null> {
  return open('prompt', message, { okText: opts.okText ?? 'Сохранить', value: opts.value });
}

/** Показать текст для ручного копирования (если буфер обмена недоступен). */
export function showCopyText(message: string, text: string): Promise<void> {
  return open('copy', message, { value: text }).then(() => undefined);
}

function DialogHost() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick(t => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const req = current;
  return req ? <Dialog key={req.id} req={req} /> : null;
}

const field = 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/15 text-sm text-white focus:outline-none focus:border-indigo-400';

function Dialog({ req }: { req: DialogRequest }) {
  const [value, setValue] = useState(req.value);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const target = box.current?.querySelector<HTMLElement>(req.kind === 'confirm' ? '[data-cancel]' : 'textarea, input');
    target?.focus();
    if (req.kind === 'copy') (target as HTMLTextAreaElement | null)?.select?.();
    return () => { try { prev?.focus?.(); } catch { /* элемент уже убран со страницы */ } };
  }, [req]);

  const cancel = () => settle(req.id, null);
  const ok = () => settle(req.id, req.kind === 'prompt' ? value : '');

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key === 'Enter' && req.kind === 'prompt' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); ok(); return; }
    if (e.key !== 'Tab' || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLElement>('button, input, textarea'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
    e.preventDefault();
    items[next].focus();
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
      <div
        ref={box}
        role={req.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`sv-dialog-${req.id}`}
        onKeyDown={onKey}
        className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl space-y-4"
      >
        <p id={`sv-dialog-${req.id}`} className="text-sm whitespace-pre-line break-words">{req.message}</p>
        {req.kind === 'prompt' && (
          <input className={field} aria-label={req.message.slice(0, 120)} value={value} maxLength={500} onChange={e => setValue(e.target.value)} />
        )}
        {req.kind === 'copy' && (
          <textarea readOnly rows={5} className={field} aria-label="Текст для копирования" value={req.value} />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {req.kind !== 'copy' && (
            <button type="button" data-cancel onClick={cancel} className="min-h-10 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">Отмена</button>
          )}
          <button type="button" onClick={req.kind === 'copy' ? cancel : ok} className={`min-h-10 px-4 py-2 rounded-lg text-sm font-medium ${req.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}>{req.okText}</button>
        </div>
      </div>
    </div>
  );
}
