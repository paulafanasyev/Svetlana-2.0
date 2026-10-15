// «Скачать»: приложения Светланы для Android и Windows. Показывается только на сайте (в самом приложении не нужна).
// Ссылки постоянные: Windows — релиз app-v<версия сайта> (публикует build-windows.yml), Android — последний релиз Svetlana Home.
import { Download, Smartphone, Monitor, ShieldCheck } from 'lucide-react';
import { APP_VERSION } from '../version';

export const WINDOWS_SETUP_URL = `https://github.com/paulafanasyev/Svetlana-2.0/releases/download/app-v${APP_VERSION}/Svetlana-2.0-Windows-setup.exe`;
export const ANDROID_RELEASE_URL = 'https://github.com/paulafanasyev/Svetlana-Home/releases/latest';

const card = 'rounded-2xl bg-white/5 border border-white/10 p-6 flex flex-col gap-4';
const btn = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold';

export default function DownloadPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 text-white">
      <div>
        <h1 className="text-3xl font-bold">Скачать Светлану</h1>
        <p className="text-slate-300 mt-1">Приложения для телефона и компьютера. Бесплатно, без регистрации.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={card}>
          <h2 className="text-xl font-bold flex items-center gap-2"><Smartphone className="w-6 h-6 text-indigo-300" />Android</h2>
          <p className="text-sm text-slate-300">Svetlana Home: голос («Света…»), чат, ИИ на телефоне или в облаке и «руки»: сама открывает приложения, нажимает и печатает по вашей команде.</p>
          <a className={btn} href={ANDROID_RELEASE_URL} target="_blank" rel="noreferrer"><Download className="w-5 h-5" />Скачать APK</a>
          <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
            <li>Откройте ссылку на телефоне и нажмите файл .apk.</li>
            <li>Разрешите установку из этого источника, если телефон спросит.</li>
            <li>Запустите Svetlana Home и пройдите мастер «Настроить Светлану».</li>
          </ol>
          <p className="text-xs text-slate-500">Android 8.0 и новее, современные 64-битные телефоны (arm64).</p>
        </div>
        <div className={card}>
          <h2 className="text-xl font-bold flex items-center gap-2"><Monitor className="w-6 h-6 text-indigo-300" />Windows</h2>
          <p className="text-sm text-slate-300">Светлана 2.0 для Windows 10 и 11: чат со Светланой, выбор ИИ, CRM и бизнес, связь с телефоном. Ключи хранятся в защищённом хранилище Windows.</p>
          <a className={btn} href={WINDOWS_SETUP_URL}><Download className="w-5 h-5" />Скачать для Windows (версия {APP_VERSION})</a>
          <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
            <li>Запустите скачанный файл.</li>
            <li>Если Windows покажет «Защитила ваш компьютер»: «Подробнее» → «Выполнить в любом случае».</li>
            <li>При первом запуске вставьте ключ Светланы или выберите другой ИИ.</li>
          </ol>
        </div>
      </div>
      <p className="text-xs text-slate-500 flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Файлы скачиваются напрямую из официального репозитория проекта на GitHub.</p>
    </div>
  );
}
