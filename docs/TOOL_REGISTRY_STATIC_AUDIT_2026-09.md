# Tool Registry Static Audit — 2026-09

## Evidence source
`src/services/ToolRegistry.ts` from `chore/training-evidence-gates` was inspected at source level.

## VERIFIED static facts
- `Tool` has `id`, `name`, `description`, `inputSchema`, `riskLevel`, `category`, `execute`, optional `verify`, and `isAvailable`.
- `ToolExecutionContext` contains `platform`, `permissions`, and `environment`.
- Input validation is performed before availability checks and execution.
- High/critical risk tools return `requiresConfirmation` from `executeTool` instead of executing immediately.
- Successful execution with a `verify` callback can receive a PASS/FAIL verification result.
- An execution log is maintained.

## VERIFIED static after security patch
1. `Tool.requiredPermissions` is now an optional contract field.
2. `executeTool` and `executeWithConfirmation` reject calls when a tool declares required permissions that are absent from the current `ToolExecutionContext.permissions`.
3. Execution logs recursively redact sensitive key names (password/token/secret/api-key/authorization/cookie) and truncate very long strings.
4. High/critical confirmation messages use the same redaction path and do not interpolate raw sensitive fields.

## NOT PROVEN / REMAINING GAP
1. Existing `RealTools.ts` definitions do not currently declare concrete `requiredPermissions`, so permission enforcement is structurally available but not yet bound to the live tools.
2. The registry's risk confirmation logic is local to the registry. Separate account/role/project authorization is still required by the architecture contract.
3. Verification remains optional per tool. Critical irreversible capabilities still require independent runtime evidence.
4. The existing `PolicyEngine` is not yet the single authorization path for registry execution.

## Training implication
Svetlana must learn that:
- technical availability != authorization;
- a configured permission gate is necessary but does not establish account/role authorization;
- a tool result != verified external state;
- logs must not become a secondary data-exfiltration path;
- UNKNOWN_STATE is required after ambiguous post-error execution.

## Required future code work
- Add an explicit authorization/policy gate before execution.
- Add privacy-safe audit logging with field classification/redaction.
- Define mandatory verification policies for critical capabilities.
- Add tests and runtime evidence for permission denial, confirmation and post-action verification.

Status: STATIC REVIEW VERIFIED; enforcement and runtime behavior NOT PROVEN.
