// «Скачать»: приложения Светланы для Android и Windows. Показывается только на сайте (в самом приложении не нужна).
// Оба файла — из одного релиза app-v<версия сайта>: тот же интерфейс, что на сайте (публикуют build-windows.yml
// и svetlana-android.yml). Svetlana Home (лаунчер и мост телефон↔ПК) — отдельное приложение, ссылка ниже.
import { Download, Smartphone, Monitor, ShieldCheck } from 'lucide-react';
import { APP_VERSION } from '../version';

const RELEASE_TAG = `app-v${APP_VERSION}`;
const RELEASE = `https://github.com/paulafanasyev/Svetlana-2.0/releases/download/${RELEASE_TAG}`;
export const RELEASE_PAGE_URL = `https://github.com/paulafanasyev/Svetlana-2.0/releases/tag/${RELEASE_TAG}`;
export const WINDOWS_SETUP_URL = `${RELEASE}/Svetlana-2.0-Windows-setup.exe`;
export const ANDROID_APK_URL = `${RELEASE}/Svetlana-2.0-Android.apk`;
export const ANDROID_CHECKSUMS_URL = `${RELEASE}/android-checksums.txt`;
export const CHECKSUMS_URL = `${RELEASE}/checksums.txt`;
/** Отдельное приложение-лаунчер и мост телефон↔ПК (вкладка «Телефон» в Windows). */
export const ANDROID_RELEASE_URL = 'https://github.com/paulafanasyev/Svetlana-Home/releases/latest';

const card = 'rounded-2xl bg-white/5 border border-white/10 p-6 flex flex-col gap-4';
const btn = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold';

export default function DownloadPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 text-white">
      <div>
        <h1 className="text-3xl font-bold">Скачать Светлану</h1>
        <p className="text-slate-300 mt-1">Приложения для телефона и компьютера: тот же чат, ИИ и CRM, что на этом сайте. Бесплатно, без регистрации.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={card}>
          <h2 className="text-xl font-bold flex items-center gap-2"><Smartphone className="w-6 h-6 text-indigo-300" />Android</h2>
          <p className="text-sm text-slate-300">Светлана 2.0 для Android: тот же чат, выбор ИИ, CRM и бизнес, плюс голос телефона и «руки»: сама открывает приложения, нажимает и печатает по вашей команде (каждый раз спрашивает «ОК»). Ключи в защищённом хранилище телефона.</p>
          <a className={btn} href={ANDROID_APK_URL}><Download className="w-5 h-5" />Скачать APK (версия {APP_VERSION})</a>
          <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
            <li>Откройте ссылку на телефоне и нажмите скачанный файл .apk.</li>
            <li>Разрешите установку из этого источника, если телефон спросит.</li>
            <li>При первом запуске вставьте ключ Светланы или выберите облачный ИИ.</li>
          </ol>
          <p className="text-xs text-slate-500">Android 8.0 и новее. Нужен Android System WebView (или Chrome) из Google Play.</p>
          <p className="text-xs text-slate-500">Отдельно: <a className="underline" href={ANDROID_RELEASE_URL} target="_blank" rel="noreferrer">Svetlana Home</a> — лаунчер и связь телефона с компьютером.</p>
        </div>
        <div className={card}>
          <h2 className="text-xl font-bold flex items-center gap-2"><Monitor className="w-6 h-6 text-indigo-300" />Windows</h2>
          <p className="text-sm text-slate-300">Светлана 2.0 для Windows 10 и 11: тот же чат, выбор ИИ, CRM и бизнес, локальные модели и связь с телефоном. Ключи хранятся в защищённом хранилище Windows.</p>
          <a className={btn} href={WINDOWS_SETUP_URL}><Download className="w-5 h-5" />Скачать для Windows (версия {APP_VERSION})</a>
          <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
            <li>Запустите скачанный файл.</li>
            <li>Если Windows покажет «Защитила ваш компьютер»: «Подробнее» → «Выполнить в любом случае».</li>
            <li>При первом запуске вставьте ключ Светланы или выберите другой ИИ.</li>
          </ol>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2 text-sm text-slate-300">
        <p className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 shrink-0" />Файлы скачиваются напрямую из официального GitHub-релиза <strong className="text-white">app-v{APP_VERSION}</strong>.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <a className="underline underline-offset-4" href={RELEASE_PAGE_URL} target="_blank" rel="noreferrer">Открыть релиз на GitHub</a>
          <a className="underline underline-offset-4" href={ANDROID_CHECKSUMS_URL} target="_blank" rel="noreferrer">SHA-256 Android</a>
          <a className="underline underline-offset-4" href={CHECKSUMS_URL} target="_blank" rel="noreferrer">SHA-256 всех файлов</a>
        </div>
        <p className="text-xs text-slate-400">Windows-установщик сейчас не имеет цифровой подписи; Windows SmartScreen может показать предупреждение. Перед запуском можно сверить SHA-256 с файлом checksums.txt.</p>
      </div>
    </div>
  );
}
