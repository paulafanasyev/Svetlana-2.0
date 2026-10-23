-- Private, one-snapshot-per-user store for Svetlana personal agents.
-- All writes are compare-and-swap through sync_svetlana_workspace(); clients cannot write rows directly.
create table if not exists public.svetlana_workspace_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision >= 1),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint svetlana_workspace_payload_is_object check (jsonb_typeof(payload) = 'object')
);

alter table public.svetlana_workspace_snapshots enable row level security;
alter table public.svetlana_workspace_snapshots force row level security;

drop policy if exists "Users can read their own Svetlana workspace" on public.svetlana_workspace_snapshots;
create policy "Users can read their own Svetlana workspace"
  on public.svetlana_workspace_snapshots
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.svetlana_workspace_snapshots from anon, authenticated;
grant select on table public.svetlana_workspace_snapshots to authenticated;

create or replace function public.sync_svetlana_workspace(
  p_expected_revision bigint,
  p_payload jsonb
)
returns table(ok boolean, revision bigint, payload jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision bigint;
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid expected revision' using errcode = '22023';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload ->> 'schema' is distinct from 'svetlana-workspace'
     or p_payload ->> 'version' is distinct from '1' then
    raise exception 'Invalid Svetlana workspace payload' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 4000000 then
    raise exception 'Workspace payload is too large (4 MB maximum)' using errcode = '22023';
  end if;

  -- Serialize first writes as well as updates for the same account.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 2026));

  select s.revision, s.payload
    into v_revision, v_payload
    from public.svetlana_workspace_snapshots as s
    where s.user_id = v_user_id
    for update;

  if not found then
    if p_expected_revision <> 0 then
      return query select false, 0::bigint,
        jsonb_build_object('schema', 'svetlana-workspace', 'version', 1,
                           'agents', '[]'::jsonb, 'threads', '[]'::jsonb,
                           'memories', '[]'::jsonb,
                           'tombstones', jsonb_build_object('agents', '{}'::jsonb, 'threads', '{}'::jsonb, 'memories', '{}'::jsonb));
      return;
    end if;
    insert into public.svetlana_workspace_snapshots(user_id, revision, payload, updated_at)
      values (v_user_id, 1, p_payload, now());
    return query select true, 1::bigint, p_payload;
    return;
  end if;

  if v_revision <> p_expected_revision then
    return query select false, v_revision, v_payload;
    return;
  end if;

  update public.svetlana_workspace_snapshots as s
     set payload = p_payload, revision = v_revision + 1, updated_at = now()
     where s.user_id = v_user_id;

  return query select true, v_revision + 1, p_payload;
end;
$$;

revoke all on function public.sync_svetlana_workspace(bigint, jsonb) from public, anon;
grant execute on function public.sync_svetlana_workspace(bigint, jsonb) to authenticated;
