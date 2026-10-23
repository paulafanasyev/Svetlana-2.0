# Cloud sync setup for Svetlana 2.0

Status: **implementation added; deployment configuration still required**.

Cloud sync is opt-in and uses the existing `@supabase/supabase-js` dependency. The browser/client uses only the public Supabase anon/publishable key. Row access is restricted to the authenticated owner with Row Level Security (RLS); writes happen through the compare-and-swap RPC, not direct table writes.

## 1. Create/configure the Supabase project

1. Choose a Supabase project and enable Email/Password under Authentication providers.
2. Choose an appropriate password policy and decide whether new users must confirm their email. If confirmation is required, configure the Supabase email template and Site URL for the public Svetlana deployment.
3. Apply the SQL in `supabase/migrations/20261023060000_svetlana_personal_workspace_sync.sql` using the Supabase SQL Editor or your normal migration pipeline.
4. In the SQL editor, confirm that `public.svetlana_workspace_snapshots` has RLS enabled and that `sync_svetlana_workspace(bigint,jsonb)` exists. Do not disable RLS or grant anonymous access.

The migration creates a single JSON snapshot row per authenticated user. The RPC checks `auth.uid()`, validates the schema and payload size, serializes writes per account and uses an expected revision to detect concurrent updates. A stale writer receives the latest snapshot; the client merges records and retries. Deletion tombstones are retained so deleted agents, threads, and memory do not reappear from an older device snapshot.

## 2. Set build-time environment variables

Set these variables in the Vercel project that builds this repository and in local development when cloud sync is wanted:

- `VITE_SUPABASE_URL`: the project URL, e.g. `https://<project-ref>.supabase.co`.
- `VITE_SUPABASE_ANON_KEY`: the project's **public anon/publishable key**.

Set the variables in the applicable Production, Preview, and Development environments, then redeploy/rebuild. These are Vite build-time values, so adding them without creating a new build will not enable the feature. The Vite CSP and the Windows Tauri CSP permit standard `*.supabase.co` project hosts. A custom Supabase domain requires an explicit CSP update before use.

**Never put the Supabase service-role/secret key in a `VITE_*` variable, browser bundle, agent config, prompt or exported JSON.** The service-role key bypasses RLS and is not needed by this client-side flow.

## 3. First sign-in and device binding

1. Open **Мои агенты → Облачная синхронизация**.
2. Create an account or sign in with the same account on each device.
3. On the first device, select **Разрешить и синхронизировать**. This explicit confirmation uploads and merges the current local agents, conversation history and memory with that account's cloud copy.
4. On the next device, sign in with the same account and confirm the first binding. It pulls and merges that account's cloud data into its local workspace.
5. Once bound, the workspace pulls/merges when the section is opened and checks for changes once per minute while it remains open. **Синхронизировать сейчас** forces an immediate round-trip.

The sync snapshot contains agent settings, thread histories, memory notes and deletion markers. Provider API keys and MCP credentials are not part of the snapshot and must be configured separately on each device.

## 4. Account and deletion behavior

- Local data remains on the device until the user explicitly deletes it.
- A device-bound account ID prevents accidentally merging the local workspace into a different signed-in account.
- Switching accounts requires explicitly disconnecting/clearing the local copy first. This deletes the local agents, conversations and notes on that device; it does **not** delete the previous account's cloud snapshot.
- The app never syncs to a newly signed-in account until the user confirms the first binding.
- Deleting an agent also marks its threads and memory for deletion, and tombstones synchronize those deletions to other devices.

## 5. Limits and verification

- The current protocol stores one snapshot row per user and limits a serialized client payload to 3.5 MB (the RPC hard limit is 4 MB). Very large histories must be exported or pruned before sync.
- This is account-level private sync, not a team workspace. Organization roles, shared agents, per-agent cloud credentials, and audit exports are separate future work.
- Supabase project setup, environment variables, email delivery, RLS deployment and cross-device runtime behavior cannot be considered verified until configured and tested in the actual project.
- Do not claim cross-device sync is live just because CI compiles: a test needs a configured Supabase project and two test devices/browsers signed in as the same test account.
