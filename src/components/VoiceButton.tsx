// Глобальная кнопка «Голос»: команды бизнеса и CRM голосом с любого экрана + настройки распознавания и озвучки.
// Настройки одинаковые на сайте, в Windows и в Android: запись своего голоса, модель распознавания на
// устройстве (в приложениях), облачное распознавание (Groq/OpenAI), озвучка. В Android без записанного голоса
// слушает распознавание самого телефона (ключ не нужен). Панель закрывается системной кнопкой «Назад» и Escape.
// Панель настроек — модальное окно (useDialogFocus): фокус на «Закрыть», Tab не уходит на страницу под ним,
// а затенение не даёт нажать на страницу мышью или пальцем (нажатие на затенение закрывает панель).
// Уход со страницы отменяет прослушивание (cancel): запоздавшая фраза уже не выполнится как команда.
// Ошибки распознавания показываются понятной фразой (explainVoiceError). Все кнопки не меньше 44 px.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Settings2, X, Volume2, VolumeX } from 'lucide-react';
import { sttSupport, getCloudStt, setCloudStt, resetWebStt, STT_PRESETS, type Listener } from '../services/voice/SpeechEngine';
import { listenCommand } from './Avatar';
import VoiceEnroll from './VoiceEnroll';
import { normalizeSpoken } from '../services/voice/VoiceText';
import { speakText, stopSpeaking, isMuted, setMuted, ttsAvailable } from '../services/voice/Tts';
import { detectCRMIntent, runCRMActions } from '../services/crm/CRMTools';
import { explainVoiceError } from '../services/AiErrors';
import { isAndroidApp } from '../platform';
import { onBack } from '../services/BackStack';
import { useDialogFocus } from './useDialogFocus';

const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50';

const EXAMPLES = [
  'Получил пять тысяч от Петрова за урок',
  'Запиши Иванову на стрижку завтра в пятнадцать ноль ноль',
  'Что у меня завтра',
  'Сколько я заработал',
  'Кто мне должен',
  'Сколько налог',
];

export default function VoiceButton() {
  const [listening, setListening] = useState(false);
  const [bubble, setBubble] = useState<{ heard?: string; reply?: string; error?: string } | null>(null);
  const [settings, setSettings] = useState(false);
  const listenerRef = useRef<Listener | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const l = listenerRef.current;
      listenerRef.current = null;
      if (l) { if (l.cancel) l.cancel(); else l.stop(); }
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, []);

  const show = (b: { heard?: string; reply?: string; error?: string }, ms = 12000) => {
    if (!aliveRef.current) return;
    setBubble(b);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setBubble(null), ms);
  };

  const handle = async (raw: string) => {
    if (!aliveRef.current) return;
    const command = normalizeSpoken(raw);
    if (!command) return;
    const intent = detectCRMIntent(command);
    if (!intent) {
      const reply = 'Это вопрос для разговора. Откройте «Чат со Светланой» и скажите это там. Здесь я выполняю команды: деньги, счета, запись, клиенты.';
      show({ heard: command, reply });
      speakText('Это вопрос для чата. Здесь я выполняю команды про деньги, запись и клиентов.');
      return;
    }
    try {
      const lines = await runCRMActions([intent], 'voice');
      if (!aliveRef.current) return;
      const reply = lines.join('\n');
      show({ heard: command, reply }, 20000);
      speakText(reply);
    } catch {
      show({ heard: command, error: 'Не получилось выполнить команду. Попробуйте ещё раз.' });
    }
  };

  const toggle = () => {
    if (listenerRef.current) { listenerRef.current.stop(); return; }
    stopSpeaking();
    show({ heard: 'Слушаю…' }, 30000);
    const l = listenCommand({
      onPartial: t => show({ heard: t }, 30000),
      onFinal: t => { void handle(t); },
      onError: m => show({ error: explainVoiceError(m) }),
      onEnd: () => { listenerRef.current = null; if (aliveRef.current) setListening(false); },
    });
    listenerRef.current = l;
    setListening(!!l);
    if (!l) setSettings(true);
  };

  const closeSettings = () => {
    setSettings(false);
    settingsBtnRef.current?.focus();
  };

  return (
    <>
      <div className="flex items-center rounded-full bg-fuchsia-600 shadow-lg shadow-fuchsia-900/40 text-white text-sm font-medium">
        <button onClick={toggle} className={`flex items-center gap-2 pl-3 sm:pl-4 pr-3 py-2.5 min-h-11 rounded-l-full ${listening ? 'bg-red-600' : 'hover:bg-fuchsia-700'}`} aria-label={listening ? 'Остановить' : 'Сказать команду'} aria-pressed={listening}>
          {listening ? <MicOff className="w-4 h-4" aria-hidden="true" /> : <Mic className="w-4 h-4" aria-hidden="true" />}Голос
        </button>
        <button ref={settingsBtnRef} onClick={() => setSettings(s => !s)} className="pl-2 pr-3 py-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-r-full hover:bg-fuchsia-700 border-l border-white/20" aria-label="Настройки голоса" aria-expanded={settings} aria-haspopup="dialog">
          <Settings2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {bubble && (
        <div role={bubble.error ? 'alert' : 'status'} className="fixed bottom-20 left-3 right-3 sm:right-auto sm:left-5 z-40 sm:max-w-sm rounded-xl bg-slate-900/95 border border-white/10 p-3 text-sm text-white shadow-xl space-y-1">
          <button className="float-right -mt-2 -mr-2 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-white" onClick={() => setBubble(null)} aria-label="Закрыть"><X className="w-4 h-4" aria-hidden="true" /></button>
          {bubble.heard && <p className="text-slate-300 italic">«{bubble.heard}»</p>}
          {bubble.reply && <p className="whitespace-pre-line">{bubble.reply}</p>}
          {bubble.error && <p className="text-amber-300">{bubble.error}</p>}
        </div>
      )}
      {settings && <VoiceSettings onClose={closeSettings} />}
    </>
  );
}

function VoiceSettings({ onClose }: { onClose: () => void }) {
  const android = isAndroidApp();
  const current = getCloudStt();
  const [preset, setPreset] = useState(STT_PRESETS.find(p => p.baseUrl === current?.baseUrl)?.id ?? 'groq');
  const p = STT_PRESETS.find(x => x.id === preset) ?? STT_PRESETS[0];
  const [key, setKey] = useState(current?.apiKey ?? '');
  const [muted, setMutedState] = useState(isMuted());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const s = sttSupport();

  useEffect(() => onBack(onClose), []);
  useDialogFocus(panelRef, onClose, closeRef);

  const save = () => {
    setErr(null);
    try {
      setCloudStt(key.trim() ? { baseUrl: p.baseUrl, apiKey: key, model: p.model } : null);
      resetWebStt();
    } catch {
      setMsg(null);
      setErr('Не удалось сохранить. Проверьте, что выбран Groq или OpenAI, и попробуйте ещё раз.');
      return;
    }
    setMsg(key.trim()
      ? (android ? 'Сохранено. Если модель на телефон не скачана, голос будет проверяться через облачное распознавание.' : 'Сохранено. Если встроенное распознавание не сработает, включится облачное.')
      : 'Облачное распознавание отключено.');
  };

  const now = s.mode === 'native' ? 'распознавание телефона' : s.mode === 'web' ? 'встроенное распознавание' : s.mode === 'cloud' ? 'облачное распознавание' : 'распознавание не настроено';

  return (
    <>
    <div data-testid="voice-settings-backdrop" aria-hidden="true" className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="voice-settings-title" className="fixed bottom-20 left-3 sm:left-5 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto rounded-xl bg-slate-900/98 border border-white/10 p-4 text-sm text-white shadow-2xl space-y-3 focus:outline-none">
      <div className="flex items-center justify-between">
        <h3 id="voice-settings-title" className="font-semibold">Голос Светланы</h3>
        <button ref={closeRef} onClick={onClose} className="-mr-2 min-w-11 min-h-11 flex items-center justify-center text-slate-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 rounded" aria-label="Закрыть настройки голоса"><X className="w-4 h-4" aria-hidden="true" /></button>
      </div>
      {android && (
        <p data-testid="android-voice" className="text-xs text-slate-300">
          Пока голос не записан, слушает распознавание самого телефона (ключ не нужен), а команды выполняются после нажатия кнопки подтверждения.
          Запишите голос и скачайте модель (или вставьте ключ Groq): тогда, как на компьютере, команды принимаются только по вашему голосу и работает «Светлана, …» без рук.
          Если телефон не слышит: настройки телефона → Приложения → Светлана → Разрешения → Микрофон.
        </p>
      )}
      <VoiceEnroll />
      <p className="text-xs text-slate-400">
        Сейчас: {now}.{' '}
        {android
          ? 'Облачное распознавание нужно, только если не хотите скачивать модель на телефон. Ключ Groq бесплатный.'
          : 'В браузере Chrome/Edge работает встроенное. В приложении для Windows нужно облачное — ключ Groq бесплатный.'}
      </p>
      <div className="flex gap-2" role="group" aria-label="Сервис распознавания">
        {STT_PRESETS.map(x => (
          <button key={x.id} onClick={() => setPreset(x.id)} aria-pressed={preset === x.id} className={`px-3 py-2 min-h-11 rounded-lg text-xs ${preset === x.id ? 'bg-indigo-600' : 'bg-white/5 hover:bg-white/10'}`}>{x.title}</button>
        ))}
      </div>
      <label htmlFor="voice-stt-key" className="block text-xs text-slate-300">Ключ {p.title}</label>
      <input id="voice-stt-key" className={input} type="password" autoComplete="off" placeholder="API-ключ" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
      <a className="text-xs text-indigo-300 underline" href={p.keyUrl} target="_blank" rel="noreferrer">Получить ключ {p.title}</a>
      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-2 min-h-11 rounded-lg bg-indigo-600 hover:bg-indigo-700" onClick={save}>Сохранить</button>
        {ttsAvailable() && (
          <button className="px-3 py-2 min-h-11 rounded-lg bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5" aria-pressed={!muted} onClick={() => { const m = !muted; setMuted(m); setMutedState(m); }}>
            {muted ? <VolumeX className="w-4 h-4" aria-hidden="true" /> : <Volume2 className="w-4 h-4" aria-hidden="true" />}{muted ? 'Озвучка выкл.' : 'Озвучка вкл.'}
          </button>
        )}
        {ttsAvailable() && <button className="px-3 py-2 min-h-11 rounded-lg bg-white/5 hover:bg-white/10" onClick={() => speakText('Привет! Я Светлана. Слышно меня?', { force: true })}>Тест</button>}
      </div>
      {msg && <p role="status" className="text-xs text-indigo-200">{msg}</p>}
      {err && <p role="alert" className="text-xs text-amber-300">{err}</p>}
      <div className="text-xs text-slate-400">
        <p className="mb-1">Попробуйте сказать:</p>
        {EXAMPLES.map(e => <p key={e}>• {e}</p>)}
      </div>
      <p className="text-[11px] text-slate-400">Ключ хранится только на этом устройстве. Запись голоса уходит в выбранный сервис только при нажатии «Голос».</p>
    </div>
    </>
  );
}
