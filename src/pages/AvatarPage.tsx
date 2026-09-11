import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Avatar, { VoiceControl, useSpeech } from '../components/Avatar';
import {
  Mic, MicOff, Volume2, VolumeX, MessageCircle, Send,
  Sparkles, Heart, Smile, Frown, Laugh, AlertCircle, X
} from 'lucide-react';

type Emotion = 'neutral' | 'happy' | 'sad' | 'laughing' | 'crying' | 'surprised' | 'talking';

interface Message {
  role: 'user' | 'svetlana';
  content: string;
  emotion?: Emotion;
}

export default function AvatarPage() {
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'svetlana', content: 'Привет! Я Светлана. Чем могу помочь?', emotion: 'happy' },
  ]);
  const [input, setInput] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { speak, stop, voices } = useSpeech();

  // Simulate Svetlana's responses with emotions
  const getResponse = (userMessage: string): { content: string; emotion: Emotion } => {
    const lower = userMessage.toLowerCase();

    if (lower.includes('привет') || lower.includes('здравствуй') || lower.includes('hello')) {
      return { content: 'Привет! Рада тебя видеть! Как дела?', emotion: 'happy' };
    }
    if (lower.includes('смешн') || lower.includes('шутк') || lower.includes('joke') || lower.includes('рассмеши')) {
      return { content: 'Хаха! Почему программисты путают Хэллоуин и Рождество? Потому что OCT 31 = DEC 25! 😂', emotion: 'laughing' };
    }
    if (lower.includes('грустн') || lower.includes('плохо') || lower.includes('sad') || lower.includes('печаль')) {
      return { content: 'Мне жаль это слышать. Всё будет хорошо, я рядом. Хочешь поговорить об этом?', emotion: 'sad' };
    }
    if (lower.includes('спасиб') || lower.includes('thank')) {
      return { content: 'Пожалуйста! Всегда рада помочь!', emotion: 'happy' };
    }
    if (lower.includes('кто ты') || lower.includes('what are you')) {
      return { content: 'Я Светлана 2.0 — AI-ассистент с эмоциями и голосом. Я могу понимать текст, голос, экраны и выполнять действия на твоих устройствах.', emotion: 'neutral' };
    }
    if (lower.includes('удив') || lower.includes('wow') || lower.includes('ого')) {
      return { content: 'Да! Я тоже удивлена! Мир полон неожиданностей!', emotion: 'surprised' };
    }
    if (lower.includes('плач') || lower.includes('cry')) {
      return { content: 'Иногда нужно просто позволить себе почувствовать. Это нормально...', emotion: 'crying' };
    }

    const responses = [
      { content: 'Интересно! Расскажи подробнее.', emotion: 'neutral' as Emotion },
      { content: 'Понимаю. Что ещё хочешь обсудить?', emotion: 'happy' as Emotion },
      { content: 'Хороший вопрос! Дай подумать...', emotion: 'neutral' as Emotion },
      { content: 'Я слушаю тебя внимательно.', emotion: 'happy' as Emotion },
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  };

  const handleSend = () => {
    if (!input.trim()) return;

    setMessages(prev => [...prev, { role: 'user', content: input }]);
    const response = getResponse(input);
    setInput('');

    // Show emotion change
    setTimeout(() => {
      setEmotion(response.emotion);
      setMessages(prev => [...prev, { role: 'svetlana', content: response.content, emotion: response.emotion }]);

      // Text-to-speech
      speak(response.content);

      // Reset to neutral after a while
      setTimeout(() => setEmotion('neutral'), 5000);
    }, 500);
  };

  const handleVoiceCommand = (command: string) => {
    setMessages(prev => [...prev, { role: 'user', content: `🎤 ${command}` }]);
    const response = getResponse(command);
    setTimeout(() => {
      setEmotion(response.emotion);
      setMessages(prev => [...prev, { role: 'svetlana', content: response.content, emotion: response.emotion }]);
      speak(response.content);
      setTimeout(() => setEmotion('neutral'), 5000);
    }, 500);
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
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-pink-400" />
        <h2 className="text-2xl font-bold">Аватар & Голос</h2>
      </div>
      <p className="text-sv-muted">Ультрареалистичный аватар с эмоциями, мимикой и голосовым управлением</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Avatar Display */}
        <div className="lg:col-span-1">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-2xl p-8 flex flex-col items-center"
          >
            <Avatar size="xl" emotion={emotion} interactive={true} onEmotionChange={setEmotion} />

            {/* Emotion Controls */}
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

            {/* Voice Control */}
            <div className="mt-8 w-full">
              <VoiceControl onCommand={handleVoiceCommand} />
            </div>
          </motion.div>
        </div>

        {/* Chat Interface */}
        <div className="lg:col-span-2">
          <div className="glass-card rounded-2xl overflow-hidden h-full flex flex-col">
            {/* Chat Header */}
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
                    Online
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => isSpeaking ? stop() : speak('Привет! Я Светлана.')}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted"
                >
                  {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Messages */}
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
                        </span>
                      )}
                      <p className="text-sm">{msg.content}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-white/10">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="Напишите Светлане..."
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              {/* Quick phrases */}
              <div className="flex flex-wrap gap-2 mt-3">
                {[
                  'Привет!',
                  'Расскажи шутку',
                  'Мне грустно',
                  'Кто ты?',
                  'Спасибо!',
                ].map(phrase => (
                  <button
                    key={phrase}
                    onClick={() => { setInput(phrase); }}
                    className="px-3 py-1 text-xs rounded-full bg-white/5 border border-white/10 text-sv-muted hover:bg-white/10 transition-colors"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Settings */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Mic className="w-5 h-5 text-indigo-400" />
          Голосовые настройки
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <h4 className="text-sm font-medium text-cyan-400 mb-2">Speech-to-Text (STT)</h4>
            <p className="text-xs text-sv-muted mb-2">Web Speech API</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400">Available</span>
            </div>
            <p className="text-xs text-sv-muted mt-2">Язык: Русский (ru-RU)</p>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <h4 className="text-sm font-medium text-purple-400 mb-2">Text-to-Speech (TTS)</h4>
            <p className="text-xs text-sv-muted mb-2">Web Speech Synthesis API</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400">Available</span>
            </div>
            <p className="text-xs text-sv-muted mt-2">Доступно голосов: {voices.length}</p>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <h4 className="text-sm font-medium text-yellow-400 mb-2">Voice Commands</h4>
            <p className="text-xs text-sv-muted mb-2">Natural language processing</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400">Active</span>
            </div>
            <p className="text-xs text-sv-muted mt-2">Поддержка команд на русском</p>
          </div>
        </div>
      </div>

      {/* Emotion System */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Heart className="w-5 h-5 text-pink-400" />
          Система эмоций
        </h3>
        <p className="text-sm text-sv-muted mb-4">
          Светлана реагирует на контекст разговора и меняет эмоции в реальном времени.
          Аватар переключается между 6 состояниями с плавными переходами.
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
