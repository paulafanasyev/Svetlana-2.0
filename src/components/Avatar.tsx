import { useState, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SVETLANA_IDENTITY } from '../services/AvatarIdentity';
import { Mic, MicOff } from 'lucide-react';
import { listen, sttSupport, recordedRecognizer, type Listener, type ListenOptions } from '../services/voice/SpeechEngine';
import { listenVerified, verifiedVoiceReady } from '../services/voice/VoiceGuard';
import { hasWakeWord, normalizeSpoken, pickRussianVoice } from '../services/voice/VoiceText';
import { speakText, speakingNow, stopSpeaking, ttsAvailable } from '../services/voice/Tts';
import { explainVoiceError } from '../services/AiErrors';
import AnimatedAvatarFace from './AnimatedAvatarFace';
import { isAndroidApp } from '../platform';

type Emotion = 'neutral' | 'happy' | 'sad' | 'laughing' | 'crying' | 'surprised' | 'talking';

// Single master image for all states - unified identity
const MASTER_AVATAR = SVETLANA_IDENTITY.masterImage;

/** Подписи эмоций для подсказки и экранного диктора. */
const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: 'Спокойная', happy: 'Радуется', sad: 'Грустит', laughing: 'Смеётся',
  crying: 'Плачет', surprised: 'Удивлена', talking: 'Говорит',
};

interface AvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  interactive?: boolean;
  emotion?: Emotion;
  onEmotionChange?: (emotion: Emotion) => void;
  /** Идёт озвучка ответа: свечение у «рта». */
  talking?: boolean;
  /** Микрофон включён: пульсирующее кольцо. */
  listening?: boolean;
  /** Текст текущей озвучки для синхронизации формы рта. */
  speechText?: string;
}

export default function Avatar({ size = 'lg', interactive = false, emotion: externalEmotion, onEmotionChange, talking = false, listening = false, speechText = '' }: AvatarProps) {
  const [currentEmotion, setCurrentEmotion] = useState<Emotion>(externalEmotion || 'neutral');
  const isTalking = talking;
  const isListening = listening;
  const [showControls, setShowControls] = useState(false);
  // В системе включено «Уменьшить движение»: индикаторы стоят на месте, без пульсации.
  const still = useReducedMotion() ?? false;

  useEffect(() => {
    if (externalEmotion) setCurrentEmotion(externalEmotion);
  }, [externalEmotion]);

  const setEmotion = (emotion: Emotion) => {
    setCurrentEmotion(emotion);
    onEmotionChange?.(emotion);
  };

  // На телефоне аватар меньше: xl занимал бы весь экран.
  const sizeClasses = {
    sm: 'w-24 h-24',
    md: 'w-40 h-40',
    lg: 'w-48 h-48 sm:w-64 sm:h-64',
    xl: 'w-56 h-56 sm:w-96 sm:h-96',
  };

  const stateText = isListening ? 'Светлана слушает' : isTalking ? 'Светлана говорит' : '';

  // Светлану можно нажать и мышкой, и с клавиатуры (Tab, затем Enter или пробел); экранный диктор видит её как кнопку.
  const toggleControls = () => setShowControls(v => !v);
  const pressable = interactive
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': 'Светлана: выбрать эмоцию',
        'aria-expanded': showControls,
        onClick: toggleControls,
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleControls(); }
          if (e.key === 'Escape' && showControls) { e.stopPropagation(); setShowControls(false); }
        },
      }
    : {};

  return (
    <div className="relative inline-block">
      {/* Для экранных читалок: то же, что показывают кольцо и свечение */}
      <span role="status" data-testid="avatar-state" className="sr-only">{stateText}</span>

      {/* Main Avatar */}
      <div
        className={`relative ${sizeClasses[size]} rounded-full overflow-hidden ${interactive ? 'cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400' : ''} shadow-2xl shadow-indigo-500/20 border-4 border-indigo-500/30`}
        {...pressable}
      >
        {/* Single master identity with state overlays */}
        <AnimatedAvatarFace
          src={MASTER_AVATAR}
          emotion={currentEmotion}
          talking={isTalking}
          speechText={speechText}
          reducedMotion={still}
        />

        {/* Listening indicator */}
        {isListening && (
          <motion.div
            data-testid="avatar-listening"
            className="absolute inset-0 rounded-full border-4 border-cyan-400"
            animate={still ? { opacity: 1 } : { scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
            transition={still ? { duration: 0 } : { duration: 1.5, repeat: Infinity }}
          />
        )}

        {/* Glow effect */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-t from-indigo-600/10 to-transparent pointer-events-none" />
      </div>

      {/* Emotion Controls: кнопки 44 px, чтобы попадать пальцем */}
      {interactive && showControls && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          role="group"
          aria-label="Эмоции Светланы"
          className="absolute -bottom-16 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 p-1.5 rounded-xl bg-sv-darker/95 border border-sv-border backdrop-blur-xl"
        >
          {(['neutral', 'happy', 'sad', 'laughing', 'crying', 'surprised'] as Emotion[]).map(emotion => (
            <button
              key={emotion}
              onClick={() => setEmotion(emotion)}
              className={`w-11 h-11 rounded-full flex items-center justify-center text-base transition-all ${
                currentEmotion === emotion ? 'bg-indigo-500 text-white' : 'bg-white/10 text-sv-muted hover:bg-white/20'
              }`}
              title={EMOTION_LABELS[emotion]}
              aria-label={EMOTION_LABELS[emotion]}
              aria-pressed={currentEmotion === emotion}
            >
              {emotion === 'neutral' && '😐'}
              {emotion === 'happy' && '😊'}
              {emotion === 'sad' && '😢'}
              {emotion === 'laughing' && '😂'}
              {emotion === 'crying' && '😭'}
              {emotion === 'surprised' && '😮'}
            </button>
          ))}
        </motion.div>
      )}

      {/* Name tag */}
      {size !== 'sm' && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 backdrop-blur-xl">
          <span className="text-xs font-medium text-indigo-300">Светлана</span>
        </div>
      )}
    </div>
  );
}

/** Не слушаем саму себя: идёт озвучка (браузер, Windows или голос телефона). */
const selfSpeaking = (): boolean => speakingNow();

/**
 * Слушать голосовую команду с проверкой голоса владельца (VoiceGuard) — на сайте, в Windows и в Android.
 * В Android для этого нужен записанный голос и распознавание записи (GigaAM на телефоне или Groq): тогда как
 * на компьютере. Пока этого нет, слушает распознавание телефона: команда идёт как «голосовая», любое
 * действие CRM только после нажатия кнопки (ActionGate), данные CRM из голоса в ИИ не уходят.
 */
export function listenCommand(opts: ListenOptions & { accept?: (text: string) => boolean }): Listener | null {
  if (isAndroidApp() && !verifiedVoiceReady()) return listen(opts);
  return listenVerified(opts);
}

// Voice Control Component: Web Speech API where available, otherwise cloud or on-device speech-to-text (see services/voice).
// Hands-free mode: always listening, reacts to phrases that start with «Светлана, …».
// Every phrase is checked against the owner's voiceprint (VoiceGuard): other voices are ignored.
// The first command also needs 3 random digits spoken aloud (protection against a recorded voice).
// onListeningChange — микрофон включён/выключен (для кольца на аватаре).
// Ошибки распознавания показываются понятной фразой (explainVoiceError), а не текстом сервиса.
// Подпись режима распознавания — обычный приглушённый текст 12 px без прозрачности (контраст около 7:1).
export function VoiceControl({ onCommand, onListeningChange }: { onCommand?: (command: string) => void; onListeningChange?: (listening: boolean) => void }) {
  const [isListening, setIsListening] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const tokenRef = useRef<object | null>(null);
  const onCommandRef = useRef(onCommand);
  const onListeningRef = useRef(onListeningChange);
  const still = useReducedMotion() ?? false;
  const support = sttSupport();
  const android = isAndroidApp();
  // Телефон с записанным голосом и распознаванием записи слушает как компьютер (в том числе «без рук»).
  const phoneVerified = android && verifiedVoiceReady();
  const phoneStt = phoneVerified ? recordedRecognizer()?.mode : undefined;

  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => { onListeningRef.current = onListeningChange; }, [onListeningChange]);
  useEffect(() => { onListeningRef.current?.(isListening); }, [isListening]);
  // Уход со страницы: микрофон выключен, кольцо погасло, поздние ответы распознавания уже ничего не меняют.
  useEffect(() => () => { tokenRef.current = null; listenerRef.current?.stop(); onListeningRef.current?.(false); }, []);

  const start = (continuous: boolean) => {
    setError(null);
    setTranscript('');
    const token = {};
    tokenRef.current = token;
    const live = () => tokenRef.current === token;
    const listener = listenCommand({
      continuous,
      // не слушаем саму себя; в режиме «без рук» проверяем только фразы «Светлана, …»
      accept: t => !selfSpeaking() && (!continuous || hasWakeWord(t)),
      onPartial: t => { if (live()) setTranscript(t); },
      onFinal: t => {
        if (!live() || selfSpeaking()) return; // слушание уже закончено или это говорит сама Светлана
        setTranscript(t);
        if (continuous && !hasWakeWord(t)) return;
        const command = normalizeSpoken(t);
        if (command) onCommandRef.current?.(command);
      },
      onError: m => { if (live()) setError(explainVoiceError(m)); },
      onEnd: () => {
        if (!live()) return;
        listenerRef.current = null;
        setIsListening(false);
        setHandsFree(false);
      },
    });
    listenerRef.current = listener;
    setIsListening(!!listener);
    setHandsFree(!!listener && continuous);
  };

  const stopListening = () => {
    listenerRef.current?.stop();
    if (handsFree) { tokenRef.current = null; listenerRef.current = null; setIsListening(false); setHandsFree(false); }
  };

  const toggleListening = () => {
    if (listenerRef.current) stopListening(); else start(false);
  };

  const toggleHandsFree = () => {
    if (handsFree) stopListening();
    else { listenerRef.current?.stop(); start(true); }
  };

  const modeText = android
    ? phoneVerified
      ? `Распознавание: ${phoneStt === 'local' ? 'на телефоне (GigaAM)' : 'облачное'} · только ваш голос`
      : 'Распознавание: голос телефона · действия вы подтверждаете кнопкой. Запишите голос и скачайте модель (Голос → настройки), чтобы включить «Светлана, …» без рук'
    : `${support.mode === 'web' ? 'Распознавание: встроенное' : support.mode === 'cloud' ? 'Распознавание: облачное' : 'Распознавание не настроено: кнопка «Голос» внизу слева → настройки'} · только ваш голос`;

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={toggleListening}
        className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all ${
          isListening
            ? 'bg-red-500/20 border-2 border-red-500 shadow-lg shadow-red-500/30'
            : 'bg-indigo-500/20 border-2 border-indigo-500/50 hover:bg-indigo-500/30'
        }`}
        aria-label={isListening ? 'Остановить' : 'Говорить'}
      >
        {isListening ? (
          <MicOff className="w-8 h-8 text-red-400" />
        ) : (
          <Mic className="w-8 h-8 text-indigo-400" />
        )}

        {isListening && !still && (
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-red-400"
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
      </button>

      <div className="text-center space-y-1">
        <p className="text-sm text-sv-muted" role="status">
          {handsFree ? 'Слушаю постоянно. Начните со слова «Светлана»' : isListening ? 'Слушаю...' : 'Нажмите и скажите команду'}
        </p>
        {transcript && <p className="text-sm text-indigo-300 italic">"{transcript}"</p>}
        {error && <p className="text-xs text-amber-300" role="alert">{error}</p>}
        {((support.web && !android) || phoneVerified) && (
          <button data-testid="hands-free" onClick={toggleHandsFree} aria-pressed={handsFree} className={`text-xs px-3 py-2 min-h-11 rounded-full border ${handsFree ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-sv-muted hover:bg-white/10'}`}>
            {handsFree ? 'Режим «Светлана, …» включён' : 'Включить «Светлана, …» без рук'}
          </button>
        )}
        <p data-testid="voice-mode" className="text-xs text-sv-muted">{modeText}</p>
      </div>
    </div>
  );
}

// Text-to-Speech
export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechText, setSpeechText] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    // В Android говорит синтез самого телефона (Tts.ts), window.speechSynthesis там нет.
    if (isAndroidApp() || !ttsAvailable() || typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const loadVoices = () => setVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    return () => synth.removeEventListener?.('voiceschanged', loadVoices);
  }, []);

  const speak = (text: string, voiceIndex?: number) => {
    const voice = voiceIndex !== undefined ? voices[voiceIndex] : pickRussianVoice(voices);
    setSpeechText(text);
    speakText(text, {
      voice,
      onStart: () => setIsSpeaking(true),
      onEnd: () => { setIsSpeaking(false); setSpeechText(''); },
    });
  };

  const stop = () => {
    stopSpeaking();
    setIsSpeaking(false);
    setSpeechText('');
  };

  return { speak, stop, isSpeaking, voices, speechText };
}
