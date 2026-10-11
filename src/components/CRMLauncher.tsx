// Floating button + full-screen overlay with Svetlana's CRM and Business tools, available on every page.
// Also opens with the URL hash: #crm, #biz, #booking, #stats or #bank (e.g. http://tauri.localhost/#biz).
import { useEffect, useState } from 'react';
import { Users, Briefcase, ShieldCheck, BarChart3, CalendarClock, X } from 'lucide-react';
import CRMPage from '../pages/CRMPage';
import BizPage from '../pages/BizPage';
import BankInnPage from '../pages/BankInnPage';
import AnalyticsPage from '../pages/AnalyticsPage';
import BookingPage from '../pages/BookingPage';

type Section = 'crm' | 'biz' | 'bank' | 'stats' | 'booking';

function sectionFromHash(): Section | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash;
  return h === '#crm' ? 'crm' : h === '#biz' ? 'biz' : h === '#bank' ? 'bank' : h === '#stats' ? 'stats' : h === '#booking' ? 'booking' : null;
}

export default function CRMLauncher() {
  const [section, setSection] = useState<Section | null>(sectionFromHash);

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

  function close() {
    setSection(null);
    if (sectionFromHash()) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  const tab = (id: Section, label: string, Icon: typeof Users) => (
    <button
      onClick={() => setSection(id)}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${section === id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
    >
      <Icon className="w-4 h-4" />{label}
    </button>
  );

  return (
    <>
      {!section && (
        <div className="fixed bottom-5 left-5 z-40 flex gap-2">
          <button onClick={() => setSection('crm')} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-lg shadow-indigo-900/40" aria-label="Открыть CRM">
            <Users className="w-4 h-4" />CRM
          </button>
          <button onClick={() => setSection('biz')} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-lg shadow-emerald-900/40" aria-label="Открыть Бизнес">
            <Briefcase className="w-4 h-4" />Бизнес
          </button>
        </div>
      )}
      {section && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 backdrop-blur-sm p-4 md:p-8" role="dialog" aria-modal="true" aria-label="CRM и бизнес">
          <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">{tab('crm', 'CRM', Users)}{tab('biz', 'Бизнес', Briefcase)}{tab('booking', 'Запись', CalendarClock)}{tab('stats', 'Аналитика', BarChart3)}{tab('bank', 'Банк и ИНН', ShieldCheck)}</div>
              <button onClick={close} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10" aria-label="Закрыть"><X className="w-4 h-4" />Закрыть</button>
            </div>
            {section === 'crm' ? <CRMPage /> : section === 'biz' ? <BizPage /> : section === 'stats' ? <AnalyticsPage /> : section === 'booking' ? <BookingPage /> : <BankInnPage />}
          </div>
        </div>
      )}
    </>
  );
}
