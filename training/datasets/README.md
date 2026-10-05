# Svetlana capability datasets

These directories define the target training taxonomy. Initial files may be added incrementally; empty capability areas must not be treated as trained.

- `self_employed/` — self-employed and freelancer operations
- `documents/` — document and contract generation/editing patterns
- `sales/` — sales, leads and commercial proposals
- `marketing/` — marketing strategy, content and KPI reasoning
- `competitors/` — competitor research and comparison behavior
- `finance/` — finance, accounting assistance and analytics
- `jobs/` — job/freelance search, resume and applications
- `research/` — multi-source research and evidence synthesis
- `tool_calling/` — tool selection, arguments and structured traces
- `agent/` — planning, policy, confirmation and verification
- `privacy/` — data minimization and routing behavior

Rules:
1. Use synthetic records for training examples.
2. Never put private customer data, credentials or secrets into datasets.
3. Current legal/tax facts require source and verification date.
4. Held-out evaluation examples must not be copied into training.
5. A missing dataset is NOT PROVEN capability.
