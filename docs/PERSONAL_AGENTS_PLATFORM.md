# Personal Agents Platform — Architecture and Delivery Contract

Status: ARCHITECTURE / implementation not yet proven  
Target branch: `svetlana-2.0-core-development-0416c`  
Feature branch: `feat/personal-agents-memory-integrations`

## Goal

Evolve Svetlana 2.0 from a single assistant/control dashboard into a multi-agent workspace inspired by the agent-creation workflow at Hyperagent. Reuse product concepts and interaction patterns, not Hyperagent code, branding, or proprietary assets.

A user must be able to create and configure an agent, chat in persistent threads, give it scoped memory and knowledge, enable approved tools/integrations, and inspect actions and approvals. Keep the existing Svetlana Android control plane and its safety gates intact.

## Product areas

1. **Threads and history**
   - Create, rename, archive, search, and delete conversations.
   - Persist ordered messages, timestamps, attachments metadata, model/provider metadata, tool calls, approvals, and execution evidence.
   - Resume a thread after app restart and continue with a bounded context window plus retrieved relevant history.
   - Export a thread as JSON/Markdown; deletion must also remove linked embeddings and derived memory where requested.
   - Show persistence status. If storage is unavailable, disclose that the conversation is local/temporary rather than silently claiming it is synced.

2. **Agent builder**
   - Create, clone, edit, disable, export, and delete agents.
   - Agent fields: stable ID, name, description, icon, system instructions, default model/provider, temperature/token limits, enabled tools, integration bindings, knowledge sources, memory policy, autonomy policy, and version history.
   - Guided creation flow: Identity → Instructions → Model → Tools → Integrations → Knowledge & Memory → Permissions → Test → Save.
   - Provide a starter template gallery, including research, document assistant, coding helper, and Android device assistant.
   - Allow promoting a successful thread into a draft agent, with the user reviewing generated instructions before saving.

3. **Memory and knowledge**
   - Separate conversation history from durable memory; do not inject entire old conversations into every prompt.
   - Memory scopes: personal/user, agent-private, project/workspace-shared. Never cross scopes by default.
   - Memory records include content, source thread/message, creation/update timestamps, confidence, tags, scope, and review status.
   - Initial learning policy is **Suggested**: agent proposes a memory, user reviews and accepts/rejects it. Auto-save can be an explicit per-category opt-in later.
   - User can view, edit, export, and delete memories and inspect their provenance.
   - Retrieval is permission-filtered before ranking; use local keyword search first and embeddings/vector search only when configured.
   - Treat documents, webpages, tool outputs, and imported conversations as untrusted data, never as system instructions.

4. **Integrations and tools**
   - Keep the existing `ToolRegistry`, `PolicyEngine` / `ActionGate`, sanitization, risk checks, confirmation flow, and verification as the final execution boundary.
   - Introduce a provider-neutral Integration Registry and adapter contract. Start with MCP servers and local HTTP/API adapters; add OAuth integrations only with secure token storage and refresh/revoke support.
   - Integration record: provider, display name, endpoint, auth mode, granted scopes, enabled tools, status, last health check, owner/scope, and audit metadata. Never store raw credentials in agent JSON, prompts, local logs, or exported configuration.
   - Require explicit allowlisting of tools per agent and per integration. Validate input/output schemas and enforce timeouts, size limits, rate limits, and cancellation.
   - Read-only by default. Writes, external messages, payments, destructive operations, device control, and shell execution require risk-based confirmation.
   - Display the exact tool, target, data, and consequence before a high-risk action; record BEFORE → ACTION → AFTER → VERIFY with PASS/FAIL/PENDING, without logging secrets or unnecessary personal data.

5. **Workspace and isolation**
   - Support personal workspace first; later add team workspaces with explicit roles (Owner, Editor, Member).
   - Scope threads, agents, files, memories, credentials, and audit events to the owner/workspace.
   - Enforce authorization in the data/service layer, not only in UI navigation.
   - A shared agent may use only explicitly shared memories and integrations; personal context and credentials never become shared implicitly.

6. **Runtime and portability**
   - Keep the web app and Android execution layer separate. The web agent can request device actions only through the existing controlled tool path; a successful MCP call alone is not proof the device action occurred.
   - Provider-neutral model adapter; local model/Ollama path remains available. Cloud providers are optional, not mandatory.
   - Web history sync can use the existing Supabase dependency when configured; support local persistence/offline mode with a clear distinction between local-only and synced data. Do not place service-role keys in the client.
   - Agent definitions and user-owned data should have versioned JSON export/import with schema validation. Secrets are excluded and must be rebound after import.

## Proposed logical modules

- `ThreadStore`: thread/message lifecycle, ordering, search, retention, export.
- `AgentRegistry`: agent CRUD, validation, versioning, cloning, templates.
- `MemoryService`: proposals, approval/rejection, scope-aware retrieval, provenance, deletion.
- `KnowledgeService`: user-provided files and indexed references, access checks, chunking/retrieval.
- `IntegrationRegistry`: connector lifecycle, auth status, health checks, scope and tool bindings.
- `ToolPolicyService`: adapter around existing safety gate; no parallel bypass path.
- `AgentRuntime`: compose system instructions + allowed tools + authorized memories/knowledge + thread context; execute calls through policy and record evidence.
- `AuditTrail`: redacted events and verification state.
- UI pages/components: Threads, Agent Builder, Agent Workspace, Memory Review, Integrations, Tool Permissions, Run Audit.

These are proposed contracts, not claims that the modules currently exist.

## Data model (minimum)

- `Workspace(id, ownerId, name, rolePolicy)`
- `Agent(id, workspaceId, ownerId, name, description, instructions, modelConfig, toolAllowlist, integrationBindings, memoryPolicy, autonomyPolicy, version, createdAt, updatedAt)`
- `Thread(id, workspaceId, ownerId, agentId, title, status, createdAt, updatedAt)`
- `Message(id, threadId, sequence, role, content, attachments, createdAt, status, providerMetadata)`
- `ToolRun(id, threadId, messageId, toolId, sanitizedInput, sanitizedOutput, approvalStatus, verificationStatus, timestamps)`
- `Memory(id, scopeType, scopeId, content, sourceThreadId, sourceMessageId, confidence, reviewStatus, createdAt, updatedAt)`
- `KnowledgeSource(id, scopeType, scopeId, kind, metadata, indexingStatus)`
- `IntegrationConnection(id, ownerId, workspaceId, provider, authReference, grantedScopes, status)`
- `AuditEvent(id, actorId, scopeId, action, targetType, targetId, redactedDetails, createdAt)`

Use migrations and unique constraints; enforce tenant/scope checks at every read/write. The exact database schema must be adapted to the selected persistence mode and existing Supabase setup before implementation.

## Delivery plan

### Phase 0 — Baseline and contracts
- Map the current app entry points, provider configuration, existing storage/Supabase setup, ToolRegistry and ActionGate.
- Add typed data contracts and architecture tests without changing Android execution behavior.
- Identify existing history/memory code; reuse only after reviewing actual implementation and tests.

### Phase 1 — Persistent chat history
- Thread/message store, sidebar/list, new/rename/archive/delete, restore after reload, search and export.
- Test ordering, duplicate writes, interrupted requests, offline mode, user/scope isolation, and deletion semantics.

### Phase 2 — Agent builder and runtime
- Agent CRUD/editor/templates, per-agent model and tool allowlist, versioned configuration.
- Ensure every tool call routes through existing policy, confirmation, sanitization, and verification.

### Phase 3 — Memory and knowledge
- Memory proposal/review UI, scoped memory store, retrieval with provenance, knowledge-source management.
- Test prompt injection resistance, cross-agent and cross-workspace isolation, and deletion/export.

### Phase 4 — Integrations
- MCP adapter lifecycle, schema validation, connection health, least-privilege tool bindings.
- OAuth-capable integrations only after secure backend token storage and revocation are implemented.
- Start with one low-risk read-only integration, then expand based on evidence.

### Phase 5 — Automation and collaboration
- Scheduled/webhook/channel entry points, approvals inbox, workspace roles, controlled agent-to-agent handoffs.
- All unattended runs have explicit scope, logs, limits, and an emergency disable path.

## Acceptance criteria

- [ ] New thread and every message survive browser reload and app restart in the selected persistence mode.
- [ ] A user can create an agent, edit its instructions/model/tools, save it, and start a new thread with that configuration.
- [ ] Agent configuration is versioned and export/import validates schema while excluding secrets.
- [ ] Memory is separate from history, reviewable, attributable to a source, scoped, and deletable.
- [ ] Retrieval cannot expose another user's, workspace's, or agent-private data.
- [ ] Integrations and tools are disabled unless explicitly allowed for the agent.
- [ ] High-risk actions cannot bypass the existing ActionGate/confirmation flow.
- [ ] Tool runs show actual execution and verification evidence; a request being issued is not labelled PASS.
- [ ] Secrets are absent from prompts, client bundles, logs, exports, and error messages.
- [ ] CI typecheck, unit tests, build, dependency/security checks pass.
- [ ] Android device control regression tests pass; real device behavior remains NOT PROVEN until verified on a device.
- [ ] UI distinguishes VERIFIED, PARTIAL, PENDING, and NOT PROVEN; no status is inferred from a mock or static screen.

## Evidence and status rules

Use these labels in PRs and reports:
- **VERIFIED** — supported by a passing automated test or reproducible runtime evidence.
- **PARTIAL** — only part of the acceptance criterion is implemented or tested.
- **PENDING** — work or verification remains.
- **NOT PROVEN** — no adequate evidence exists.

This document is an architecture and delivery contract only. It does not assert that history, durable memory, agent creation, or integrations have already been implemented.


## Implementation checkpoint — 2026-10-23

The current feature branch includes a first implementation slice; the following are **implemented in code, pending CI confirmation**:

- Local-first workspace persistence in `src/services/PersonalWorkspaceStore.ts` for agent definitions, scoped thread histories, messages, and agent memory notes, with schema validation, bounded record counts, and recognizable-secret redaction.
- `src/pages/PersonalAgentsPage.tsx` provides agent create/edit/delete, provider selection, manual memory management, saved threads, and JSON import/export.
- `src/DesktopShell.tsx` exposes the workspace in the main app navigation.
- `src/pages/AvatarPage.tsx` persists the default Svetlana chat and allows switching/deleting history threads.
- `src/__tests__/personalWorkspace.test.ts` covers store reload, scope isolation, secret redaction, export/import, and agent deletion.

**Known limits (not implemented yet):** cloud sync/authentication, server-side tenancy and shared workspaces, automatic memory extraction, semantic/vector retrieval, per-tool granular MCP allowlists from this page, OAuth connection setup, and real-device E2E. Local storage is not a substitute for a secured multi-user backend. Tool execution remains subject to the existing MCP/security path; the new workspace must not bypass it.

CI should determine whether the current code compiles and tests pass. Until those checks complete, the UI and store are implementation-present but **not yet VERIFIED at runtime**.
