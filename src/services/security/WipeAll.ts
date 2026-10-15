// «Удалить все данные на этом устройстве»: CRM, бизнес, запись, память, голос владельца,
// настройки ИИ, привязки (кабинет и телефон) и все секреты вместе с ключом шифрования.
// В приложениях также стираются ключи облачных ИИ из хранилища системы:
// Android — одним подтверждением всё хранилище и сам ключ Android Keystore;
// Windows — каждый сохранённый ключ в Диспетчере учётных данных (Windows спросит подтверждение на каждый).
import { clearAllSecrets } from './SecretStore';
import { isNativeApp, nativeHasSecret, nativeSetSecret } from './NativeBridge';
import { isAndroidApp } from '../../platform';
import { androidWipeSecrets } from '../AndroidFiles';

interface Store { length: number; key(i: number): string | null; removeItem(k: string): void }
function ls(): Store | null { try { return typeof localStorage !== 'undefined' ? (localStorage as Store) : null; } catch { return null; } }

/** Облачные ИИ, чьи ключи держит нативная часть (как PROVIDERS в secure_ai.rs и SecureAi.kt). */
export const NATIVE_KEY_PROVIDERS = ['openai', 'groq', 'openrouter', 'deepseek', 'mistral', 'anthropic', 'google', 'svetlana'] as const;

/** Удалить ключи ИИ из хранилища приложения. Возвращает число удалённых записей. */
export async function wipeNativeKeys(): Promise<number> {
  if (!isNativeApp()) return 0;
  if (isAndroidApp()) {
    try { return await androidWipeSecrets(); } catch { return 0; }
  }
  let n = 0;
  for (const id of NATIVE_KEY_PROVIDERS) {
    const name = `ai.${id}`;
    try {
      if (await nativeHasSecret(name)) { await nativeSetSecret(name, null); n++; }
    } catch { /* «Отмена» или нет хранилища — идём дальше */ }
  }
  return n;
}

/** Все ключи приложения начинаются с «svetlana». Возвращает число удалённых записей. */
export async function wipeAllLocalData(s: Store | null = ls()): Promise<number> {
  let n = await wipeNativeKeys();
  if (s) {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k && k.toLowerCase().startsWith('svetlana')) { s.removeItem(k); n++; }
    }
  }
  try { (globalThis as any).sessionStorage?.clear?.(); } catch { /* noop */ }
  await clearAllSecrets(s as any);
  return n;
}
