// Хранилище секретов (API-ключи ИИ и распознавания речи): шифрование AES-GCM 256.
// Ключ шифрования создаётся неизвлекаемым (extractable: false) и лежит в IndexedDB: его нельзя прочитать
// или выгрузить даже кодом приложения — только использовать для расшифровки на этом устройстве.
// В localStorage остаётся лишь шифротекст: копия профиля браузера, резервная копия или другая программа,
// читающая файлы хранилища, ключей не получат. Если IndexedDB/WebCrypto недоступны, ключ хранится только
// в памяти до закрытия приложения (в открытом виде на диск не пишется никогда).
// «Удалить все данные» побеждает начатую запись: секрет, чей setSecret начался до удаления, на диск уже не попадёт (epoch).

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }
function storage(): KV | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

const PREFIX = 'svetlana_secret_v1:';
const NAME_RE = /^[a-z0-9_.-]{1,64}$/;
const memory = new Map<string, string>();
/** Номер «эпохи»: растёт при каждом полном удалении. Запись из прошлой эпохи отбрасывается. */
let epoch = 0;

type KeyProvider = () => Promise<CryptoKey | null>;

function idbKey(): Promise<CryptoKey | null> {
  const subtle = globalThis.crypto?.subtle;
  const idb = (globalThis as any).indexedDB as IDBFactory | undefined;
  if (!subtle || !idb) return Promise.resolve(null);
  return new Promise(resolve => {
    const req = idb.open('svetlana_secrets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      // Соединение закрывается сразу после чтения/записи: открытое соединение заблокировало бы
      // удаление базы кнопкой «Удалить все данные». Сам CryptoKey после закрытия остаётся рабочим.
      const done = (k: CryptoKey | null) => { try { db.close(); } catch { /* noop */ } resolve(k); };
      const get = db.transaction('keys', 'readonly').objectStore('keys').get('master');
      get.onerror = () => done(null);
      get.onsuccess = async () => {
        if (get.result) { done(get.result as CryptoKey); return; }
        try {
          const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          const put = db.transaction('keys', 'readwrite').objectStore('keys').put(key, 'master');
          put.onsuccess = () => done(key);
          put.onerror = () => done(null);
        } catch { done(null); }
      };
    };
  });
}

let keyProvider: KeyProvider = idbKey;
let keyPromise: Promise<CryptoKey | null> | null = null;
const masterKey = () => (keyPromise ??= keyProvider().catch(() => null));

/** Для тестов: подменить источник ключа. */
export function __setKeyProviderForTests(p: KeyProvider | null): void { keyProvider = p ?? idbKey; keyPromise = null; memory.clear(); }

const b64 = (u: Uint8Array) => { let s = ''; u.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function checkName(name: string): void { if (!NAME_RE.test(name)) throw new Error(`Недопустимое имя секрета: ${name}`); }

/** Сохранить секрет. Пустое значение удаляет. Возвращает, где он хранится. */
export async function setSecret(name: string, value: string | null | undefined, kv: KV | null = storage()): Promise<'encrypted' | 'memory' | 'deleted'> {
  checkName(name);
  const myEpoch = epoch;
  if (!value) { memory.delete(name); kv?.removeItem?.(PREFIX + name); return 'deleted'; }
  const key = await masterKey();
  // Пока ждали ключ, всё удалили: этот секрет сохранять нельзя.
  if (myEpoch !== epoch) return 'deleted';
  if (!key || !kv) { memory.set(name, value); kv?.removeItem?.(PREFIX + name); return 'memory'; }
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(name) }, key, new TextEncoder().encode(value)));
  if (myEpoch !== epoch) return 'deleted';
  kv.setItem(PREFIX + name, JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }));
  memory.delete(name);
  return 'encrypted';
}

/** Прочитать секрет. null — нет, повреждён или подменён (проверка целостности AES-GCM). */
export async function getSecret(name: string, kv: KV | null = storage()): Promise<string | null> {
  checkName(name);
  if (memory.has(name)) return memory.get(name)!;
  const raw = kv?.getItem(PREFIX + name);
  if (!raw || raw.length > 20_000) return null;
  try {
    const o = JSON.parse(raw) as { v?: unknown; iv?: unknown; ct?: unknown };
    if (o.v !== 1 || typeof o.iv !== 'string' || typeof o.ct !== 'string') return null;
    const key = await masterKey();
    if (!key) return null;
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: new TextEncoder().encode(name) }, key, unb64(o.ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

export async function deleteSecret(name: string, kv: KV | null = storage()): Promise<void> { await setSecret(name, null, kv); }

/**
 * Где реально лежат секреты на этом устройстве. «Зашифрованы» — только если есть и ключ шифрования,
 * и постоянное хранилище (иначе секреты живут только в памяти до закрытия приложения).
 */
export async function secretStorageMode(): Promise<'encrypted' | 'memory'> {
  return (await masterKey()) && storage() ? 'encrypted' : 'memory';
}

/**
 * Удалить все секреты (кнопка «Удалить все данные»): шифротексты из localStorage, копии в памяти
 * и сам ключ шифрования в IndexedDB. Даже если удаление базы задержится (другое окно приложения),
 * шифротекстов уже нет. Возвращает true, если база с ключом точно удалена.
 */
export function clearAllSecrets(kv: KV | null = storage()): Promise<boolean> {
  epoch++;
  memory.clear();
  keyPromise = null;
  if (kv && 'length' in (kv as any)) {
    const s = kv as unknown as Storage;
    for (let i = s.length - 1; i >= 0; i--) { const k = s.key(i); if (k?.startsWith(PREFIX)) s.removeItem(k); }
  }
  const idb = (globalThis as any).indexedDB as IDBFactory | undefined;
  if (!idb || keyProvider !== idbKey) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const req = idb.deleteDatabase('svetlana_secrets');
      req.onsuccess = () => finish(true);
      req.onerror = () => finish(false);
      // Заблокировано другим соединением: браузер удалит базу, как только оно закроется.
      // Ждём до 3 секунд и честно сообщаем, если не успело.
      (req as any).onblocked = () => { setTimeout(() => finish(false), 3000); };
    } catch { finish(false); }
  });
}
