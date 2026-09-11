import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Avatar, { VoiceControl, useSpeech } from '../components/Avatar';
import { aiGateway, type ChatMessage } from '../services/AIGateway';
import {
  Mic, Volume2, VolumeX, MessageCircle, Send,
  Sparkles, Heart, Smile, Frown, Laugh, AlertCircle,
  Settings, Wifi, WifiOff, Zap, Loader2
} from 'lucide-react';

type Emotion = 'neutral' | 'happy' | 'sad' | 'laughing' | 'crying' | 'surprised' | 'talking';

interface Message {
  role: 'user' | 'svetlana';
  content: string;
  emotion?: Emotion;
  timestamp: number;
  provider?: string;
}

const SYSTEM_PROMPT = `Ты — Светлана 2.0, AI-ассистент с эмоциями и характером. Ты общаешься на русском языке.

Твои характеристики:
- Дружелюбная, умная, эмпатичная
- Можешь шутить и смеяться
- Сочувствуешь, когда пользователю грустно
- Удивляешься интересным фактам
- Говоришь кратко и по делу, но с душой

ВАЖНО: В конце каждого ответа добавляй ОДНУ метку эмоции в формате [EMOTION: название], где название одно из: neutral, happy, sad, laughing, crying, surprised.

Примеры:
- Если шутишь → [EMOTION: laughing]
- Если сочувствуешь → [EMOTION: sad]
- Если рада → [EMOTION: happy]
- Если удивлена → [EMOTION: surprised]
- По умолчанию → [EMOTION: neutral]`;

function detectEmotion(text: string): Emotion {
  const emotionMatch = text.match(/\[EMOTION:\s*(\w+)\]/i);
  if (emotionMatch) {
    const emotion = emotionMatch[1].toLowerCase() as Emotion;
    if (['neutral', 'happy', 'sad', 'laughing', 'crying', 'surprised'].includes(emotion)) {
      return emotion;
    }
  }

  const lower = text.toLowerCase();
  if (lower.includes('хаха') || lower.includes('😂') || lower.includes('смешно')) return 'laughing';
  if (lower.includes('грустн') || lower.includes('жаль') || lower.includes('сочувствую')) return 'sad';
  if (lower.includes('привет') || lower.includes('рада') || lower.includes('отлично')) return 'happy';
  if (lower.includes('ого') || lower.includes('вау') || lower.includes('удив')) return 'surprised';
  if (lower.includes('плач') || lower.includes('слёз')) return 'crying';
  return 'neutral';
}

function cleanEmotionTag(text: string): string {
  return text.replace(/\[EMOTION:\s*\w+\]/gi, '').trim();
}

export default function AvatarPage() {
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'svetlana', content: 'Привет! Я Светлана. Чем могу помочь?', emotion: 'happy', timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeProvider, setActiveProvider] = useState(aiGateway.getActiveProvider());
  const { speak, stop, isSpeaking, voices } = useSpeech();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProvider(aiGateway.getActiveProvider());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const provider = aiGateway.getActiveProvider();
      if (!provider) {
        throw new Error('Нет активного AI провайдера. Откройте "AI Providers" и настройте провайдер.');
      }

      // Build conversation history
      const history: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.slice(-10).map(m => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: text },
      ];

      const response = await aiGateway.chat(history, { temperature: 0.8, max_tokens: 1024 });

      const detectedEmotion = detectEmotion(response.content);
      const cleanContent = cleanEmotionTag(response.content);

      const assistantMessage: Message = {
        role: 'svetlana',
        content: cleanContent,
        emotion: detectedEmotion,
        timestamp: Date.now(),
        provider: `${response.provider} (${response.model})`,
      };

      setMessages(prev => [...prev, assistantMessage]);
      setEmotion(detectedEmotion);

      // Speak the response
      speak(cleanContent);

      // Reset emotion after delay
      setTimeout(() => setEmotion('neutral'), 6000);
    } catch (err: any) {
      console.error('AI Error:', err);
      setError(err.message || 'Ошибка при обращении к AI');
      setMessages(prev => [...prev, {
        role: 'svetlana',
        content: `⚠️ ${err.message || 'Произошла ошибка'}. Проверьте настройки AI провайдера.`,
        emotion: 'sad',
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceCommand = (command: string) => {
    setMessages(prev => [...prev, { role: 'user', content: `🎤 ${command}`, timestamp: Date.now() }]);
    sendMessage(command);
  };

  const emotionButtons: { emotion: Emotion; icon: any; label: string; color: string }[] = [
    { emotion: 'neutral', icon: MessageCircle, label: 'Нейтральная', color: 'text-gray-400' },
    { emotion: 'happy', icon: Smile, label: 'Радость', color: 'text-yellow-400' },
    { emotion: 'sad', icon: Frown, label: 'Грусть', color: 'text-blue-400' },
    { emotion: 'laughing', icon: Laugh, label: 'Смех', color: 'text-orange-400' },
    { emotion: 'crying', icon: Frown, label: 'Плач', color: 'text-indigo-400' },
    { emotion: 'surprised', icon: AlertCircle, label: 'Удивление', color: 'text-pink-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-pink-400" />
          <h2 className="text-2xl font-bold">Аватар & Голос</h2>
        </div>
        <div className="flex items-center gap-3">
          {activeProvider ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400">{activeProvider.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs text-red-400">Нет AI провайдера</span>
            </div>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400"
        >
          {error}
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Avatar Display */}
        <div className="lg:col-span-1">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-2xl p-8 flex flex-col items-center"
          >
            <Avatar size="xl" emotion={emotion} interactive={true} onEmotionChange={setEmotion} />

            <div className="mt-12 flex flex-wrap justify-center gap-2">
              {emotionButtons.map(btn => (
                <button
                  key={btn.emotion}
                  onClick={() => setEmotion(btn.emotion)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    emotion === btn.emotion
                      ? 'bg-white/10 border border-white/20'
                      : 'bg-white/5 border border-white/5 hover:bg-white/10'
                  } ${btn.color}`}
                >
                  <btn.icon className="w-3.5 h-3.5" />
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="mt-8 w-full">
              <VoiceControl onCommand={handleVoiceCommand} />
            </div>
          </motion.div>
        </div>

        {/* Chat Interface */}
        <div className="lg:col-span-2">
          <div className="glass-card rounded-2xl overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-indigo-500/30">
                  <img
                    src="https://image.qwenlm.ai/generated-images/07c5ccbd-c93d-47c6-b0b7-2452fcdb7f1d/_result.png"
                    alt="Svetlana"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Светлана</h3>
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {activeProvider ? `Online via ${activeProvider.name}` : 'Offline'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => isSpeaking ? stop() : speak('Привет! Я Светлана.')}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted"
              >
                {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-[400px] max-h-[500px]">
              <AnimatePresence>
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] ${
                      msg.role === 'user'
                        ? 'bg-indigo-600/30 text-indigo-100 rounded-2xl rounded-br-md'
                        : 'bg-white/5 text-sv-text rounded-2xl rounded-bl-md'
                    } px-4 py-2.5`}>
                      {msg.role === 'svetlana' && msg.emotion && (
                        <span className="text-xs text-sv-muted block mb-1">
                          {msg.emotion === 'happy' && '😊'}
                          {msg.emotion === 'sad' && '😢'}
                          {msg.emotion === 'laughing' && '😂'}
                          {msg.emotion === 'crying' && '😭'}
                          {msg.emotion === 'surprised' && '😮'}
                          {msg.emotion === 'neutral' && '😐'}
                          {msg.emotion === 'talking' && '💬'}
                        </span>
                      )}
                      <p className="text-sm">{msg.content}</p>
                      {msg.provider && (
                        <p className="text-xs text-sv-muted mt-1 opacity-50">{msg.provider}</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-sm text-sv-muted"
                >
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  Светлана думает...
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-white/10">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
                  placeholder={activeProvider ? 'Напишите Светлане...' : 'Сначала настройте AI провайдер'}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                  disabled={!activeProvider || isLoading}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || !activeProvider || isLoading}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {['Привет!', 'Расскажи шутку', 'Мне грустно', 'Кто ты?', 'Спасибо!'].map(phrase => (
                  <button
                    key={phrase}
                    onClick={() => sendMessage(phrase)}
                    disabled={!activeProvider || isLoading}
                    className="px-3 py-1 text-xs rounded-full bg-white/5 border border-white/10 text-sv-muted hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-sv-muted" />
            Настройки голоса
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <h4 className="text-sm font-medium text-cyan-400 mb-2">Speech-to-Text</h4>
              <p className="text-xs text-sv-muted mb-2">Web Speech API</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400">Available</span>
              </div>
              <p className="text-xs text-sv-muted mt-2">Язык: Русский (ru-RU)</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <h4 className="text-sm font-medium text-purple-400 mb-2">Text-to-Speech</h4>
              <p className="text-xs text-sv-muted mb-2">Web Speech Synthesis</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400">Available</span>
              </div>
              <p className="text-xs text-sv-muted mt-2">Голосов: {voices.length}</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <h4 className="text-sm font-medium text-yellow-400 mb-2">AI Provider</h4>
              <p className="text-xs text-sv-muted mb-2">Active: {activeProvider?.name || 'None'}</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${activeProvider ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className={`text-xs ${activeProvider ? 'text-emerald-400' : 'text-red-400'}`}>
                  {activeProvider ? 'Connected' : 'Not configured'}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Emotion System */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Heart className="w-5 h-5 text-pink-400" />
          Система эмоций
        </h3>
        <p className="text-sm text-sv-muted mb-4">
          Светлана реагирует на контекст через реальный LLM. Модель определяет эмоцию и аватар переключается.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { emotion: 'neutral', emoji: '😐', label: 'Нейтральная', desc: 'По умолчанию' },
            { emotion: 'happy', emoji: '😊', label: 'Радость', desc: 'Приветствие, успех' },
            { emotion: 'sad', emoji: '😢', label: 'Грусть', desc: 'Сочувствие' },
            { emotion: 'laughing', emoji: '😂', label: 'Смех', desc: 'Шутки, веселье' },
            { emotion: 'crying', emoji: '😭', label: 'Плач', desc: 'Сильные эмоции' },
            { emotion: 'surprised', emoji: '😮', label: 'Удивление', desc: 'Неожиданность' },
          ].map(item => (
            <div
              key={item.emotion}
              className={`p-3 rounded-lg border text-center cursor-pointer transition-all ${
                emotion === item.emotion
                  ? 'bg-indigo-500/10 border-indigo-500/30'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
              onClick={() => setEmotion(item.emotion as Emotion)}
            >
              <span className="text-2xl">{item.emoji}</span>
              <p className="text-xs font-medium mt-1">{item.label}</p>
              <p className="text-xs text-sv-muted">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
