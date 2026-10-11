import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2, VolumeX, Settings, X } from 'lucide-react';
import { SVETLANA_IDENTITY, getAvatarStateOverlay, getAvatarStateFromEmotion } from '../services/AvatarIdentity';
import { listen, sttSupport, type Listener } from '../services/voice/SpeechEngine';
import { hasWakeWord, normalizeSpoken, pickRussianVoice } from '../services/voice/VoiceText';
import { speakText, stopSpeaking, ttsAvailable } from '../services/voice/Tts';

type Emotion = 'neutral' | 'happy' | 'sad' | 'laughing' | 'crying' | 'surprised' | 'talking';

// Single master image for all states - unified identity
const MASTER_AVATAR = SVETLANA_IDENTITY.masterImage;

interface AvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  interactive?: boolean;
  emotion?: Emotion;
  onEmotionChange?: (emotion: Emotion) => void;
}

export default function Avatar({ size = 'lg', interactive = false, emotion: externalEmotion, onEmotionChange }: AvatarProps) {
  const [currentEmotion, setCurrentEmotion] = useState<Emotion>(externalEmotion || 'neutral');
  const [isTalking, setIsTalking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    if (externalEmotion) setCurrentEmotion(externalEmotion);
  }, [externalEmotion]);

  const setEmotion = (emotion: Emotion) => {
    setCurrentEmotion(emotion);
    onEmotionChange?.(emotion);
  };

  const sizeClasses = {
    sm: 'w-24 h-24',
    md: 'w-40 h-40',
    lg: 'w-64 h-64',
    xl: 'w-96 h-96',
  };

  return (
    <div className="relative inline-block">
      {/* Main Avatar */}
      <div
        className={`relative ${sizeClasses[size]} rounded-full overflow-hidden cursor-pointer shadow-2xl shadow-indigo-500/20 border-4 border-indigo-500/30`}
        onClick={() => interactive && setShowControls(!showControls)}
      >
        {/* Single master identity with state overlays */}
        <motion.img
          src={MASTER_AVATAR}
          alt="Svetlana"
          className={`w-full h-full object-cover transition-all duration-300 ${getAvatarStateOverlay(getAvatarStateFromEmotion(currentEmotion)).overlay || ''}`}
          animate={getAvatarStateOverlay(getAvatarStateFromEmotion(currentEmotion)).animation === 'pulse' ? { scale: [1, 1.02, 1] } : {}}
          transition={getAvatarStateOverlay(getAvatarStateFromEmotion(currentEmotion)).animation === 'pulse' ? { duration: 2, repeat: Infinity } : {}}
        />

        {/* Talking overlay animation */}
        {isTalking && (
          <motion.div
            className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-indigo-500/20 to-transparent"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          />
        )}

        {/* Listening indicator */}
        {isListening && (
          <motion.div
            className="absolute inset-0 rounded-full border-4 border-cyan-400"
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}

        {/* Glow effect */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-t from-indigo-600/10 to-transparent pointer-events-none" />
      </div>

      {/* Emotion Controls */}
      {interactive && showControls && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -bottom-16 left-1/2 -translate-x-1/2 flex gap-2 p-2 rounded-xl bg-sv-darker/95 border border-sv-border backdrop-blur-xl"
        >
          {(['neutral', 'happy', 'sad', 'laughing', 'crying', 'surprised'] as Emotion[]).map(emotion => (
            <button
              key={emotion}
              onClick={() => setEmotion(emotion)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${
                currentEmotion === emotion ? 'bg-indigo-500 text-white' : 'bg-white/10 text-sv-muted hover:bg-white/20'
              }`}
              title={emotion}
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

// Voice Control Component: Web Speech API where available, otherwise cloud speech-to-text (see services/voice).
// Hands-free mode: always listening, reacts to phrases that start with «Светлана, …».
export function VoiceControl({ onCommand }: { onCommand?: (command: string) => void }) {
  const [isListening, setIsListening] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const tokenRef = useRef<object | null>(null);
  const onCommandRef = useRef(onCommand);
  const support = sttSupport();

  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => () => listenerRef.current?.stop(), []);

  const start = (continuous: boolean) => {
    setError(null);
    setTranscript('');
    const token = {};
    tokenRef.current = token;
    const listener = listen({
      continuous,
      onPartial: t => setTranscript(t),
      onFinal: t => {
        if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) return; // не слушаем саму себя
        setTranscript(t);
        if (continuous && !hasWakeWord(t)) return;
        const command = normalizeSpoken(t);
        if (command) onCommandRef.current?.(command);
      },
      onError: m => setError(m),
      onEnd: () => {
        if (tokenRef.current !== token) return;
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

        {isListening && (
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-red-400"
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
      </button>

      <div className="text-center space-y-1">
        <p className="text-sm text-sv-muted">
          {handsFree ? 'Слушаю постоянно. Начните со слова «Светлана»' : isListening ? 'Слушаю...' : 'Нажмите и скажите команду'}
        </p>
        {transcript && <p className="text-sm text-indigo-300 italic">"{transcript}"</p>}
        {error && <p className="text-xs text-amber-300">{error}</p>}
        {support.web && (
          <button onClick={toggleHandsFree} className={`text-xs px-3 py-1 rounded-full border ${handsFree ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-sv-muted hover:bg-white/10'}`}>
            {handsFree ? 'Режим «Светлана, …» включён' : 'Включить «Светлана, …» без рук'}
          </button>
        )}
        <p className="text-[11px] text-sv-muted opacity-60">
          {support.mode === 'web' ? 'Распознавание: встроенное' : support.mode === 'cloud' ? 'Распознавание: облачное' : 'Распознавание не настроено: кнопка «Голос» внизу слева → настройки'}
        </p>
      </div>
    </div>
  );
}

// Text-to-Speech
export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!ttsAvailable()) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const speak = (text: string, voiceIndex?: number) => {
    const voice = voiceIndex !== undefined ? voices[voiceIndex] : pickRussianVoice(voices);
    speakText(text, { voice, onStart: () => setIsSpeaking(true), onEnd: () => setIsSpeaking(false) });
  };

  const stop = () => {
    stopSpeaking();
    setIsSpeaking(false);
  };

  return { speak, stop, isSpeaking, voices };
}
