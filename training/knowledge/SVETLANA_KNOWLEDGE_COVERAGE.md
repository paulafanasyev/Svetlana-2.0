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


## Expansion v4 — domain workflow corpora

- Marketplace workflow corpus: 45 training records + 16 held-out records.
- Self-employed workflow corpus: 38 training records + 16 held-out records.
- Both remain synthetic and contain no private CRM/customer records.
- The corpora emphasize missing data, source-of-truth conflicts, bulk operations, financial/external-action confirmation and post-action verification.

Current capability status remains **NOT PROVEN** until the held-out evaluator is actually run against a baseline/candidate model.


## Expansion v5 — safety and governance

- Я‑Зарядка: 30 training + 12 held-out cases covering child safety, privacy, voice ambiguity, education and external-action gates.
- Admin: 48 training + 16 held-out cases covering device-independent identity, tenant authorization, model/provider governance, dataset hygiene, audit logging, release gates and runtime evidence.
- Manifest schema is 2.2.

These additions explicitly teach the separation between trusted identity/policy and model inference. They do not prove enforcement in runtime code.


## Expansion v6 — executable evidence contracts

- VERIFIED static: combined V1 + V2 knowledge packs cover all 38/38 skeleton nodes with no duplicate node entries across the packs.

- Added `SVETLANA_KNOWLEDGE_PACK_V2.json` with 18 structured entries for the remaining previously uncovered skeleton nodes; coverage checker now scans V1, V2 and the document-intelligence pack.
- VERIFIED static: the new V2 pack provides dedicated knowledge entries for core reasoning/uncertainty/privacy/recovery, agent execution, self-employed subdomains, Я‑Зарядка education/voice, admin/model governance, discovery code, runtime and continuous learning.

- Skeleton leaf-gap expansion v3: 54 new training examples + 54 new held-out cases, one targeted pair per underrepresented leaf node.
- Cumulative new expansion on this branch is now 416 training records + 193 held-out records (excluding legacy files not tagged with the new expansion families).

- Added `SVETLANA_TOOL_CONTRACTS_V1.json`: 32 machine-readable contracts covering the current core/runtime tools plus planned domain integrations.
- Added explicit `tool_contract_ids` to all 9 skill manifests.
- Coverage checker now validates skill → tool contract → runtime tool consistency and fails on an uncontracted `RealTools.ts` ID.
- Added frozen benchmark identity (`SVETLANA_FROZEN_BENCHMARK`, version 1.0), structural validator and baseline/candidate comparison artifact builder.
- Frozen benchmark cases now carry explicit `evaluation.required_behaviors`; the annotation is based on user/assistant case content, not system instructions.
- Automated comparison records keep `automated_comparison_status`, `capability_status`, `human_review` and `runtime_evidence` separate.
- VERIFIED static: 139 frozen held-out records have non-empty recognized structured behavior requirements and valid privacy classification.
- VERIFIED static: 9 skills ↔ 32 tool contracts ↔ 10 current `RealTools` IDs are fully linked.
- NOT PROVEN: model quality improvement, real GPU SFT, baseline/candidate runtime inference, device execution, human review and LiteRT-LM conversion.
