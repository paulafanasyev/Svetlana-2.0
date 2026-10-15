// Системная кнопка «Назад» в приложении для Android: сначала закрывает верхнее открытое окно
// (CRM, Бизнес, Кабинет, мастер настройки) и только когда закрывать нечего, выходит. На сайте и в Windows то же
// делает Esc / кнопка «Закрыть». MainActivity спрашивает window.__svetlanaBack().
import { isAndroidApp } from '../platform';

type Handler = () => void;
const stack: Handler[] = [];

/** Окно открылось: «Назад» вызовет close. Возвращает функцию для снятия (для useEffect). */
export function onBack(close: Handler): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Закрыть верхнее окно. true — закрыли, false — открытых окон нет (пусть решает система). */
export function handleBack(): boolean {
  const close = stack.pop();
  if (!close) return false;
  try { close(); } catch { /* окно уже закрыто */ }
  return true;
}

export const backDepth = (): number => stack.length;

/** Только в приложении для Android. Идемпотентно. */
export function installBackButton(): void {
  if (!isAndroidApp() || typeof window === 'undefined') return;
  (window as unknown as { __svetlanaBack?: () => boolean }).__svetlanaBack = handleBack;
}
