// Глобальная кнопка «Голос»: команды бизнеса и CRM голосом с любого экрана + настройки распознавания и озвучки.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Settings2, X, Volume2, VolumeX } from 'lucide-react';
import { listen, sttSupport, getCloudStt, setCloudStt, resetWebStt, STT_PRESETS, type Listener } from '../services/voice/SpeechEngine';
import { normalizeSpoken } from '../services/voice/VoiceText';
import { speakText, stopSpeaking, isMuted, setMuted, ttsAvailable } from '../services/voice/Tts';
import { detectCRMIntent, runCRMActions } from '../services/crm/CRMTools';

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

  useEffect(() => () => { listenerRef.current?.stop(); if (hideRef.current) clearTimeout(hideRef.current); }, []);

  const show = (b: { heard?: string; reply?: string; error?: string }, ms = 12000) => {
    setBubble(b);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setBubble(null), ms);
  };

  const handle = async (raw: string) => {
    const command = normalizeSpoken(raw);
    if (!command) return;
    const intent = detectCRMIntent(command);
    if (!intent) {
      const reply = 'Это вопрос для разговора. Откройте чат «Аватар и голос» и скажите это там. Здесь я выполняю команды: деньги, счета, запись, клиенты.';
      show({ heard: command, reply });
      speakText('Это вопрос для чата. Здесь я выполняю команды про деньги, запись и клиентов.');
      return;
    }
    const lines = await runCRMActions([intent]);
    const reply = lines.join('\n');
    show({ heard: command, reply }, 20000);
    speakText(reply);
  };

  const toggle = () => {
    if (listenerRef.current) { listenerRef.current.stop(); return; }
    stopSpeaking();
    show({ heard: 'Слушаю…' }, 30000);
    const l = listen({
      onPartial: t => show({ heard: t }, 30000),
      onFinal: t => { void handle(t); },
      onError: m => show({ error: m }),
      onEnd: () => { listenerRef.current = null; setListening(false); },
    });
    listenerRef.current = l;
    setListening(!!l);
    if (!l) setSettings(true);
  };

  return (
    <>
      <div className="flex items-center rounded-full bg-fuchsia-600 shadow-lg shadow-fuchsia-900/40 text-white text-sm font-medium">
        <button onClick={toggle} className={`flex items-center gap-2 pl-4 pr-3 py-2.5 rounded-l-full ${listening ? 'bg-red-600' : 'hover:bg-fuchsia-700'}`} aria-label={listening ? 'Остановить' : 'Сказать команду'}>
          {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}Голос
        </button>
        <button onClick={() => setSettings(s => !s)} className="pl-2 pr-3 py-2.5 rounded-r-full hover:bg-fuchsia-700 border-l border-white/20" aria-label="Настройки голоса">
          <Settings2 className="w-4 h-4" />
        </button>
      </div>
      {bubble && (
        <div className="fixed bottom-20 left-5 z-40 max-w-sm rounded-xl bg-slate-900/95 border border-white/10 p-3 text-sm text-white shadow-xl space-y-1">
          <button className="float-right text-slate-400 hover:text-white" onClick={() => setBubble(null)} aria-label="Закрыть"><X className="w-4 h-4" /></button>
          {bubble.heard && <p className="text-slate-300 italic">«{bubble.heard}»</p>}
          {bubble.reply && <p className="whitespace-pre-line">{bubble.reply}</p>}
          {bubble.error && <p className="text-amber-300">{bubble.error}</p>}
        </div>
      )}
      {settings && <VoiceSettings onClose={() => setSettings(false)} />}
    </>
  );
}

function VoiceSettings({ onClose }: { onClose: () => void }) {
  const current = getCloudStt();
  const [preset, setPreset] = useState(STT_PRESETS.find(p => p.baseUrl === current?.baseUrl)?.id ?? 'groq');
  const p = STT_PRESETS.find(x => x.id === preset) ?? STT_PRESETS[0];
  const [key, setKey] = useState(current?.apiKey ?? '');
  const [muted, setMutedState] = useState(isMuted());
  const [msg, setMsg] = useState<string | null>(null);
  const s = sttSupport();

  const save = () => {
    setCloudStt(key.trim() ? { baseUrl: p.baseUrl, apiKey: key, model: p.model } : null);
    resetWebStt();
    setMsg(key.trim() ? 'Сохранено. Если встроенное распознавание не сработает, включится облачное.' : 'Облачное распознавание отключено.');
  };

  return (
    <div className="fixed bottom-20 left-5 z-50 w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-xl bg-slate-900/98 border border-white/10 p-4 text-sm text-white shadow-2xl space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Голос Светланы</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Закрыть"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-xs text-slate-400">
        Сейчас: {s.mode === 'web' ? 'встроенное распознавание' : s.mode === 'cloud' ? 'облачное распознавание' : 'распознавание не настроено'}.
        В браузере Chrome/Edge работает встроенное. В приложении на Windows и Android обычно нужно облачное — ключ Groq бесплатный.
      </p>
      <div className="flex gap-2">
        {STT_PRESETS.map(x => (
          <button key={x.id} onClick={() => setPreset(x.id)} className={`px-3 py-1.5 rounded-lg text-xs ${preset === x.id ? 'bg-indigo-600' : 'bg-white/5 hover:bg-white/10'}`}>{x.title}</button>
        ))}
      </div>
      <input className={input} type="password" placeholder="API-ключ" value={key} onChange={e => setKey(e.target.value)} />
      <a className="text-xs text-indigo-300 underline" href={p.keyUrl} target="_blank" rel="noreferrer">Получить ключ {p.title}</a>
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700" onClick={save}>Сохранить</button>
        {ttsAvailable() && (
          <button className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5" onClick={() => { const m = !muted; setMuted(m); setMutedState(m); }}>
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}{muted ? 'Озвучка выкл.' : 'Озвучка вкл.'}
          </button>
        )}
        {ttsAvailable() && <button className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10" onClick={() => speakText('Привет! Я Светлана. Слышно меня?', { force: true })}>Тест</button>}
      </div>
      {msg && <p className="text-xs text-indigo-200">{msg}</p>}
      <div className="text-xs text-slate-400">
        <p className="mb-1">Попробуйте сказать:</p>
        {EXAMPLES.map(e => <p key={e}>• {e}</p>)}
      </div>
      <p className="text-[11px] text-slate-500">Ключ хранится только на этом устройстве. Запись голоса уходит в выбранный сервис только при нажатии «Голос».</p>
    </div>
  );
}
