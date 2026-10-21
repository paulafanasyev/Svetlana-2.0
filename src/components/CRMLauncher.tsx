// Floating button + full-screen overlay with Svetlana's CRM and Business tools, available on every page.
// Also opens with the URL hash: #crm, #biz, #booking, #stats, #bank or #cabinet (e.g. http://tauri.localhost/#biz).
// Одинаково на сайте, в Windows и в Android, включая «Кабинет» (телефон привязывается как устройство android).
// В Android выгрузки файлов из этих разделов идут через системное окно «Сохранить как» (AndroidFiles),
// а системная кнопка «Назад» закрывает окно так же, как Esc и «Закрыть» (BackStack).
// Клавиатура: при открытии фокус на «Закрыть», Tab ходит по кругу внутри окна, после закрытия фокус возвращается
// на кнопку, которой окно открыли (если окно открыли ссылкой #crm и т. п., — на кнопку CRM, а не в никуда).
// Активный раздел отмечен для экранного диктора (aria-current).
// Пока окно открыто, страница под ним недоступна (isolateDialog/inert) и для диктора; окна подтверждения
// действий (ActionConfirmHost) лежат в контейнере data-svetlana-dialogs и остаются доступными.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Users, Briefcase, ShieldCheck, BarChart3, CalendarClock, UserCircle, X } from 'lucide-react';
import CRMPage from '../pages/CRMPage';
import BizPage from '../pages/BizPage';
import BankInnPage from '../pages/BankInnPage';
import AnalyticsPage from '../pages/AnalyticsPage';
import BookingPage from '../pages/BookingPage';
import CabinetPage from '../pages/CabinetPage';
import { startHeartbeat } from '../services/cabinet/CabinetClient';
import { installAndroidDownloads } from '../services/AndroidFiles';
import { onBack } from '../services/BackStack';
import VoiceButton from './VoiceButton';
import ActionConfirmHost from './ActionConfirmHost';
import { isolateDialog } from './useDialogFocus';

installAndroidDownloads();

type Section = 'crm' | 'biz' | 'bank' | 'stats' | 'booking' | 'cabinet';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function sectionFromHash(): Section | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash;
  return h === '#crm' ? 'crm' : h === '#biz' ? 'biz' : h === '#bank' ? 'bank' : h === '#stats' ? 'stats' : h === '#booking' ? 'booking' : h === '#cabinet' ? 'cabinet' : null;
}

export default function CRMLauncher() {
  const [section, setSection] = useState<Section | null>(sectionFromHash);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const crmRef = useRef<HTMLButtonElement>(null);
  const bizRef = useRef<HTMLButtonElement>(null);
  /** Какой кнопкой открыли окно: туда вернётся фокус после закрытия. */
  const openedBy = useRef<'crm' | 'biz' | null>(null);
  /** Окно уже было открыто: только тогда после закрытия возвращаем фокус (при загрузке страницы его не трогаем). */
  const wasOpen = useRef(false);
  const isOpen = section !== null;
  // Пульс в личный кабинет (только если устройство привязано; иначе ничего не отправляется).
  useEffect(() => startHeartbeat(), []);

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Открытое окно закрывается системной кнопкой «Назад» телефона (а не всё приложение).
  useEffect(() => (section ? onBack(close) : undefined), [section]);

  // Пока окно открыто, страница под ним inert. Снимается до возврата фокуса (очистка эффекта идёт первой).
  useEffect(() => {
    const root = overlayRef.current;
    if (!isOpen || !root) return undefined;
    const release = isolateDialog(root);
    return () => release();
  }, [isOpen]);

  // Фокус: при открытии — на «Закрыть», при закрытии — обратно на кнопку, которой окно открыли.
  // Окно открыли ссылкой (#crm, #booking…): такой кнопки нет, фокус идёт на «CRM», чтобы не потеряться.
  useEffect(() => {
    if (isOpen) { wasOpen.current = true; closeRef.current?.focus(); return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const back = openedBy.current === 'biz' ? bizRef.current : crmRef.current;
    openedBy.current = null;
    back?.focus();
  }, [isOpen]);

  function close() {
    setSection(null);
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  const openFrom = (id: 'crm' | 'biz') => { openedBy.current = id; setSection(id); };

  /** Tab и Shift+Tab ходят по кругу внутри окна, фокус не уходит на страницу под ним. */
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !overlayRef.current) return;
    const items = Array.from(overlayRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !overlayRef.current.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !overlayRef.current.contains(active))) { e.preventDefault(); first.focus(); }
  };

  const tab = (id: Section, label: string, Icon: typeof Users) => (
    <button
      onClick={() => setSection(id)}
      aria-current={section === id ? 'page' : undefined}
      className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-11 rounded-lg text-sm font-semibold ${section === id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />{label}
    </button>
  );

  return (
    <>
      {/* Окна подтверждения действий не становятся inert, когда открыто окно CRM. */}
      <div data-svetlana-dialogs=""><ActionConfirmHost /></div>
      {!section && (
        // На узком экране телефона кнопки переносятся и не вылезают за край.
        <div data-testid="crm-launcher" className="fixed bottom-3 left-3 sm:bottom-5 sm:left-5 z-40 flex flex-wrap gap-2 max-w-[calc(100vw-1.5rem)]">
          <button ref={crmRef} onClick={() => openFrom('crm')} className="flex items-center gap-2 px-3 sm:px-4 py-2.5 min-h-11 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-lg shadow-indigo-900/40" aria-label="Открыть CRM">
            <Users className="w-4 h-4" aria-hidden="true" />CRM
          </button>
          <button ref={bizRef} onClick={() => openFrom('biz')} className="flex items-center gap-2 px-3 sm:px-4 py-2.5 min-h-11 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-lg shadow-emerald-900/40" aria-label="Открыть Бизнес">
            <Briefcase className="w-4 h-4" aria-hidden="true" />Бизнес
          </button>
          <VoiceButton />
        </div>
      )}
      {section && (
        <div ref={overlayRef} onKeyDown={trapTab} className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 backdrop-blur-sm p-3 sm:p-4 md:p-8" role="dialog" aria-modal="true" aria-label="CRM и бизнес">
          <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-3">
              <nav aria-label="Разделы" className="flex flex-wrap gap-2">{tab('crm', 'CRM', Users)}{tab('biz', 'Бизнес', Briefcase)}{tab('booking', 'Запись', CalendarClock)}{tab('stats', 'Аналитика', BarChart3)}{tab('bank', 'Банк и ИНН', ShieldCheck)}{tab('cabinet', 'Кабинет', UserCircle)}</nav>
              <button ref={closeRef} onClick={close} className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-11 min-w-11 rounded-lg text-sm bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10" aria-label="Закрыть"><X className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Закрыть</span></button>
            </div>
            {section === 'crm' ? <CRMPage /> : section === 'biz' ? <BizPage /> : section === 'stats' ? <AnalyticsPage /> : section === 'booking' ? <BookingPage /> : section === 'cabinet' ? <CabinetPage /> : <BankInnPage />}
          </div>
        </div>
      )}
    </>
  );
}
