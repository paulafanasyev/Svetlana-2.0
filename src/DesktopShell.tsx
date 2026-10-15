// Главное окно Светланы: сразу чат, потом настройки ИИ и телефон. Схемы, планы, оркестратор задач и демо
// разработки (старый Command Center, App.tsx) убраны в вкладку «Для разработчика» и помечены: это описание,
// а не работающая функция. При первом запуске открывается мастер настройки (FirstRunSetup): без него чат
// не знает, куда слать вопрос.
import { useEffect, useState } from 'react';
import { MessageCircle, Cpu, Smartphone, Wrench, Settings2, AlertTriangle, Mic } from 'lucide-react';
import App from './App';
import AvatarPage from './pages/AvatarPage';
import AIProvidersPage from './pages/AIProvidersPage';
import AndroidConnectionPage from './pages/AndroidConnectionPage';
import FirstRunSetup, { isSetupDone } from './components/FirstRunSetup';
import { aiGateway } from './services/AIGateway';
import { APP_VERSION } from './version';

type Tab = 'chat' | 'providers' | 'phone' | 'dev';

// Только то, что реально работает. Оркестратор задач пока демо, он во вкладке «Для разработчика».
export const TABS: { id: Tab; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chat', label: 'Чат со Светланой', icon: MessageCircle },
  { id: 'providers', label: 'Модели ИИ', icon: Cpu },
  { id: 'phone', label: 'Телефон', icon: Smartphone },
  { id: 'dev', label: 'Для разработчика', icon: Wrench },
];

const AVATAR = `${import.meta.env.BASE_URL}images/avatar/svetlana-master.jpg`;

export default function DesktopShell() {
  const [tab, setTab] = useState<Tab>('chat');
  const [setupOpen, setSetupOpen] = useState(() => !isSetupDone());
  const [active, setActive] = useState(() => aiGateway.getActiveProvider());

  useEffect(() => {
    const t = setInterval(() => setActive(aiGateway.getActiveProvider()), 1500);
    return () => clearInterval(t);
  }, []);

  const bar = (
    <header className="sticky top-0 z-40 bg-sv-darker/95 backdrop-blur-xl border-b border-sv-border px-4 py-2 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 mr-3">
        <img src={AVATAR} alt="" className="w-8 h-8 rounded-full object-cover border border-indigo-500/40" />
        <div>
          <p className="text-sm font-bold leading-tight">Светлана 2.0</p>
          <p className="text-[11px] text-sv-muted leading-tight">версия {APP_VERSION}</p>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              tab === t.id ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' : 'text-sv-muted hover:bg-white/5 hover:text-sv-text border border-transparent'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <span
          title={active ? 'Выбранный ИИ. Работает ли он, проверяет «Настройка»' : undefined}
          className={`text-xs px-3 py-1.5 rounded-full border ${active ? 'bg-white/5 border-white/15 text-sv-text' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}
        >
          {active ? `ИИ: ${active.name}` : 'ИИ не выбран'}
        </span>
        <button
          onClick={() => setSetupOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
        >
          <Settings2 className="w-4 h-4" /> Настройка
        </button>
      </div>
    </header>
  );

  const setup = setupOpen && (
    <FirstRunSetup
      onClose={() => setSetupOpen(false)}
      onReady={() => { setSetupOpen(false); setTab('chat'); setActive(aiGateway.getActiveProvider()); }}
      onOpenProviders={() => { setSetupOpen(false); setTab('providers'); }}
    />
  );

  if (tab === 'dev') {
    return (
      <div className="min-h-screen">
        {bar}
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 text-xs text-yellow-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Здесь схемы, план и демо разработки (в том числе оркестратор задач). Статусы и «демо-задачи» на этих страницах описывают замысел и не проверяют твой ПК. Работающий чат на вкладке «Чат со Светланой».
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
      <main className="p-6 pb-28 max-w-7xl mx-auto">
        {tab === 'chat' && (
          <>
            {/* Честно про голос: встроенное распознавание браузера в WebView2 недоступно, локальная GigaAM проверяет только цифры. */}
            <div data-testid="voice-note" className="mb-4 px-4 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-2">
              <Mic className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Писать можно сразу. Для голосовых команд в Windows нужен ключ Groq или OpenAI в настройках голоса: встроенное распознавание браузера здесь не работает, а локальная модель речи пока только проверяет голос цифрами.
              </span>
            </div>
            <AvatarPage />
          </>
        )}
        {tab === 'providers' && <AIProvidersPage />}
        {tab === 'phone' && <AndroidConnectionPage />}
      </main>
      {setup}
    </div>
  );
}
