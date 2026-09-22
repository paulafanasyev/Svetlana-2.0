# Svetlana 2.0 — Knowledge Coverage Matrix v1

Legend: VERIFIED = concrete repository artifact exists; NOT PROVEN = behavior/runtime not demonstrated; PENDING = not yet implemented.

| Node | Knowledge artifact | Training examples | Held-out eval | Runtime/tool | Status |
|---|---|---|---|---|---|
| 00 Core | Existing behavior datasets + new expansion | Existing + v1 expansion | Existing core eval | Partial | NOT PROVEN |
| 02 Agent / registry | Skeleton + new behavior examples | v1 expansion | New eval | Tool contract pending | PENDING |
| 04 Self-employed | Existing official-source knowledge | Existing | Existing self-employed eval | Partial | NOT PROVEN |
| 05 Marketplace | NEW skeleton node | NEW v1 expansion | NEW v1 eval | Tool integrations pending | PENDING |
| 06 Я‑Зарядка | Existing child seed + NEW skeleton | NEW v1 expansion | NEW v1 eval | Voice/avatar runtime pending | PENDING |
| 07 Admin | NEW skeleton node | NEW v1 expansion | NEW v1 eval | Identity/governance runtime pending | PENDING |
| 08 Discovery | NEW skeleton node | NEW v1 expansion | NEW v1 eval | Search/research tooling required | PENDING |
| 09 Runtime | Existing Hands behavior | Existing | Existing runtime gates | Device evidence missing | NOT PROVEN |

## Main gaps identified
1. Marketplace had no dedicated capability family in the canonical evaluation matrix.
2. Я‑Зарядка had child/multimodal examples but lacked a complete domain workflow/evaluation layer.
3. Admin identity, tenant authorization, provider/model governance and dataset governance lacked dedicated training/eval nodes.
4. Provider-neutral tool registry semantics were not represented as a first-class knowledge node.
5. Continuous global/open-source discovery and code/license/security assessment were not represented as a training curriculum.

## Next expansion order
Marketplace → tool registry/agent execution → Я‑Зарядка → identity/admin → open-source discovery → runtime verification.

## Acceptance rule
A node does not become VERIFIED merely because a document or dataset exists. Capability requires held-out behavioral evidence; runtime-dependent nodes require runtime evidence.