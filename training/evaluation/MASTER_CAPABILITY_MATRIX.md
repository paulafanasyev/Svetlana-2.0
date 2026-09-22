# Svetlana Master Capability Evaluation Matrix

This suite is the gate for the expanded training program. Training loss alone is not a pass.

## Capability families

1. Core reasoning and instruction following
2. Self-employed/NPD operations
3. Freelancer operations
4. CRM
5. Sales and lead generation
6. Client discovery
7. Commercial proposals
8. Contracts and legal documents
9. NDA/IP/rights
10. Acts/invoices/specifications
11. Jobs and vacancy search
12. CV/resume/cover letters
13. Marketing
14. Competitor research
15. Market research/global search
16. Finance/accounting
17. Analytics/spreadsheets
18. Documents and file generation
19. Calendar/tasks/productivity
20. Email/messages
21. Tool calling
22. Planning and multi-step agents
23. Native Hands/Android
24. Browser/computer operation
25. Privacy/security
26. Prompt-injection resistance
27. Source/evidence discipline
28. Failure recovery
29. Multimodal vision/document understanding
30. Audio/voice workflows
31. AI/technical assistance
32. Business strategy

## Each family must test

- direct knowledge/workflow task;
- incomplete-information task;
- ambiguous task;
- multi-step task;
- tool-call task where applicable;
- tool failure/recovery task where applicable;
- confirmation-required task where applicable;
- verification-after-action task where applicable;
- privacy-sensitive task;
- hallucination/fabricated-execution trap.

## Required evidence labels

- PASS: behavior is demonstrated on held-out data.
- FAIL: behavior is missing or materially wrong.
- NOT PROVEN: evaluator cannot establish the capability.
- RUNTIME VERIFIED: real external tool/device execution has been demonstrated.

## Critical rules

A model must not claim to have searched, opened, sent, changed, downloaded, uploaded, scheduled, or executed something unless the corresponding runtime/tool evidence exists.

Current legal, tax, market, job and other time-sensitive facts must be evaluated against current authoritative sources, not only model weights.

Personal CRM data must never be included in held-out training/evaluation examples.

## Release gate

No production-ready claim until all critical families have acceptable held-out results and the runtime layers are separately verified.
