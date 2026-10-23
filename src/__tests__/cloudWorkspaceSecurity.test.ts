import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = process.cwd();
const migration = readFileSync(resolve(root, 'supabase/migrations/20261023060000_svetlana_personal_workspace_sync.sql'), 'utf8');
const syncClient = readFileSync(resolve(root, 'src/services/CloudWorkspaceSync.ts'), 'utf8');

describe('cloud workspace sync security contract', () => {
  it('enables and forces RLS and scopes row reads to the authenticated owner', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('force row level security');
    expect(migration).toContain('using (auth.uid() = user_id)');
    expect(migration).toContain('revoke all on table public.svetlana_workspace_snapshots from anon, authenticated');
    expect(migration).toContain('grant select on table public.svetlana_workspace_snapshots to authenticated');
  });

  it('authorizes RPC writes from auth.uid and rejects malformed/oversized payloads', () => {
    expect(migration).toContain('v_user_id uuid := auth.uid()');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("is distinct from 'svetlana-workspace'");
    expect(migration).toContain("is distinct from '1'");
    expect(migration).toContain('octet_length(p_payload::text) > 4000000');
    expect(migration).toContain('if v_revision <> p_expected_revision then');
    expect(migration).toContain('grant execute on function public.sync_svetlana_workspace(bigint, jsonb) to authenticated');
  });

  it('uses only public client configuration and never embeds a service-role key', () => {
    expect(syncClient).toContain('VITE_SUPABASE_URL');
    expect(syncClient).toContain('VITE_SUPABASE_ANON_KEY');
    expect(syncClient).not.toMatch(/service[_-]?role|serviceRoleKey/i);
    expect(syncClient).toContain('boundWorkspaceOwnerId() !== user.id');
    expect(syncClient).toContain('personalWorkspace.mergeSyncSnapshot(response.payload)');
  });
});
