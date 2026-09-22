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
## Expansion v2

Added operational knowledge pack v1 plus 67 additional training examples and 24 new held-out cases. New coverage is concentrated on Marketplace operations, agent/tool contracts, identity/admin governance, document workflows, child safety, runtime evidence and continuous-learning behavior.

The discovery log records six additional reference projects reviewed at source level, including Chinese-origin Qwen-Agent, UI-TARS Desktop, MinerU, PaddleOCR and OpenManus, plus Browser Use.

Current capability result remains **NOT PROVEN** until held-out execution and, where applicable, real runtime evidence exist.


## Expansion v3 — implementation-grounded skills

- Added `SVETLANA_SKILL_MANIFESTS_V1.json` to map core, Marketplace, Self-employed, Я‑Зарядка and Admin skills to tools, policy and evidence requirements.
- Added a static audit of the current `ToolRegistry.ts`. The audit records concrete gaps instead of teaching the model that those controls already exist.
- Added 50 ToolRegistry training examples and 21 held-out cases.
- Added 47 document-intelligence training examples and 16 held-out cases, grounded in document/OCR/RAG/artifact workflows.
- Manifest is now schema 2.0.

### Static evidence after v3
- VERIFIED: new training/eval files are structurally parseable by the repository data contract.
- VERIFIED: new skill and knowledge manifests are registered in the training manifest.
- VERIFIED: no claim is made that these additions improve model quality before held-out execution.
- NOT PROVEN: model capability improvement, GPU SFT, device/runtime execution and LiteRT-LM validation.
