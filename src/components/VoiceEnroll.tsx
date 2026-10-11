// Запись голоса владельца: 3 фразы по 4 секунды. Только после этого включаются голосовые команды.
import { useState } from 'react';
import { Mic, Trash2 } from 'lucide-react';
import { recordPrint } from '../services/voice/VoiceGuard';
import { buildTemplate, saveTemplate, loadTemplate, deleteTemplate, verifyPrint, MIN_ENROLL_SAMPLES, type VoicePrint } from '../services/voice/VoicePrint';

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
      setMsg(r.ok ? `Голос узнан (отличие ${r.score.toFixed(2)} при пороге ${t.distThreshold.toFixed(2)}).` : `${r.reason} (отличие ${Number.isFinite(r.score) ? r.score.toFixed(2) : '—'}, порог ${t.distThreshold.toFixed(2)})`);
    } catch (e: any) { setMsg(e?.message || 'Нет доступа к микрофону'); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
      <p className="font-medium flex items-center gap-1.5"><Mic className="w-4 h-4" />Мой голос {enrolled ? <span className="text-emerald-300 text-xs">записан</span> : <span className="text-amber-300 text-xs">не записан</span>}</p>
      {!enrolled && (
        <>
          <p className="text-xs text-slate-400">Голосовые команды работают только по вашему голосу. Прочитайте вслух 3 фразы (по 4 секунды).</p>
          <p className="text-sm italic text-indigo-200">«{PHRASES[prints.length]}»</p>
          <button disabled={busy} onClick={record} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{busy ? 'Слушаю 4 секунды…' : `Записать фразу ${prints.length + 1} из ${MIN_ENROLL_SAMPLES}`}</button>
        </>
      )}
      {enrolled && (
        <div className="flex gap-2">
          <button disabled={busy} onClick={check} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50">{busy ? 'Слушаю…' : 'Проверить'}</button>
          <button disabled={busy} onClick={() => { if (window.confirm('Удалить запись голоса? Голосовые команды выключатся до новой записи.')) { deleteTemplate(); setEnrolled(false); setMsg(null); } }} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"><Trash2 className="w-4 h-4" />Удалить</button>
        </div>
      )}
      {msg && <p className="text-xs text-indigo-200">{msg}</p>}
      <p className="text-[11px] text-slate-500">Хранится только признак голоса (не запись), только на этом устройстве. Изменения данных голосом всё равно подтверждаются кнопкой: запись голоса можно воспроизвести с телефона.</p>
    </div>
  );
}
