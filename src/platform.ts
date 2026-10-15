// Где запущена Светлана. Один и тот же интерфейс (src/) работает на сайте, в приложении для Windows (Tauri)
// и в приложении для Android (android-hands: WebView + нативный мост с теми же командами, что secure_ai.rs).
// Android-приложение до загрузки страницы ставит __SVETLANA_PLATFORM__ = 'android' и __TAURI_INTERNALS__.invoke.

export type AppPlatform = 'windows' | 'android' | 'web';

export function appPlatform(): AppPlatform {
  const g = globalThis as any;
  if (g.__SVETLANA_PLATFORM__ === 'android' && typeof g.__TAURI_INTERNALS__?.invoke === 'function') return 'android';
  if (typeof g.__TAURI_INTERNALS__?.invoke === 'function') return 'windows';
  return 'web';
}

export const isAndroidApp = (): boolean => appPlatform() === 'android';
export const isWindowsApp = (): boolean => appPlatform() === 'windows';

/** Где лежат ключи в этом приложении (для подсказок). */
export function secureStoreName(): string {
  return isAndroidApp() ? 'защищённом хранилище телефона (Android Keystore)' : 'Диспетчере учётных данных Windows';
}
