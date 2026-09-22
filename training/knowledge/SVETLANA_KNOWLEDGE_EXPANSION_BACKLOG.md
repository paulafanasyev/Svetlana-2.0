# Svetlana 2.0 — Knowledge Expansion Backlog

## Rule
Priority is driven by capability gaps, held-out failures and runtime evidence. A task is complete only when knowledge, training examples, held-out evaluation and runtime dependencies are mapped.

| Wave | Focus | Target | Primary nodes | Deliverables |
|---|---|---:|---|---|
| W1 | Core reliability | 100 examples | 00.core.* | recovery/verification/uncertainty/false-execution |
| W2 | Tool registry | 100 | 02.agent.* | schemas, permissions, idempotency, confirmation |
| W3 | Marketplace catalog | 150 | 05.marketplace.catalog | attributes, variants, normalization, catalog integrity |
| W4 | Marketplace SEO/competitors | 150 | 05.marketplace.seo, 05.marketplace.competitors | keyword intent, platform constraints, dated comparisons |
| W5 | Marketplace operations/media | 120 | 05.marketplace, 05.marketplace.media | bulk updates, publishing, image/video/presentation verification |
| W6 | Self-employed execution | 150 | 04.self_employed.* | CRM, documents, payments, jobs, proposals |
| W7 | Legal/tax source behavior | 120 | 03.knowledge.sources, 04.self_employed.tax | freshness, jurisdiction, official-source discipline |
| W8 | Я‑Зарядка | 120 | 06.ya_zaryadka.* | child safety, education, voice, privacy |
| W9 | Admin/governance | 100 | 07.admin.* | identity, tenant, models, datasets, evaluation, audit |
| W10 | Open-source discovery | 100 | 08.discovery.* | code/license/security/maturity decisions |
| W11 | Browser/computer runtime | 100 | 09.runtime.* | live state, postconditions, recovery |
| W12 | Continuous learning | 80 | 10.continuous_learning | failure generalization, regression protection |

## Sampling contract per wave
For each 100 examples, prefer a balanced mixture of:
- successful workflows;
- incomplete/ambiguous inputs;
- conflicting requirements;
- tool-call/schema errors;
- partial failures and UNKNOWN_STATE;
- confirmation-required operations;
- post-action verification;
- privacy-sensitive routing;
- prompt-injection or untrusted-content traps.

## Promotion gates
1. JSON/schema and duplicate validation.
2. Manifest registration.
3. Held-out set created independently.
4. Baseline evaluation.
5. Candidate model evaluation.
6. Regression check against earlier waves.
7. Runtime proof when the node depends on external execution.

No single wave should be declared a model-quality success solely from training loss or test-file existence.
