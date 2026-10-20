// Защита от «белого экрана»: если страница упала при отрисовке, падает только она, а не всё приложение.
// Человек видит понятное сообщение и кнопки «Попробовать снова» / «Перезапустить»; данные не трогаются.
// В консоль уходит только тип ошибки и начало стека компонентов — без текста ошибки (в нём может оказаться ключ).
// Фокус переходит на сообщение: человек с клавиатурой или диктором сразу попадает к кнопке «Попробовать снова».
import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props { children: ReactNode; label?: string }
interface State { failed: boolean }

export const PAGE_CRASH_TEXT = 'Эта страница не открылась из-за ошибки. Ваши данные не потеряны.';

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  private box = createRef<HTMLDivElement>();

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const kind = error instanceof Error ? error.name : typeof error;
    console.error(`Страница «${this.props.label ?? '?'}» упала: ${kind}`, (info.componentStack ?? '').slice(0, 600));
  }

  componentDidUpdate(_prevProps: Props, prev: State) {
    if (this.state.failed && !prev.failed) this.box.current?.focus();
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div ref={this.box} tabIndex={-1} role="alert" aria-labelledby="page-crash-text" className="max-w-xl mx-auto my-10 rounded-2xl border border-amber-500/40 bg-amber-950/20 p-6 text-white space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
        <p className="flex items-start gap-2 text-amber-200">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <span id="page-crash-text">{PAGE_CRASH_TEXT}</span>
        </p>
        <p className="text-sm text-slate-300">Попробуйте открыть её снова. Если не помогает, перезапустите приложение.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={this.retry} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium">
            <RotateCcw className="w-4 h-4" aria-hidden="true" />Попробовать снова
          </button>
          <button onClick={() => window.location.reload()} className="px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">Перезапустить</button>
        </div>
      </div>
    );
  }
}
