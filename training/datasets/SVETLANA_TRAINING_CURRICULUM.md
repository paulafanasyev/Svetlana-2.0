# Svetlana 2.0 — Master Training Curriculum v3

## Objective
Train one universal Svetlana behavior layer plus explicit domain skills. Stable behavior belongs in weights; changing facts and private data stay in retrieval/context/tool layers.

## L0 — Base model
Russian and multilingual instruction following, structured generation, extraction, summarization, arithmetic, multimodal foundations and general reasoning.

## L1 — Svetlana core behavior
Uncertainty, evidence boundaries, clarification, user intent, privacy, safety, source discipline, no fabricated execution, transparent state reporting.

## L2 — Agentic execution
Plan/decompose, tool discovery, schema-valid arguments, dependency ordering, idempotency, failure classification, recovery, confirmation gates, verification and UNKNOWN_STATE handling.

## L3 — Universal professional layer
Research, documents, data/spreadsheets, communication, productivity, finance analysis, proposals, contracts, marketing, jobs and technical assistance.

## L4 — Self-employed domain
NPD/self-employed operations, client lifecycle, CRM, documents, payments, calendar, jobs, accounting support and current-source legal/tax workflows.

## L5 — Marketplace domain
Catalog and product intelligence, seller/buyer operations, pricing analysis, SEO, competitor research, reviews, advertising, analytics, media/content generation and marketplace workflows.

## L6 — Я‑Зарядка domain
Child-safe dialogue, education/game patterns, voice/TTS interaction, avatar state control, age-aware safety, privacy and strict external-tool constraints.

## L7 — Admin and governance
Account/tenant concepts, authorization, provider/model selection, RAG governance, tool registry, dataset provenance, evaluation, deployment, diagnostics and audit.

## L8 — Continuous discovery
How to inspect new open-source projects, models and tools; read code; reason about licenses; identify reusable modules; evaluate maturity/security; and decide integrate/adapt/wrap/learn-only.

## Data composition
Target mix: 35% core behavior and reliability; 20% agent/tool traces; 15% universal professional workflows; 10% self-employed; 10% Marketplace; 5% Я‑Зарядка; 5% admin/discovery. Rebalance from evaluation failures rather than blindly increasing corpus size.

## Example design
Each capability should contain successful, incomplete, ambiguous, conflicting, tool-failure, recovery, confirmation-required, verification-required, privacy-sensitive and hallucinated-execution-trap examples.

## Training gates
Before GPU SFT: schema validation, exact/normalized/near-duplicate checks, train/eval separation, no personal data/secrets, manifest consistency and required trainer compatibility.
After GPU SFT: non-empty adapter/checkpoints, fixed baseline comparison, held-out capability evaluation and regression checks.
Runtime conversion is a separate gate and does not inherit SFT PASS.

## Expansion rule
Every new knowledge node must map to: knowledge definition → behavior examples → held-out evaluation → tool/runtime contract where applicable.