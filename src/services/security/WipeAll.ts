// «Удалить все данные на этом устройстве»: CRM, бизнес, запись, память, голос владельца,
// настройки ИИ, привязки (кабинет и телефон) и все секреты вместе с ключом шифрования.
import { clearAllSecrets } from './SecretStore';

interface Store { length: number; key(i: number): string | null; removeItem(k: string): void }
function ls(): Store | null { try { return typeof localStorage !== 'undefined' ? (localStorage as Store) : null; } catch { return null; } }

/** Все ключи приложения начинаются с «svetlana». Возвращает число удалённых записей. */
export async function wipeAllLocalData(s: Store | null = ls()): Promise<number> {
  let n = 0;
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
