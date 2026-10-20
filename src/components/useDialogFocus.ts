// Окно-диалог для клавиатуры и экранного диктора: при открытии фокус внутрь, Tab и Shift+Tab ходят по кругу
// внутри окна, Escape закрывает, после закрытия фокус возвращается туда, где был.
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Элементы окна, куда можно попасть клавишей Tab. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * Подключить поведение модального окна к элементу ref (у него должны быть role="dialog" и aria-modal="true").
 * initial: куда поставить фокус при открытии (по умолчанию первый доступный элемент).
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof document === 'undefined') return undefined;
    const before = document.activeElement as HTMLElement | null;
    (initial?.current ?? focusablesIn(root)[0] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const list = focusablesIn(root);
      if (!list.length) { e.preventDefault(); root.focus(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (before && before.isConnected && typeof before.focus === 'function') before.focus();
    };
  }, []);
}
