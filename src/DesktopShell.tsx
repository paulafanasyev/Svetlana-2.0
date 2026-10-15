// Главное окно Светланы: сразу чат, потом настройки ИИ и телефон. Один и тот же интерфейс на сайте,
// в приложении для Windows и в приложении для Android. Разница только в том, что есть у платформы:
// на сайте вкладка «Скачать», в Android вкладка «Руки» (действия на телефоне) вместо «Телефон» (подключение к ПК)
// и без вкладки «Для разработчика» (схемы и демо для большого экрана).
// Схемы, планы, оркестратор задач и демо разработки (старый Command Center, App.tsx) убраны во вкладку
// «Для разработчика» и помечены: это описание, а не работающая функция. При первом запуске открывается
// мастер настройки (FirstRunSetup): без него чат не знает, куда слать вопрос.
import { useEffect, useState } from 'react';
import { MessageCircle, Cpu, Smartphone, Wrench, Settings2, AlertTriangle, Mic, Download, Hand } from 'lucide-react';
import App from './App';
import AvatarPage from './pages/AvatarPage';
import AIProvidersPage from './pages/AIProvidersPage';
import AndroidConnectionPage from './pages/AndroidConnectionPage';
import AndroidHandsPage from './pages/AndroidHandsPage';
import DownloadPage from './pages/DownloadPage';
import FirstRunSetup, { isSetupDone } from './components/FirstRunSetup';
import { aiGateway, type AIProvider } from './services/AIGateway';
import { isNativeApp } from './services/security/NativeBridge';
import { isAndroidApp } from './platform';
import { APP_VERSION } from './version';

type Tab = 'chat' | 'providers' | 'phone' | 'hands' | 'download' | 'dev';

// Только то, что реально работает. Оркестратор задач пока демо, он во вкладке «Для разработчика».
// short — надпись на узком экране (телефон).
const TABS: { id: Tab; label: string; short: string; icon: typeof MessageCircle; webOnly?: boolean; androidOnly?: boolean; notOnAndroid?: boolean }[] = [
  { id: 'chat', label: 'Чат со Светланой', short: 'Чат', icon: MessageCircle },
  { id: 'providers', label: 'Модели ИИ', short: 'ИИ', icon: Cpu },
  { id: 'hands', label: 'Руки', short: 'Руки', icon: Hand, androidOnly: true },
  { id: 'phone', label: 'Телефон', short: 'Телефон', icon: Smartphone, notOnAndroid: true },
  { id: 'download', label: 'Скачать приложения', short: 'Скачать', icon: Download, webOnly: true },
  { id: 'dev', label: 'Для разработчика', short: 'Разработка', icon: Wrench, notOnAndroid: true },
];

const AVATAR = `${import.meta.env.BASE_URL}images/avatar/svetlana-master.jpg`;

// Какой ИИ последним УСПЕШНО прошёл проверку в мастере. Пропуск мастера или «Другие ИИ» сюда не пишут.
const VERIFIED_KEY = 'svetlana_ai_verified_v1';
const readVerified = (): string | null => {
  try { return localStorage.getItem(VERIFIED_KEY); } catch { return null; }
};

/** На телефоне локальные модели компьютера (Ollama и др., 127.0.0.1) недоступны: такой ИИ считаем невыбранным. */
export function usableProvider(p: AIProvider | null | undefined, android: boolean): AIProvider | null {
  if (!p) return null;
  return android && p.type === 'offline' ? null : p;
}

/**
 * Телефон: если активна локальная модель компьютера, а «★ Светлана Сервер» включена и с ключом, переключаемся на неё.
 * Проверяется на каждом тике: ключ могли добавить уже после запуска.
 */
export function switchOffOffline(android: boolean): boolean {
  if (!android || aiGateway.getActiveProvider()?.type !== 'offline') return false;
  const sv = aiGateway.getProvider('svetlana');
  if (!sv || !sv.enabled || !sv.apiKey) return false;
  aiGateway.setActiveProvider('svetlana');
  return true;
}

export default function DesktopShell() {
  const native = isNativeApp();
  const android = isAndroidApp();
  const tabs = TABS.filter(t => (!t.webOnly || !native) && (!t.androidOnly || android) && (!t.notOnAndroid || !android));
  const [tab, setTab] = useState<Tab>('chat');
  const [setupOpen, setSetupOpen] = useState(() => !isSetupDone());
  const [active, setActive] = useState(() => usableProvider(aiGateway.getActiveProvider(), android));
  // ИИ «выбран» ещё не значит «работает»: по умолчанию выбрана Ollama, даже если её нет.
  const [verifiedId, setVerifiedId] = useState<string | null>(readVerified);

  useEffect(() => {
    const tick = () => {
      switchOffOffline(android);
      setActive(usableProvider(aiGateway.getActiveProvider(), android));
      setVerifiedId(readVerified());
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, [android]);

  const verified = !!active && verifiedId === active.id;
  const pill = !active
    ? { text: 'ИИ не выбран', cls: 'bg-red-500/10 border-red-500/30 text-red-300', title: 'Нажмите «Настройка»' }
    : verified
      ? { text: `ИИ: ${active.name}`, cls: 'bg-white/5 border-white/15 text-sv-text', title: 'Этот ИИ ответил при проверке. Перепроверить можно в «Настройке»' }
      : { text: 'ИИ не проверен', cls: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300', title: `Выбран: ${active.name}. Проверьте связь в «Настройке»` };

  const bar = (
    <header className="sticky top-0 z-40 bg-sv-darker/95 backdrop-blur-xl border-b border-sv-border px-3 sm:px-4 py-2 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 mr-1 sm:mr-3">
        <img src={AVATAR} alt="" className="w-8 h-8 rounded-full object-cover border border-indigo-500/40" />
        <div>
          <p className="text-sm font-bold leading-tight">Светлана 2.0</p>
          <p className="text-[11px] text-sv-muted leading-tight">версия {APP_VERSION}</p>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2 sm:order-last">
        <button
          data-testid="ai-pill"
          onClick={() => setSetupOpen(true)}
          title={pill.title}
          className={`text-xs px-3 py-1.5 rounded-full border max-w-[9rem] sm:max-w-none truncate ${pill.cls}`}
        >
          {pill.text}
        </button>
        <button
          onClick={() => setSetupOpen(true)}
          aria-label="Настройка"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
        >
          <Settings2 className="w-4 h-4" /><span className="hidden sm:inline">Настройка</span>
        </button>
      </div>
      {/* На телефоне вкладки — одной строкой с прокруткой и короткими надписями. */}
      <nav className="w-full sm:w-auto flex gap-1 overflow-x-auto sm:flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              tab === t.id ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' : 'text-sv-muted hover:bg-white/5 hover:text-sv-text border border-transparent'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );

  const setup = setupOpen && (
    <FirstRunSetup
      onClose={() => setSetupOpen(false)}
      onReady={() => {
        // onReady вызывается только после успешной проверки связи в мастере.
        const ok = usableProvider(aiGateway.getActiveProvider(), android);
        try { if (ok) localStorage.setItem(VERIFIED_KEY, ok.id); } catch { /* noop */ }
        setSetupOpen(false); setTab('chat'); setActive(ok); setVerifiedId(ok?.id ?? null);
      }}
      onOpenProviders={() => { setSetupOpen(false); setTab('providers'); }}
    />
  );

  if (tab === 'dev') {
    return (
      <div className="min-h-screen">
        {bar}
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 text-xs text-yellow-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Здесь схемы, план и демо разработки (в том числе оркестратор задач). Статусы и «демо-задачи» на этих страницах описывают замысел и не проверяют ваше устройство. Работающий чат на вкладке «Чат со Светланой».
        </div>
        {/* Отступ снизу: там плавающие кнопки CRM / Бизнес / Голос (CRMLauncher). */}
        <div className="pb-28">
          <App />
        </div>
        {setup}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {bar}
      {/* Отступ снизу: там плавающие кнопки CRM / Бизнес / Голос (CRMLauncher). */}
      <main className="p-3 sm:p-6 pb-28 max-w-7xl mx-auto">
        {tab === 'chat' && (
          <>
            {/* Честно про голос в Windows: встроенное распознавание браузера в WebView2 недоступно, локальная GigaAM проверяет только цифры.
                В Android слушает распознавание самого телефона, ключ не нужен, поэтому там подсказки нет. */}
            {native && !android && (
              <div data-testid="voice-note" className="mb-4 px-4 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-2">
                <Mic className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Писать можно сразу. Для голосовых команд в Windows нужен ключ Groq или OpenAI: нажмите кнопку «Голос» внизу слева и вставьте ключ там. Встроенное распознавание браузера в Windows-приложении не работает, а локальная модель речи пока только проверяет голос цифрами.
                </span>
              </div>
            )}
            <AvatarPage />
          </>
        )}
        {tab === 'providers' && <AIProvidersPage />}
        {tab === 'phone' && <AndroidConnectionPage />}
        {tab === 'hands' && <AndroidHandsPage />}
        {tab === 'download' && <DownloadPage />}
      </main>
      {setup}
    </div>
  );
}
