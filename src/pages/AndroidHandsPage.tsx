// «Руки» в приложении для Android: Светлана открывает приложения, нажимает, печатает и читает экран через
// специальные возможности. Простые команды («открой Telegram») работают без ИИ; остальные ИИ превращает
// в список шагов. Любой список телефон показывает в своём окне и выполняет только после «ОК».
import { useEffect, useState } from 'react';
import { Hand, Mic, Send, Loader2, Settings2, CheckCircle2, AlertCircle } from 'lucide-react';
import { aiGateway } from '../services/AIGateway';
import { androidListen, extractActions, handsOpenSettings, handsRun, handsStatus, HANDS_SYSTEM_PROMPT, quickActions, type HandsAction } from '../services/AndroidBridge';

const errText = (e: unknown): string => {
  const m = (e as { message?: unknown } | null)?.message;
  return (typeof m === 'string' && m ? m : String(e ?? '')).slice(0, 300) || 'Неизвестная ошибка';
};

const EXAMPLES = ['открой Telegram', 'что на экране', 'пролистай вниз', 'назад'];

type Line = { who: 'me' | 'sv'; text: string };

export default function AndroidHandsPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [log, setLog] = useState<Line[]>([]);

  const refresh = () => handsStatus().then(s => setEnabled(s.enabled)).catch(() => setEnabled(false));

  useEffect(() => {
    void refresh();
    // Вернулись из настроек телефона — проверяем ещё раз.
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const add = (who: Line['who'], text: string) => setLog(l => [...l.slice(-30), { who, text }]);

  const run = async (input: string) => {
    const t = input.trim();
    if (!t || busy) return;
    setBusy(true);
    setCmd('');
    add('me', t);
    try {
      let actions: HandsAction[] | null = quickActions(t);
      if (!actions) {
        const res = await aiGateway.chat([{ role: 'system', content: HANDS_SYSTEM_PROMPT }, { role: 'user', content: t }], { max_tokens: 800 });
        const parsed = extractActions(res.content ?? '');
        if (parsed.text) add('sv', parsed.text);
        actions = parsed.actions;
        if (!actions.length) {
          if (!parsed.text) add('sv', 'Не поняла, что сделать на телефоне. Скажите проще, например «открой Telegram».');
          return;
        }
      }
      add('sv', (await handsRun(actions)) || 'Готово.');
    } catch (e) {
      add('sv', errText(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const mic = async () => {
    if (listening || busy) return;
    setListening(true);
    let heard = '';
    try {
      heard = await androidListen();
      if (!heard) add('sv', 'Не расслышала. Скажите ещё раз.');
    } catch (e) {
      add('sv', errText(e));
    } finally {
      setListening(false);
    }
    if (heard) await run(heard);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <section className="rounded-xl border border-sv-border bg-white/5 p-4">
        <h2 className="text-lg font-bold flex items-center gap-2"><Hand className="w-5 h-5 text-indigo-300" />Руки Светланы</h2>
        <p className="text-xs text-sv-muted mt-1">
          Светлана открывает приложения, нажимает кнопки, печатает и читает экран. Перед каждой командой телефон покажет шаги и спросит «ОК».
          В самой Светлане руки ничего не нажимают.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {enabled === null && <span className="text-xs text-sv-muted flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" />Проверяю…</span>}
          {enabled === true && <span data-testid="hands-on" className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />Руки включены</span>}
          {enabled === false && (
            <>
              <span className="text-xs text-yellow-300 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />Руки выключены. Открыть приложение можно и без них.</span>
              <button
                onClick={() => void handsOpenSettings().catch(e => add('sv', errText(e)))}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium flex items-center gap-1.5"
              >
                <Settings2 className="w-4 h-4" />Включить руки
              </button>
            </>
          )}
        </div>
        {enabled === false && (
          <p className="text-[11px] text-sv-muted mt-2">В настройках: Специальные возможности → Установленные приложения → «Светлана: руки» → включить. Потом вернитесь сюда.</p>
        )}
      </section>

      <section className="rounded-xl border border-sv-border bg-white/5 p-4">
        <div className="flex gap-2">
          <input
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void run(cmd)}
            placeholder="Например: открой Telegram"
            disabled={busy}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => void mic()}
            disabled={busy || listening}
            aria-label="Сказать команду"
            className={`px-3 py-2 rounded-lg border text-sm ${listening ? 'bg-rose-600 border-rose-500' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'} disabled:opacity-50`}
          >
            {listening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={() => void run(cmd)}
            disabled={busy || !cmd.trim()}
            aria-label="Выполнить"
            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLES.map(x => (
            <button key={x} onClick={() => void run(x)} disabled={busy} className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-sv-muted hover:text-sv-text disabled:opacity-50">{x}</button>
          ))}
        </div>
        <p className="text-[11px] text-sv-muted mt-2">Сложные просьбы («напиши маме в Telegram…») разбирает ИИ, который выбран в «Настройке». Простые команды работают и без ИИ.</p>
      </section>

      {log.length > 0 && (
        <section className="rounded-xl border border-sv-border bg-white/5 p-4 space-y-2" aria-live="polite">
          {log.map((l, i) => (
            <p key={i} className={`text-sm whitespace-pre-wrap ${l.who === 'me' ? 'text-indigo-200' : 'text-sv-text'}`}>
              <span className="text-sv-muted">{l.who === 'me' ? 'Вы: ' : 'Светлана: '}</span>{l.text}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
