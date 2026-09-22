# Svetlana 2.0 — Master Roadmap

Canonical working plan for Svetlana 2.0. This file is the shared source of truth for the owner and any other agent working on the repository.

Status convention:
- VERIFIED — direct repository/runtime evidence exists.
- NOT PROVEN — implementation/configuration exists but required runtime evidence is absent.
- PENDING — planned work.

## 1. Product architecture

Svetlana 2.0 is one universal AI core for three domains:
1. Мир Самозанятых — self-employed workflows, documents, clients, accounting/tax knowledge, CRM and services.
2. Marketplace — products, sellers, buyers, catalog, orders, pricing, SEO, competitors, content and analytics.
3. Я-Зарядка — child-oriented voice/AI, educational/game scenarios and strict safety.

Use one model/core plus separate domain skills and contexts. Do not create three unrelated Svetlana models.

The model learns transferable reasoning, planning, tool use and verification. Mutable/private facts stay outside model weights and are supplied through authorized context, RAG, APIs and tools.

## 2. Knowledge and access separation

Keep four independent concepts:
- KNOWLEDGE — what Svetlana can know/use.
- CONTEXT — current account, project and tenant.
- PERMISSIONS — what the current actor is allowed to do.
- TOOLS — what is technically available.
- CONFIRMATION — whether human confirmation is required.

Roles:
- CLIENT
- ADMIN
- SYSTEM

Client access is limited to the current user's authorized data and project functions.

Admin access is account/role based, not device based. Never infer ADMIN from voice, face, device or the model's own judgment.

Admin knowledge must not become available to clients merely because it was used during training.

## 3. Device-independent identity

Target:
Account → Authentication → Authorization → Project/Tenant Context → Svetlana.

Requirements:
- one account usable from multiple devices;
- secure authentication/passkeys/2FA as appropriate;
- active-session/device management;
- device revocation;
- recovery;
- step-up authentication for sensitive operations.

A device is an authentication endpoint, not the identity itself.

## 4. Universal Tool/Skill Registry

Create a provider-neutral registry for capabilities.

Each tool should define:
- stable capability ID;
- schema/description;
- permissions;
- risk level;
- confirmation requirement;
- availability;
- execution result;
- verification method;
- provenance/version.

MCP is an internal optional integration protocol, not a client feature and not a mandatory dependency. Tools may also be exposed through ordinary APIs, local functions or other transports.

Target execution chain:
User → Svetlana → Planner → Authorization/Policy → Tool Registry → Tool → Verification → Svetlana → User.

## 5. Open-source capability discovery

The initial reference set is:
- D4Vinci/Scrapling — web crawling/research/scraping/RAG/MCP.
- langgenius/dify — agents/workflows/RAG/tools/MCP/LLMOps.
- every-app/open-seo — SEO/site audit/keywords/competitor data/MCP.
- mutonby/openshorts — AI short-video/content pipeline/API/MCP.
- presenton/presenton — AI presentations/PPTX/PDF/API.

These are not a fixed list and should not automatically be embedded wholesale.

For every candidate:
1. inspect source code, not only README;
2. check license and redistribution/derivative-use constraints;
3. assess maintenance and maturity;
4. identify reusable modules/patterns;
5. inspect APIs/tools/MCP;
6. assess security/privacy;
7. decide: integrate, adapt, wrap, or learn only;
8. record the decision and evidence.

Daily discovery is required: globally search GitHub and other relevant ecosystems for new open-source projects, models, libraries, agents, MCP/tool ecosystems, RAG, web research, computer-use, multimodal, voice, vision, document/video/SEO and automation technologies. Include relevant Chinese and other global projects. The search is proactive and future-oriented, not limited to known repositories.

## 6. Marketplace skill

Svetlana must support:
- product and market research;
- competitor research;
- catalog and product-card generation;
- SEO and keyword analysis;
- seller/buyer assistance;
- pricing/market analysis;
- reviews/content analysis;
- image/content workflows;
- short-video workflows;
- presentation/catalog generation;
- marketplace analytics;
- authorized marketplace operations.

Typical workflow:
Research → Competitors → Product data → SEO → Content → Optional video/presentation → Verification.

Clients see useful results and understandable confirmations, not MCP/tool protocol details.

## 7. Мир Самозанятых skill

Support:
- client request → card → task;
- document extraction;
- reminders;
- contracts/invoices/status;
- calendar;
- accounting/tax/legal knowledge through current sources/RAG;
- CRM/collaboration;
- specialist/job search;
- work-profile knowledge;
- competitor/site audit;
- security/privacy workflows.

Current legal, tax, price, vacancy and other mutable facts must come from controlled current sources, not frozen model weights.

## 8. Я-Зарядка skill

Support:
- child-safe interactions;
- voice/TTS;
- educational/game scenarios;
- avatar states/animations;
- strict external-AI boundaries;
- age and safety policy enforcement.

This domain gets stricter tool/content policy than ordinary Marketplace or self-employed contexts.

## 9. Training strategy

Train universal behavior, not mutable operational data.

Core training:
- reasoning;
- planning;
- tool discovery and selection;
- tool chaining;
- tool-failure recovery;
- uncertainty;
- confirmation;
- verification;
- privacy/security;
- avoidance of hallucinated execution.

Domain training/evaluation:
- Self-employed;
- Marketplace;
- Ya-Zaryadka.

Admin-only training/evaluation:
- diagnostics;
- configuration;
- model/evaluation management;
- deployment;
- knowledge/tool management.

Never put private CRM records, secrets, current orders/inventory, credentials or other sensitive operational data into model weights.

## 10. Evidence standard

Preserve the existing evidence-gated workflow.

No PASS based only on added tests. Distinguish static/code evidence from runtime evidence.

Where real execution is required, target:
Code → CI → artifact/APK → real environment/device → tool call → real action → verification.

An API/MCP call alone does not prove that the intended external/device action happened.

Current training evidence carried forward:
- VERIFIED: production training contracts/static gates and Colab preparation exist according to repository evidence.
- NOT PROVEN: real GPU SFT of the target Gemma-4-E2B-it setup, adapter quality/improvement, final training evidence and LiteRT-LM conversion/validation.

## 11. Implementation phases

### Phase A — Architecture
1. Freeze Core/Domain/Admin separation.
2. Define identity/context/tenant model.
3. Define authorization and permission model.
4. Define provider-neutral Tool/Skill Registry.
5. Define result and verification contract.

### Phase B — Knowledge and tools
6. Create domain skill manifests.
7. Define RAG boundaries and source provenance.
8. Formalize Marketplace skill.
9. Formalize Self-employed skill.
10. Formalize Ya-Zaryadka skill.
11. Create open-source capability/discovery log.

### Phase C — Model
12. Expand training corpus for universal tool-use behavior.
13. Add domain-specific training/evaluation.
14. Run real GPU training.
15. Compare baseline versus adapter using fixed evaluation sets.
16. Validate quantization/runtime conversion only after model evidence is established.

### Phase D — Identity/security
17. Implement device-independent authentication.
18. Implement role/project/tenant authorization.
19. Implement device/session revocation.
20. Implement step-up authentication.
21. Add security and end-to-end tests.

### Phase E — Product integration
22. Integrate Marketplace tools.
23. Integrate Self-employed tools.
24. Integrate Ya-Zaryadka tools.
25. Integrate selected open-source capabilities only after code/license/security review.
26. Verify real end-to-end workflows.

### Phase F — Continuous expansion
27. Run daily global technology/open-source discovery.
28. Evaluate candidates.
29. Add useful capabilities to the registry.
30. Add training/evaluation examples when a new capability requires new behavior.
31. Keep this roadmap and evidence status current.

## 12. Non-goals

- Do not expose MCP terminology to ordinary clients.
- Do not make MCP mandatory.
- Do not bind admin access to one device.
- Do not put mutable/private operational data into model weights.
- Do not claim runtime success from static code/tests alone.
- Do not integrate projects solely from README claims; inspect implementation first.

## 13. Rule for every future agent

Before changing code:
1. Read this roadmap.
2. Inspect current repository state and relevant CI evidence.
3. Identify the exact phase/task.
4. Do not duplicate existing work.
5. Preserve VERIFIED / NOT PROVEN / PENDING labels.
6. After changes, record what was actually verified.
7. Update this roadmap when architecture, scope or status changes.

Strategic target: one Svetlana-2.0 core, three domain environments, explicit client/admin/system isolation, device-independent identity, provider-neutral tools, continuous capability discovery, and evidence-gated training/integration.


## 14. Canonical knowledge architecture artifacts

The knowledge architecture introduced by the September 2026 expansion is maintained in:
- `docs/SVETLANA_ARCHITECTURE_CONTRACT.md` — runtime architecture and separation of core/context/policy/tools/verification.
- `training/knowledge/SVETLANA_KNOWLEDGE_SKELETON.json` — machine-readable knowledge tree.
- `training/knowledge/SVETLANA_KNOWLEDGE_PACK_V1.json` — operational definitions and workflows for priority nodes.
- `training/knowledge/SVETLANA_KNOWLEDGE_PACK_V2.json` — second structured knowledge pack covering the remaining skeleton leaf nodes.
- `training/knowledge/SVETLANA_KNOWLEDGE_COVERAGE.md` — skeleton-to-evidence coverage.
- `training/knowledge/OPEN_SOURCE_DISCOVERY_LOG_2026-09.md` — inspected external capability candidates.
- `training/datasets/SVETLANA_TRAINING_CURRICULUM.md` — curriculum v3.
- `training/datasets/svetlana_knowledge_skeleton_expansion_v1.jsonl` and `v2.jsonl` — synthetic behavior expansion.
- `training/evaluation/svetlana_knowledge_skeleton_eval_v1.jsonl`, `v2.jsonl` and `v3.jsonl` — held-out evaluation sets.
- `training/knowledge/SVETLANA_SKILL_MANIFESTS_V1.json` — machine-readable skills and their tool contracts.
- `training/knowledge/SVETLANA_TOOL_CONTRACTS_V1.json` — machine-readable runtime/domain tool contracts.
- `training/evaluation/FROZEN_BENCHMARK_MANIFEST_V1.json` — immutable benchmark suites with Git blob identities.
- `training/evaluation/FROZEN_BENCHMARK_GENERATION_V1.json` — frozen baseline/candidate generation configuration.
- `training/evaluation/validate_benchmark_manifest.py` — frozen benchmark structural/immutability validator.
- `training/evaluation/generate_frozen_benchmark_predictions.py` — single-load GPU prediction runner for all frozen suites.
- `training/evaluation/compare_frozen_benchmark.py` — baseline/candidate comparison artifact builder.

### Current static evidence
- VERIFIED: 38 knowledge nodes are defined.
- VERIFIED: combined V1 + V2 knowledge packs provide dedicated structured knowledge for all 38/38 nodes.
- VERIFIED: 37 v1 + 67 v2 synthetic training examples were created and registered.
- VERIFIED: 18 v1 + 24 v2 held-out cases were created and kept outside the train list.
- VERIFIED: no ID overlap was found within the new v1/v2/v3 train and eval groups; every new train example references a skeleton node.
- VERIFIED: current runtime tool IDs are fully linked to machine-readable tool contracts; contract count and concrete RealTools linkage are checked structurally.
- VERIFIED: frozen benchmark suites and generation config carry immutable Git blob identities checked by the validator.
- VERIFIED: v3 adds 54 targeted training cases + 54 distinct held-out cases for underrepresented skeleton leaf nodes.
- NOT PROVEN: model capability improvement, GPU SFT quality, runtime tool/device behavior, human review, or LiteRT-LM readiness.

### Expansion operating rule
Do not expand the corpus by volume alone. Each wave must start from a named skeleton gap or evaluation failure and add diverse positive, negative, ambiguous, failure, recovery, confirmation and verification cases. Mutable/current facts remain external knowledge.
