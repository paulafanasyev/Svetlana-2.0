// Floating CRM button + full-screen CRM overlay, available on every page.
// Also opens with the #crm URL hash (e.g. http://tauri.localhost/#crm).
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import CRMPage from '../pages/CRMPage';

export default function CRMLauncher() {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#crm');

  useEffect(() => {
    const onHash = () => setOpen(window.location.hash === '#crm');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  function close() {
    setOpen(false);
    if (window.location.hash === '#crm') history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 left-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-lg shadow-indigo-900/40"
          aria-label="Открыть CRM"
        >
          <Users className="w-4 h-4" />CRM
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 backdrop-blur-sm p-4 md:p-8" role="dialog" aria-modal="true" aria-label="CRM">
          <div className="max-w-7xl mx-auto">
            <CRMPage onClose={close} />
          </div>
        </div>
      )}
    </>
  );
}
