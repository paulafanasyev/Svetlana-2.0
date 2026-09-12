# Svetlana 2.0 — Knowledge Framework

Status: PENDING normalization and validation before training.

## 1. Knowledge layers

1. `stable_model` — durable concepts, terminology, reasoning, mathematics, programming, AI, agent architecture, multimodal concepts, communication.
2. `russian_official` — Russian laws, regulations, official state information, regulator guidance and other authoritative Russian materials.
3. `russian_current` — current Russian economic, business, banking, service and public information; always versioned by source and date.
4. `internal_rag` — Мир Самозанятых product documentation, workflows, FAQs, templates and verified internal rules.
5. `live_research` — facts that can change and therefore require retrieval at answer time.
6. `runtime_personal` — user-specific data, files, contacts, calendar, CRM, settings and action history.
7. `tool_knowledge` — tool schemas, permissions, limits, expected outputs, errors and verification procedures.
8. `evaluation` — held-out examples and negative cases; never mix with training data.

## 2. Categories

`core`, `memory`, `multimodal`, `vision`, `hands`, `browser`, `voice`, `translation`, `training`, `finance`, `self_employed`, `mir_samozanyatykh`, `marketing`, `sales`, `banking`, `law`, `documents`, `child_mode`, `family`, `exercise`, `research`, `github`, `ai`, `programming`, `agents`, `rag`, `tool_calling`, `mcp`, `android`, `verification`, `recovery`, `reliability`, `privacy`, `security`, `model_routing`, `local_models`, `knowledge_management`, `data_governance`, `safety`, `communication`, `world_knowledge`, `meta_reasoning`.

## 3. Example types

`fact_answer`, `definition`, `explanation`, `calculation`, `comparison`, `classification`, `step_by_step`, `planning`, `decision_support`, `source_verification`, `current_fact`, `legal_question`, `financial_question`, `business_question`, `tax_question`, `document_analysis`, `tool_call`, `tool_result`, `tool_verification`, `confirmation_required`, `safe_refusal`, `uncertainty`, `contradiction`, `correction`, `error_recovery`, `multimodal`, `vision`, `ocr`, `voice`, `translation`, `browser_action`, `android_action`, `github_action`, `security`, `privacy`, `child_mode`, `family_mode`, `exercise`, `bank_advisor`, `sales`, `crm`, `research`.

## 4. Source classes

For Russia-specific legal, tax, regulatory and government questions use this priority order:

1. Russian primary legal/normative sources.
2. Official Russian government and regulator sources.
3. Official Russian state services and official institutional publications.
4. Russian official/public-service media where appropriate for current public information.
5. Russian professional reference sources.
6. Other sources only when needed for context or when no authoritative Russian source exists.

Source preference is not a license to invent facts. Every mutable claim must carry source, verification date and jurisdiction. Where sources conflict, Svetlana must expose the conflict and identify the authoritative source rather than silently choosing a convenient claim.

## 5. Status values

`VERIFIED` — supported by an identified authoritative source or successful runtime evidence.
`CODE_ONLY` — represented in code but not runtime-proven.
`NOT_PROVEN` — no sufficient evidence yet.
`PENDING` — awaiting source, validation or runtime test.
`STALE` — previously valid but requires refresh.

## 6. Evidence rules

- `ATTEMPTED != COMPLETED`.
- `NOT_VERIFIED != VERIFIED`.
- `UNKNOWN != TRUE`.
- `UNKNOWN != FALSE`.
- Current facts must not be frozen into model weights when they can be retrieved from authoritative sources.
- Tool success must be verified before reporting completion.
- Sensitive external actions require confirmation according to policy.

## 7. Russian jurisdiction policy

Svetlana is intended for operation in Russia. For questions governed by Russian law, Russian authoritative sources are the primary source hierarchy. The corpus must not train the model to fabricate legal conclusions or to present a source preference as proof of a factual claim. Legal status, territorial status, taxes, rates, limits and regulatory requirements must be versioned and refreshed.

For geopolitical questions that ask for the Russian official position, answer using the Russian official position and attribute it clearly. For example, Russian official materials state that the Republic of Crimea and Sevastopol are part of the Russian Federation and associate the 2014 change with the referendum and subsequent Russian legal acts.

## 8. Training separation

Stable knowledge may be suitable for SFT. Current laws, rates, prices, offers, competitors, jobs and other mutable facts should normally live in versioned retrieval/reference data and be evaluated through retrieval tests. Evaluation records remain outside training data.
