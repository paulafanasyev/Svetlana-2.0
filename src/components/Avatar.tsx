import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2, VolumeX, Settings, X } from 'lucide-react';
import { SVETLANA_IDENTITY, getAvatarStateOverlay, getAvatarStateFromEmotion } from '../services/AvatarIdentity';

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

// Voice Control Component
export function VoiceControl({ onCommand }: { onCommand?: (command: string) => void }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'ru-RU';

      recognitionRef.current.onresult = (event: any) => {
        const text = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setTranscript(text);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        if (transcript && onCommand) {
          onCommand(transcript);
        }
      };
    }
  }, [onCommand, transcript]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setTranscript('');
      recognitionRef.current.start();
      setIsListening(true);
    }
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

      <div className="text-center">
        <p className="text-sm text-sv-muted">
          {isListening ? 'Слушаю...' : 'Нажмите для голосового ввода'}
        </p>
        {transcript && (
          <p className="text-sm text-indigo-300 mt-1 italic">"{transcript}"</p>
        )}
      </div>
    </div>
  );
}

// Text-to-Speech
export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const speak = (text: string, voiceIndex?: number) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.0;
    utterance.pitch = 1.1;

    if (voiceIndex !== undefined && voices[voiceIndex]) {
      utterance.voice = voices[voiceIndex];
    } else {
      // Try to find a Russian female voice
      const russianVoice = voices.find(v => v.lang.includes('ru') && v.name.toLowerCase().includes('female'));
      if (russianVoice) utterance.voice = russianVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const stop = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  return { speak, stop, isSpeaking, voices };
}
