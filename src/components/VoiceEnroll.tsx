// Запись голоса владельца: 3 фразы по 4 секунды. Только после этого включаются голосовые команды.
// В приложениях для Windows и Android здесь же ставится модель распознавания речи на устройстве (GigaAM-v3).
// Результат проверки — простыми словами (без чисел «отличие/порог»), сообщения зачитываются диктором (role=status),
// удаление записи голоса подтверждается в окне Светланы (askConfirm).
import { useEffect, useState } from 'react';
import { Mic, Trash2, Download, Cpu } from 'lucide-react';
import { recordPrint } from '../services/voice/VoiceGuard';
import { buildTemplate, saveTemplate, loadTemplate, deleteTemplate, verifyPrint, MIN_ENROLL_SAMPLES, type VoicePrint } from '../services/voice/VoicePrint';
import { localSttAvailable, localSttInstall, localSttRemove, localSttStatus, type LocalSttStatus } from '../services/voice/LocalStt';
import { isAndroidApp } from '../platform';
import { askConfirm } from './ConfirmDialog';

const PHRASES = [
  'Светлана, запиши доход пять тысяч рублей от Петрова за консультацию.',
  'Сколько налога мне нужно заплатить в этом квартале и когда срок?',
  'Запиши Иванову на стрижку в пятницу в пятнадцать тридцать.',
];

export default function VoiceEnroll() {
  const [enrolled, setEnrolled] = useState(() => !!loadTemplate());
  const [prints, setPrints] = useState<VoicePrint[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const record = async () => {
    setBusy(true); setMsg(null);
    try {
      const p = await recordPrint(4);
      if (!p) { setMsg('Не расслышала. Говорите громче и ближе к микрофону, всю фразу.'); return; }
      const next = [...prints, p];
      if (next.length >= MIN_ENROLL_SAMPLES) {
        saveTemplate(buildTemplate(next));
        setPrints([]); setEnrolled(true);
        setMsg('Голос записан. Теперь Светлана выполняет голосовые команды только от вас.');
      } else setPrints(next);
    } catch (e: any) { setMsg(e?.message || 'Нет доступа к микрофону'); } finally { setBusy(false); }
  };

  const check = async () => {
    const t = loadTemplate(); if (!t) return;
    setBusy(true); setMsg('Скажите любую фразу…');
    try {
      const r = verifyPrint(await recordPrint(4), t);
      setMsg(r.ok ? 'Голос узнан: это вы.' : `Голос не узнан. ${r.reason}`);
    } catch (e: any) { setMsg(e?.message || 'Нет доступа к микрофону'); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await askConfirm('Удалить запись голоса? Голосовые команды выключатся до новой записи.', { okText: 'Удалить' }))) return;
    deleteTemplate(); setEnrolled(false); setMsg('Запись голоса удалена.');
  };

  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
      <p className="font-medium flex items-center gap-1.5"><Mic className="w-4 h-4" aria-hidden="true" />Мой голос {enrolled ? <span className="text-emerald-300 text-xs">записан</span> : <span className="text-amber-300 text-xs">не записан</span>}</p>
      {!enrolled && (
        <>
          <p className="text-xs text-slate-400">Голосовые команды работают только по вашему голосу. Прочитайте вслух 3 фразы (по 4 секунды).</p>
          <p className="text-sm italic text-indigo-200">«{PHRASES[prints.length]}»</p>
          <button disabled={busy} onClick={record} aria-busy={busy} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{busy ? 'Слушаю 4 секунды…' : `Записать фразу ${prints.length + 1} из ${MIN_ENROLL_SAMPLES}`}</button>
        </>
      )}
      {enrolled && (
        <div className="flex gap-2">
          <button disabled={busy} onClick={check} aria-busy={busy} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50">{busy ? 'Слушаю…' : 'Проверить'}</button>
          <button disabled={busy} onClick={() => { void remove(); }} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"><Trash2 className="w-4 h-4" aria-hidden="true" />Удалить запись голоса</button>
        </div>
      )}
      {msg && <p role="status" className="text-xs text-indigo-200">{msg}</p>}
      <p className="text-[11px] text-slate-400">Хранится только признак голоса (не запись), только на этом устройстве. Перед первой командой Светлана просит сказать 3 случайные цифры: так запись вашего голоса не сработает.</p>
      {localSttAvailable() && <LocalSttCard />}
    </div>
  );
}

/** Модель распознавания речи на устройстве: цифры проверки (а на телефоне и команды) распознаются локально. */
function LocalSttCard() {
  const [status, setStatus] = useState<LocalSttStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const android = isAndroidApp();

  useEffect(() => {
    let alive = true;
    const tick = () => { void localSttStatus().then(s => { if (alive) setStatus(s); }).catch(() => undefined); };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(String(e?.message ?? e ?? 'Ошибка')); } finally { setBusy(false); }
  };

  if (!status) return null;
  const pct = status.total > 0 ? Math.min(100, Math.round((status.downloaded / status.total) * 100)) : 0;
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-2 space-y-1.5">
      <p className="text-xs font-medium flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" aria-hidden="true" />Распознавание на {android ? 'телефоне' : 'компьютере'} (GigaAM-v3) {status.installed ? <span className="text-emerald-300">установлено</span> : <span className="text-slate-400">не установлено</span>}</p>
      <p className="text-[11px] text-slate-400">
        {android
          ? 'Команды и цифры проверки распознаются прямо на телефоне, из той же записи, по которой сверяется голос. Запись никуда не отправляется, ключ не нужен. Лучше скачивать по Wi‑Fi.'
          : 'Цифры для проверки голоса распознаются прямо здесь, из той же записи, по которой сверяется голос. Запись никуда не отправляется.'}
        {' '}Размер около {status.sizeMb} МБ.
      </p>
      {status.downloading && (
        <div className="space-y-1">
          <div className="h-1.5 rounded bg-white/10 overflow-hidden" role="progressbar" aria-label="Загрузка модели речи" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} /></div>
          <p className="text-[11px] text-slate-400">Скачиваю… {Math.round(status.downloaded / 1048576)} МБ{status.total ? ` из ${Math.round(status.total / 1048576)} МБ` : ''}</p>
        </div>
      )}
      {!status.downloading && !status.installed && (
        <button disabled={busy} onClick={() => run(localSttInstall)} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-xs inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" aria-hidden="true" />Скачать модель</button>
      )}
      {!status.downloading && status.installed && (
        <button disabled={busy} onClick={() => run(localSttRemove)} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 text-xs inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" />Удалить модель</button>
      )}
      {(err || status.error) && !status.downloading && <p role="alert" className="text-[11px] text-amber-300">{err || status.error}</p>}
    </div>
  );
}
