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

## NOT IMPLEMENTED / GAP
1. The current `executeTool` path does not enforce `ToolExecutionContext.permissions`. The field exists, but authorization is not visibly checked in this class.
2. `executionLog` stores `params` and `result` directly. There is no redaction/minimization step in this class before logging. Sensitive values therefore require an upstream/downstream privacy control before being passed here.
3. The registry's risk confirmation logic is local to the registry. A separate account/role/project authorization layer is still required by the architecture contract.
4. Verification is optional per tool. Critical irreversible tools need an independent verification path; optional `verify` alone should not be treated as a universal guarantee.

## Training implication
Svetlana must learn that:
- technical availability != authorization;
- a risk flag != identity/permission proof;
- a tool result != verified external state;
- logs must not become a secondary data-exfiltration path;
- UNKNOWN_STATE is required after ambiguous post-error execution.

## Required future code work
- Add an explicit authorization/policy gate before execution.
- Add privacy-safe audit logging with field classification/redaction.
- Define mandatory verification policies for critical capabilities.
- Add tests and runtime evidence for permission denial, confirmation and post-action verification.

Status: STATIC REVIEW VERIFIED; enforcement and runtime behavior NOT PROVEN.
