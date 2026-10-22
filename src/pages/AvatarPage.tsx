// Чат со Светланой. Для экранного диктора переписка — журнал (role="log"): зачитываются только новые
// реплики, у каждой подпись «Вы» или «Светлана». С «Уменьшить движение» чат прокручивается без анимации.
// Кнопки «Сервисы» и «Настройки голоса» раскрывают панели: диктор слышит «развёрнуто / свёрнуто» (aria-expanded, aria-controls).
// Закрыли панель сервисов: фокус возвращается на кнопку «Сервисы». Чат крутится к новой реплике, только если человек
// и так внизу или сам написал (см. ChatScroll). Кнопки чата не ниже 44 px.
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Avatar, { VoiceControl, useSpeech } from '../components/Avatar';
import McpPanel from '../components/McpPanel';
import { aiGateway, type ChatMessage } from '../services/AIGateway';
import { explainAiError } from '../services/AiErrors';
import { crmSystemPrompt, detectCRMIntent, parseCRMActions, runCRMActions } from '../services/crm/CRMTools';
import { mcpSystemPrompt, parseMcpActions, runMcpLoop, MCP_REJECTED_TEXT } from '../services/mcp/McpManager';
import { toModelHistory } from '../services/security/History';
import { resetNativeConversation } from '../services/security/NativeBridge';
import type { ActionSource } from '../services/security/ActionGate';
import { nearBottom, shouldAutoScroll } from '../services/ChatScroll';
import { appPlatform } from '../platform';
import {
  Mic, Volume2, VolumeX, MessageCircle, Send, Paperclip, X,
  Sparkles, Heart, Smile, Frown, Laugh, AlertCircle,
  Settings, Wifi, WifiOff, Zap, Loader2, RotateCcw, Plug
} from 'lucide-react';

type Emotion = 'neutral' | 'happy' | 'sad' | 'laughing' | 'crying' | 'surprised' | 'talking';

interface Message {
  role: 'user' | 'svetlana';
  content: string;
  displayContent?: string;
  emotion?: Emotion;
  timestamp: number;
  provider?: string;
  /** В реплике есть результаты инструментов (CRM, внешние сервисы): модели она вернётся только как данные. */
  hasData?: boolean;
}

const greeting = (): Message => ({ role: 'svetlana', content: 'Привет! Я Светлана. Чем могу помочь?', emotion: 'happy', timestamp: Date.now() });

const AVATAR_SRC = `${import.meta.env.BASE_URL}images/avatar/svetlana-master.jpg`;

/** Быстрые команды чата — одни и те же на сайте, в Windows и в Android (в Android контакты берутся с этого телефона). */
export const QUICK_COMMANDS = ['Привет!', 'Занеси контакты с телефона в CRM', 'Сводка CRM', 'Расскажи шутку', 'Кто ты?'];

/** Что написать в настройках голоса на каждой платформе. */
export function voiceLabels(platform: 'windows' | 'android' | 'web', voices: number) {
  if (platform === 'android') {
    return { stt: 'Распознавание телефона, а с проверкой голоса — GigaAM на телефоне или облачное (кнопка «Голос» → настройки)', tts: 'Синтез речи телефона', ok: true, status: 'Телефон озвучивает ответы' };
  }
  const stt = platform === 'windows' ? 'Облачное распознавание (Groq или OpenAI, кнопка «Голос» → настройки)' : 'Распознавание браузера (Web Speech) или облачное';
  const tts = platform === 'windows' ? 'Голоса Windows' : 'Голоса браузера';
  return { stt, tts, ok: voices > 0, status: voices > 0 ? `Голосов: ${voices}` : 'Голоса не найдены' };
}

/** Подпись реплики для экранного диктора. */
export const speakerLabel = (role: Message['role']): string => (role === 'user' ? 'Вы:' : 'Светлана:');

/** Прокрутка без анимации, если в системе включено «Уменьшить движение». */
function scrollBehavior(): ScrollBehavior {
  try { return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; } catch { return 'auto'; }
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

/** onConnectAi — открыть мастер настройки ИИ (кнопка «Подключить ИИ», когда ИИ не выбран). */
export default function AvatarPage({ onConnectAi }: { onConnectAi?: () => void } = {}) {
  const platform = appPlatform();
  const android = platform === 'android';
  const quick = QUICK_COMMANDS;
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [messages, setMessages] = useState<Message[]>(() => [greeting()]);
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number; content: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showServices, setShowServices] = useState(false);
  // Микрофон включён: на аватаре пульсирует кольцо (озвучка показывается по isSpeaking).
  const [listening, setListening] = useState(false);
  const [activeProvider, setActiveProvider] = useState(aiGateway.getActiveProvider());
  const { speak, stop, isSpeaking, voices } = useSpeech();
  const logRef = useRef<HTMLDivElement>(null);
  /** Человек внизу переписки (не читает старое): новые реплики прокручивают чат. */
  const atBottomRef = useRef(true);
  const servicesBtnRef = useRef<HTMLButtonElement>(null);
  const usable = activeProvider ?? null;
  const labels = voiceLabels(platform, voices.length);

  // Каждый открытый чат — новый разговор для нативной части: разрешение на облако не переносится между чатами.
  useEffect(() => {
    resetNativeConversation();
  }, []);

  // Новая реплика: крутим вниз только того, кто и так внизу или сам написал. Крутится только окно чата, не вся страница.
  useEffect(() => {
    const box = logRef.current;
    if (!box || !shouldAutoScroll(atBottomRef.current, messages[messages.length - 1]?.role)) return;
    try { box.scrollTo({ top: box.scrollHeight, behavior: scrollBehavior() }); } catch { box.scrollTop = box.scrollHeight; }
    atBottomRef.current = true;
  }, [messages, isLoading]);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProvider(aiGateway.getActiveProvider());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const closeServices = () => {
    setShowServices(false);
    servicesBtnRef.current?.focus();
  };

  const newChat = () => {
    if (isLoading) return;
    resetNativeConversation();
    stop();
    atBottomRef.current = true;
    setMessages([greeting()]);
    setError(null);
    setEmotion('neutral');
  };

  /**
   * @param source 'voice' — команда пришла голосом: любое действие (даже чтение) — только после нажатия,
   *   а данные CRM/бизнеса (текущие и из прошлых реплик) не передаются модели (запись голоса можно воспроизвести).
   */
  const handleFileSelection = async (file?: File) => {
    if (!file) return;
    const allowed = /\\.(txt|md|csv|json|log|xml|yaml|yml|html?|js|ts|tsx|jsx|py|sql|toml|ini|css|sh)$/i.test(file.name);
    if (!allowed) {
      setError('Этот формат пока не поддерживается. Выбери текстовый файл: TXT, MD, CSV, JSON, PDF пока не поддерживается.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setError('Файл слишком большой. Максимальный размер — 1 МБ.');
      return;
    }
    try {
      const content = await file.text();
      if (!content.trim()) throw new Error('Файл пустой или не содержит читаемого текста.');
      setSelectedFile({ name: file.name, size: file.size, content: content.slice(0, 60000) });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось прочитать файл.');
    }
  };

  const sendMessage = async (text: string, source: ActionSource = 'unknown') => {
    const attachment = selectedFile;
    if ((!text.trim() && !attachment) || isLoading) return;
    const modelText = attachment
      ? [text.trim(), `Содержимое прикреплённого файла «${attachment.name}»:\\n${attachment.content}`].filter(Boolean).join('\\n\\n')
      : text.trim();

    const userMessage: Message = {
      role: 'user',
      content: modelText,
      displayContent: [text.trim(), attachment ? `📎 ${attachment.name} (${Math.max(1, Math.ceil(attachment.size / 1024))} КБ)` : ''].filter(Boolean).join('\\n'),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setSelectedFile(null);
    setIsLoading(true);
    setError(null);

    try {
      // Local CRM commands work without any AI provider (offline, on device).
      const crmIntent = attachment ? null : detectCRMIntent(text);
      if (crmIntent) {
        const lines = await runCRMActions([crmIntent], source);
        const reply = lines.join('\n');
        const ok = !reply.startsWith('⚠️');
        setMessages(prev => [...prev, {
          role: 'svetlana',
          content: reply,
          emotion: ok ? 'happy' : 'sad',
          timestamp: Date.now(),
          provider: 'CRM',
          hasData: true,
        }]);
        setEmotion(ok ? 'happy' : 'sad');
        speak(reply);
        setTimeout(() => setEmotion('neutral'), 6000);
        return;
      }

      const provider = aiGateway.getActiveProvider();
      if (!provider) {
        throw new Error('ИИ не выбран: нажми «Подключить ИИ» или «Настройка» вверху. CRM-команды («Сводка CRM», «Занеси контакты с телефона в CRM») работают и без него.');
      }

      // История для модели: результаты инструментов — только как данные, блоки действий обезврежены.
      // По голосу модель не получает данных CRM и бизнеса — ни текущих, ни из прошлых реплик.
      // Подключённые внешние сервисы (MCP) модель видит списком инструментов; каждый вызов подтверждает человек.
      const voice = source === 'voice';
      const history: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT + crmSystemPrompt(undefined, !voice) + mcpSystemPrompt() },
        ...toModelHistory(messages.slice(-10), { hideData: voice }),
        { role: 'user', content: modelText },
      ];

      const response = await aiGateway.chat(history, { temperature: 0.8, max_tokens: 1024 });

      let detectedEmotion = detectEmotion(response.content);
      const { clean, actions } = parseCRMActions(response.content);
      const mcp = parseMcpActions(clean);
      let cleanContent = cleanEmotionTag(mcp.clean);
      if (actions.length > 0) {
        const results = await runCRMActions(actions, source);
        cleanContent = [cleanContent, ...results].filter(Boolean).join('\n');
      }

      // Внешние сервисы: каждый вызов — после подтверждения; результаты модель получает только как данные.
      // Если модель просит следующий шаг (Timeweb Cloud: найти операцию → выполнить), человек снова подтверждает.
      const usedMcp = mcp.actions.length > 0 || mcp.rejected.length > 0;
      if (mcp.rejected.length > 0) {
        cleanContent = [cleanContent, ...mcp.rejected.map(() => `⚠️ ${MCP_REJECTED_TEXT}`)].filter(Boolean).join('\n');
      }
      if (mcp.actions.length > 0) {
        const loop = await runMcpLoop({
          reply: cleanContent,
          actions: mcp.actions,
          source,
          chat: async extra => (await aiGateway.chat([...history, ...extra], { temperature: 0.4, max_tokens: 1024 })).content,
        });
        cleanContent = [cleanContent, ...loop.notes].filter(Boolean).join('\n');
        const summary = cleanEmotionTag(loop.summary);
        if (summary) cleanContent = `${cleanContent}\n\n${summary}`;
        if (loop.lastReply) detectedEmotion = detectEmotion(loop.lastReply);
      }

      const assistantMessage: Message = {
        role: 'svetlana',
        content: cleanContent,
        emotion: detectedEmotion,
        timestamp: Date.now(),
        provider: `${response.provider} (${response.model})`,
        hasData: actions.length > 0 || usedMcp,
      };

      setMessages(prev => [...prev, assistantMessage]);
      setEmotion(detectedEmotion);

      speak(cleanContent);

      setTimeout(() => setEmotion('neutral'), 6000);
    } catch (err: any) {
      console.error('AI Error:', err);
      // Ошибки нативной части (Windows и Android) приходят строкой; технические тексты переводим на понятный русский.
      const raw = (typeof err?.message === 'string' && err.message) || (typeof err === 'string' ? err : '') || '';
      const text = explainAiError(raw);
      setError(text);
      setMessages(prev => [...prev, {
        role: 'svetlana',
        content: `⚠️ ${text}`,
        emotion: 'sad',
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceCommand = (command: string) => {
    sendMessage(command, 'voice');
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
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-pink-400" aria-hidden="true" />
          <h2 className="text-xl sm:text-2xl font-bold">Чат со Светланой</h2>
        </div>
        <div className="flex items-center gap-3">
          {usable ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/15">
              <Zap className="w-3.5 h-3.5 text-indigo-300" aria-hidden="true" />
              <span className="text-xs text-sv-text">{usable.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
              <WifiOff className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
              <span className="text-xs text-red-400">ИИ не выбран</span>
            </div>
          )}
          <button
            ref={servicesBtnRef}
            onClick={() => setShowServices(!showServices)}
            title="Сервисы (MCP): GitHub, Vercel, Timeweb Cloud, Yandex Cloud и другие"
            aria-label="Сервисы (MCP)"
            aria-expanded={showServices}
            aria-controls="chat-services-panel"
            className="flex items-center justify-center gap-1.5 p-2 min-h-11 min-w-11 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted text-xs"
          >
            <Plug className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs">MCP</span>
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            title="Настройки голоса"
            aria-label="Настройки голоса"
            aria-expanded={showSettings}
            aria-controls="chat-voice-settings"
            className="flex items-center justify-center p-2 min-h-11 min-w-11 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Без ИИ — не тупик: одна кнопка ведёт в мастер настройки. */}
      {!usable && onConnectAi && (
        <div data-testid="connect-ai" className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-sm flex flex-wrap items-center justify-between gap-2">
          <span className="text-indigo-100">
            Чтобы Светлана отвечала, подключите ИИ.{platform === 'web' ? '' : ' Бесплатно: GigaChat от Сбера.'} CRM-команды работают и без него.
          </span>
          <button
            onClick={onConnectAi}
            className="px-3 py-2 min-h-11 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
          >
            Подключить ИИ
          </button>
        </div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400"
        >
          {error}
        </motion.div>
      )}

      {showServices && <div id="chat-services-panel"><McpPanel onClose={closeServices} /></div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Chat Interface — на телефоне первым, чтобы сразу можно было писать */}
        <div className="lg:col-span-2 lg:order-2">
          <div className="glass-card rounded-2xl overflow-hidden h-full flex flex-col">
            <div className="p-3 sm:p-4 border-b border-white/10 bg-white/5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 shrink-0 rounded-full overflow-hidden border-2 border-indigo-500/30">
                  <img
                    src={AVATAR_SRC}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Светлана</h3>
                  <p className={`text-xs flex items-center gap-1 truncate ${usable ? 'text-sv-muted' : 'text-yellow-400'}`}>
                    {usable ? <Wifi className="w-3 h-3 shrink-0" aria-hidden="true" /> : <WifiOff className="w-3 h-3 shrink-0" aria-hidden="true" />}
                    {usable ? `Отвечает через: ${usable.name}` : 'ИИ не выбран (CRM доступна)'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={newChat}
                  disabled={isLoading}
                  title="Новый чат"
                  aria-label="Новый чат"
                  className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-11 min-w-11 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-sv-muted disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Новый чат</span>
                </button>
                <button
                  onClick={() => isSpeaking ? stop() : speak('Привет! Я Светлана.')}
                  title={isSpeaking ? 'Остановить голос' : 'Проверить голос'}
                  aria-label={isSpeaking ? 'Остановить голос' : 'Проверить голос'}
                  className="flex items-center justify-center p-2 min-h-11 min-w-11 rounded-lg bg-white/5 hover:bg-white/10 text-sv-muted"
                >
                  {isSpeaking ? <VolumeX className="w-4 h-4" aria-hidden="true" /> : <Volume2 className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div
              ref={logRef}
              onScroll={e => { const b = e.currentTarget; atBottomRef.current = nearBottom(b.scrollHeight, b.scrollTop, b.clientHeight); }}
              className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-3 min-h-[300px] sm:min-h-[400px] max-h-[60vh] sm:max-h-[500px]"
              role="log"
              aria-label="Переписка со Светланой"
              aria-live="polite"
              aria-relevant="additions"
              tabIndex={0}
            >
              <AnimatePresence>
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] sm:max-w-[80%] ${
                      msg.role === 'user'
                        ? 'bg-indigo-600/30 text-indigo-100 rounded-2xl rounded-br-md'
                        : 'bg-white/5 text-sv-text rounded-2xl rounded-bl-md'
                    } px-4 py-2.5`}>
                      {msg.role === 'svetlana' && msg.emotion && (
                        <span className="text-xs text-sv-muted block mb-1" aria-hidden="true">
                          {msg.emotion === 'happy' && '😊'}
                          {msg.emotion === 'sad' && '😢'}
                          {msg.emotion === 'laughing' && '😂'}
                          {msg.emotion === 'crying' && '😭'}
                          {msg.emotion === 'surprised' && '😮'}
                          {msg.emotion === 'neutral' && '😐'}
                          {msg.emotion === 'talking' && '💬'}
                        </span>
                      )}
                      <p className="text-sm whitespace-pre-line break-words"><span className="sr-only">{speakerLabel(msg.role)} </span>{msg.displayContent ?? msg.content}</p>
                      {msg.provider && (
                        <p className="text-xs text-sv-muted mt-1 opacity-50" aria-hidden="true">{msg.provider}</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  role="status"
                  className="flex items-center gap-2 text-sm text-sv-muted"
                >
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" aria-hidden="true" />
                  Светлана думает...
                </motion.div>
              )}
            </div>

            <div className="p-3 sm:p-4 border-t border-white/10">
              {selectedFile && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-sv-text">📎 {selectedFile.name} · {Math.max(1, Math.ceil(selectedFile.size / 1024))} КБ</span>
                  <button type="button" onClick={() => setSelectedFile(null)} aria-label="Убрать файл" title="Убрать файл" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/10" disabled={isLoading}><X className="h-4 w-4" /></button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  id="chat-file-picker"
                  type="file"
                  accept=".txt,.md,.csv,.json,.log,.xml,.yaml,.yml,.html,.htm,.js,.ts,.tsx,.jsx,.py,.sql,.toml,.ini,.css,.sh"
                  className="hidden"
                  disabled={isLoading}
                  onChange={e => { void handleFileSelection(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}
                />
                <button
                  type="button"
                  onClick={() => document.getElementById('chat-file-picker')?.click()}
                  disabled={isLoading}
                  title="Прикрепить текстовый файл"
                  aria-label="Прикрепить файл"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sv-muted hover:bg-white/10 disabled:opacity-50"
                ><Paperclip className="h-4 w-4" /></button>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
                  placeholder={usable ? 'Напишите Светлане...' : 'CRM-команды работают и без ИИ'}
                  aria-label="Сообщение Светлане"
                  className="flex-1 min-w-0 px-4 py-2.5 min-h-11 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                  disabled={isLoading}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={(!input.trim() && !selectedFile) || isLoading}
                  title="Отправить"
                  aria-label="Отправить"
                  className="flex items-center justify-center px-4 py-2.5 min-h-11 min-w-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Быстрые команды">
                {quick.map(phrase => (
                  <button
                    key={phrase}
                    onClick={() => sendMessage(phrase)}
                    disabled={isLoading}
                    className="px-3 py-2 min-h-11 text-xs rounded-full bg-white/5 border border-white/10 text-sv-muted hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Avatar Display: на телефоне компактно (меньше аватар, без кнопок эмоций), главное — микрофон */}
        <div className="lg:col-span-1 lg:order-1">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-2xl p-4 sm:p-8 flex flex-col items-center"
          >
            <Avatar size={android ? 'lg' : 'xl'} emotion={emotion} interactive={true} onEmotionChange={setEmotion} talking={isSpeaking} listening={listening} />

            <div className="mt-12 hidden sm:flex flex-wrap justify-center gap-2" role="group" aria-label="Эмоция аватара">
              {emotionButtons.map(btn => (
                <button
                  key={btn.emotion}
                  onClick={() => setEmotion(btn.emotion)}
                  aria-pressed={emotion === btn.emotion}
                  className={`flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-full text-xs font-medium transition-all ${
                    emotion === btn.emotion
                      ? 'bg-white/10 border border-white/20'
                      : 'bg-white/5 border border-white/5 hover:bg-white/10'
                  } ${btn.color}`}
                >
                  <btn.icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="mt-6 sm:mt-8 w-full">
              <VoiceControl onCommand={handleVoiceCommand} onListeningChange={setListening} />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <motion.div
          id="chat-voice-settings"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-5 sm:p-6"
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-sv-muted" aria-hidden="true" />
            Настройки голоса
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <h4 className="text-sm font-medium text-cyan-400 mb-2 flex items-center gap-1.5"><Mic className="w-4 h-4" aria-hidden="true" />Распознавание речи</h4>
              <p data-testid="stt-label" className="text-xs text-sv-muted mb-2">{labels.stt}</p>
              <p className="text-xs text-sv-muted mt-2">Язык: русский (ru-RU)</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <h4 className="text-sm font-medium text-purple-400 mb-2 flex items-center gap-1.5"><Volume2 className="w-4 h-4" aria-hidden="true" />Синтез речи</h4>
              <p data-testid="tts-label" className="text-xs text-sv-muted mb-2">{labels.tts}</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${labels.ok ? 'bg-emerald-400' : 'bg-yellow-400'}`} aria-hidden="true" />
                <span className={`text-xs ${labels.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>{labels.status}</span>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <h4 className="text-sm font-medium text-yellow-400 mb-2">ИИ</h4>
              <p className="text-xs text-sv-muted mb-2">Сейчас: {usable?.name || 'не выбран'}</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${usable ? 'bg-emerald-400' : 'bg-red-400'}`} aria-hidden="true" />
                <span className={`text-xs ${usable ? 'text-emerald-400' : 'text-red-400'}`}>
                  {usable ? 'Выбран' : 'Не настроен'}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Emotion System (только большой экран: на телефоне это лишняя прокрутка) */}
      <div className="hidden sm:block glass-card rounded-xl p-5 sm:p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Heart className="w-5 h-5 text-pink-400" aria-hidden="true" />
          Система эмоций
        </h3>
        <p className="text-sm text-sv-muted mb-4">
          Светлана реагирует на контекст: модель выбирает эмоцию, аватар переключается.
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
            <button
              type="button"
              key={item.emotion}
              aria-pressed={emotion === item.emotion}
              className={`p-3 rounded-lg border text-center cursor-pointer transition-all ${
                emotion === item.emotion
                  ? 'bg-indigo-500/10 border-indigo-500/30'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
              onClick={() => setEmotion(item.emotion as Emotion)}
            >
              <span className="text-2xl" aria-hidden="true">{item.emoji}</span>
              <p className="text-xs font-medium mt-1">{item.label}</p>
              <p className="text-xs text-sv-muted">{item.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
