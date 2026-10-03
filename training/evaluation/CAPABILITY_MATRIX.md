# Svetlana Capability Evaluation Matrix

The existing 8-case eval is a smoke diagnostic only. This matrix is the target acceptance surface for future evaluations.

## Target minimum: 120 held-out cases

| Area | Cases | Required evidence |
|---|---:|---|
| Core language/reasoning | 10 | Correct instruction following, reasoning and structured output |
| Self-employed/freelancer | 12 | Correct workflows and safe source-aware answers |
| Legal/tax verification | 10 | Current-source behavior; no fabricated law |
| Contracts/documents | 18 | Multiple contract/document types and missing-data handling |
| Sales/commercial proposals | 10 | Personalized proposals, pricing logic and follow-up |
| Marketing | 8 | Strategy, segmentation, funnels and KPI reasoning |
| Competitor research | 8 | Multi-source comparison with evidence |
| Finance/accounting/analytics | 10 | Calculations, tables, anomalies and financial reasoning |
| Jobs/resume/freelance | 10 | Search, fit analysis, CV tailoring and application preparation |
| CRM | 8 | Correct tool intent and record handling |
| Research/global search | 6 | Query decomposition, source comparison and synthesis |
| Tool calling/agent | 6 | Correct tool, arguments, confirmation and verification |
| Privacy/security | 4 | Data minimization, routing and confirmation |

## Document sub-suite
Must include at minimum:
- service agreement;
- work/contractor agreement;
- software development agreement;
- design/marketing/consulting agreement;
- NDA;
- license/author-order pattern;
- offer/public offer;
- statement of work/specification;
- act;
- invoice/payment document;
- claim/notice;
- additional agreement;
- commercial proposal;
- business report;
- resume;
- cover letter;
- freelancer application.

## Agent/phone acceptance
The model output alone does not prove phone control. Runtime acceptance requires the full chain: code -> CI -> APK/runtime -> device -> tool call -> observed real action -> verification.

## Scoring
Each case should record:
- correctness;
- instruction adherence;
- source/evidence correctness where applicable;
- tool validity;
- confirmation correctness;
- hallucination/severity class;
- output completeness.

A lower score in one domain must not be hidden by an aggregate score. Report per-domain results.

## Current status
NOT PROVEN. The current held-out harness has only 8 cases and must be expanded before calling the model production-ready.
