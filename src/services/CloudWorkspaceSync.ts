import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { personalWorkspace, type WorkspaceSyncSnapshot } from './PersonalWorkspaceStore';

const OWNER_KEY = 'svetlana_workspace_sync_owner_v1';
const MAX_PAYLOAD_CHARS = 3_500_000;
let client: SupabaseClient | null = null;
let clientChecked = false;

export function cloudSyncConfigured(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const key = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  if (!url || !key) return false;
  try {
    const parsed = new URL(url);
    const validHost = parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co');
    const localDev = (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && parsed.protocol === 'http:';
    return (validHost || localDev) && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function getCloudClient(): SupabaseClient | null {
  if (clientChecked) return client;
  clientChecked = true;
  if (!cloudSyncConfigured()) return null;
  const env = import.meta.env as Record<string, unknown>;
  const url = String(env.VITE_SUPABASE_URL).trim().replace(/\/$/, '');
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY).trim();
  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { headers: { 'x-client-info': 'svetlana-personal-workspace' } },
  });
  return client;
}

export async function getCloudUser(): Promise<User | null> {
  const supabase = getCloudClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    // An expired session should be treated as signed out; do not surface provider internals.
    return null;
  }
  return data.user ?? null;
}

export async function signInCloud(email: string, password: string): Promise<User> {
  const supabase = getCloudClient();
  if (!supabase) throw new Error('Облачная синхронизация не настроена: задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.');
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) throw new Error('Не удалось войти. Проверьте почту и пароль.');
  return data.user;
}

export async function signUpCloud(email: string, password: string): Promise<{ user: User | null; needsEmailConfirmation: boolean }> {
  const supabase = getCloudClient();
  if (!supabase) throw new Error('Облачная синхронизация не настроена: задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.');
  if (password.length < 10) throw new Error('Пароль должен содержать не менее 10 символов.');
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error('Не удалось создать аккаунт. Проверьте настройки регистрации и повторите попытку.');
  return { user: data.user ?? null, needsEmailConfirmation: !data.session };
}

export async function signOutCloud(): Promise<void> {
  const supabase = getCloudClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error('Не удалось завершить сеанс облачной синхронизации.');
}

export function boundWorkspaceOwnerId(): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(OWNER_KEY) : null; } catch { return null; }
}

function bindWorkspaceOwner(userId: string): void {
  const previous = boundWorkspaceOwnerId();
  if (previous && previous !== userId) {
    throw new Error('На этом устройстве уже привязаны данные другого аккаунта. Сначала отключите его и очистите локальную копию.');
  }
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    throw new Error('Не удалось сохранить привязку аккаунта на этом устройстве.');
  }
}

export function clearWorkspaceOwnerBinding(): void {
  try { localStorage.removeItem(OWNER_KEY); } catch { /* состояние всё равно блокируется на следующем входе */ }
}

function validSnapshot(value: unknown): value is WorkspaceSyncSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.schema === 'svetlana-workspace' && v.version === 1 &&
    Array.isArray(v.agents) && Array.isArray(v.threads) && Array.isArray(v.memories) &&
    !!v.tombstones && typeof v.tombstones === 'object';
}

export interface SyncResult {
  revision: number;
  syncedAt: number;
  agents: number;
  threads: number;
  memories: number;
}

export async function enableAndSyncWorkspace(userId: string): Promise<SyncResult> {
  bindWorkspaceOwner(userId);
  return syncBoundWorkspace();
}

/** Manual/automatic sync is allowed only after the user explicitly bound this local copy to the same account. */
export async function syncBoundWorkspace(): Promise<SyncResult> {
  const supabase = getCloudClient();
  if (!supabase) throw new Error('Облачная синхронизация не настроена.');
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user;
  if (authError || !user) throw new Error('Войдите в аккаунт перед синхронизацией.');
  if (boundWorkspaceOwnerId() !== user.id) {
    throw new Error('Локальная копия не привязана к этому аккаунту. Подтвердите привязку перед первой синхронизацией.');
  }

  const { data: remoteRow, error: readError } = await supabase
    .from('svetlana_workspace_snapshots')
    .select('revision,payload')
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) throw new Error('Не удалось прочитать облачную копию. Проверьте, что миграция Supabase установлена.');
  let revision = typeof remoteRow?.revision === 'number' ? remoteRow.revision : 0;
  if (remoteRow?.payload) {
    if (!validSnapshot(remoteRow.payload)) throw new Error('Облачная копия имеет неподдерживаемый формат.');
    personalWorkspace.mergeSyncSnapshot(remoteRow.payload);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = personalWorkspace.exportSyncSnapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_PAYLOAD_CHARS) {
      throw new Error('История слишком велика для одного облачного пакета (лимит 3,5 МБ). Удалите или экспортируйте старые диалоги.');
    }
    const { data, error } = await supabase.rpc('sync_svetlana_workspace', {
      p_expected_revision: revision,
      p_payload: snapshot,
    });
    if (error) {
      const message = error.message || '';
      if (message.includes('function') || message.includes('schema cache') || message.includes('svetlana_workspace')) {
        throw new Error('Сервер синхронизации не настроен. Примените миграцию supabase/migrations/20261023060000_svetlana_personal_workspace_sync.sql.');
      }
      throw new Error('Не удалось сохранить облачную копию. Проверьте сеть и настройки Supabase.');
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result !== 'object') throw new Error('Сервер синхронизации вернул неожиданный ответ.');
    const response = result as { ok?: unknown; revision?: unknown; payload?: unknown };
    if (response.ok === true && typeof response.revision === 'number') {
      return {
        revision: response.revision,
        syncedAt: Date.now(),
        agents: snapshot.agents.length,
        threads: snapshot.threads.length,
        memories: snapshot.memories.length,
      };
    }
    if (typeof response.revision !== 'number' || !validSnapshot(response.payload)) {
      throw new Error('Не удалось согласовать изменения между устройствами.');
    }
    // A concurrent device saved first. Merge its current version, then retry with its revision.
    personalWorkspace.mergeSyncSnapshot(response.payload);
    revision = response.revision;
  }
  throw new Error('Изменения часто обновляются с другого устройства. Повторите синхронизацию.');
}

export async function clearLocalWorkspaceAndBinding(): Promise<void> {
  // Do not destroy local data if signing out fails before the explicit cleanup can complete.
  await signOutCloud();
  personalWorkspace.clearAll();
  clearWorkspaceOwnerBinding();
}
