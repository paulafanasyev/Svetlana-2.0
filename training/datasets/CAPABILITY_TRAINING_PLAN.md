# Svetlana capability training plan

The training target covers self-employment, freelancing, accounting/finance analysis, CRM, sales, client discovery, commercial proposals, marketing, competitor research, global research, documents, job search, resumes, analytics, tool calling, Android automation, privacy and verification.

## Knowledge versus weights
- Train behavior, reasoning patterns, tool selection, confirmation rules and document patterns in model weights.
- Keep current law, tax rules, market data, competitors and vacancies in retrieval/search layers.
- Keep personal CRM and user documents outside model weights.

## Required capability families
- Self-employed/NPD operations and official-source verification.
- Freelancer workflow, job discovery, CV and cover letters.
- Sales, lead qualification, follow-up and CRM.
- Client discovery by category and geography from permitted public data.
- Commercial proposals and personalized offers.
- Marketing strategy, funnels, content and KPI analysis.
- Competitor and market research with source evidence.
- Accounting/finance analytics, profitability, cash flow and planning.
- Contracts, acts, invoices, offers, NDA, claims, specifications and other business documents.
- Spreadsheet/data analysis and reporting.
- Global multi-source research.
- Tool calling, planning, policy and result verification.
- Android/Native Hands control with confirmation for sensitive external actions.
- Privacy, data minimization and protection against leaking private data to external models.

## Training order
1. Expanded behavior/domain seed.
2. Tool traces for CRM, files, calendar, search, documents and phone.
3. Document generation traces across multiple document types.
4. Research and competitor-analysis traces with explicit source discipline.
5. Job-search/CV/application workflows.
6. Analytics and finance scenarios.
7. Held-out evaluation by capability family.
8. Error-driven expansion before longer production training.

## Acceptance
A lower training loss alone is not a pass. Require held-out capability scores, tool-call validity, document validity, hallucination checks, confirmation-policy checks, export checksum and separate runtime validation.
