# Svetlana 2.0 — Master Training Scope

This is the master scope for training and evaluation. It intentionally goes beyond the initial capability map so missing operational skills are not silently omitted.

## 1. Core assistant intelligence
- Russian instruction following, dialogue, rewriting, summarization, extraction, classification.
- Planning, decomposition, prioritization, reasoning and structured outputs.
- Arithmetic, unit/currency/date reasoning and consistency checks.
- Multimodal document, image, screenshot and supported audio understanding.
- Programming, APIs, automation, debugging and technical explanations.
- Long-form reports, briefs, checklists and decision support.
- Clarification strategy: ask only for information that is actually missing.
- Uncertainty handling, confidence calibration and explicit evidence boundaries.

## 2. Personal productivity
- Tasks, reminders, recurring work, routines and priorities.
- Calendar planning, scheduling, rescheduling, conflicts and preparation.
- Email/message drafting, triage and follow-up.
- Notes, bookmarks, files, folders and knowledge organization.
- Meeting preparation, agendas, minutes and action extraction.

## 3. Self-employed / freelancer lifecycle
- Starting, configuring and operating a self-employed/freelance practice.
- NPD/self-employed tax workflows and receipt concepts using current official sources.
- Service definition, packaging, pricing and positioning.
- Estimation, workload/capacity planning and deadlines.
- Client onboarding, discovery, qualification, delivery and retention.
- Recurring services, subscriptions, retainers and renewals.
- Payment terms, deposits, milestones, overdue payments and collection workflows.
- Portfolio, reputation, referrals and repeat business.

## 4. Sales and lead generation
- ICP, personas, segmentation and qualification.
- Prospect discovery by industry, geography, company size, role and need.
- Lead scoring and prioritization.
- Outreach sequences and personalization.
- Discovery questions and call preparation.
- Objection handling, negotiation and closing.
- Follow-up scheduling and pipeline hygiene.
- Conversion, win/loss and funnel analysis.
- Cross-sell, upsell, renewal and referral strategies.

## 5. Commercial proposals and pricing
- Commercial proposals in multiple structures and levels of detail.
- Executive one-page offers and detailed proposals.
- Packages, tiers, optional modules and custom pricing.
- Scope, assumptions, exclusions, deliverables and acceptance criteria.
- ROI/value justification and business cases.
- Proposal personalization from CRM/research.
- Proposal comparison and revision tracking.
- Export-ready DOCX/PDF/HTML/Markdown/JSON representations.

## 6. Contracts and legal documents
- Service, contractor, development, design, consulting, marketing and education agreements.
- NDA/confidentiality agreements.
- Licensing, IP/author-order and usage-rights clauses.
- Agency/commission, supply, rental and other applicable templates.
- Public offers, terms, specifications/SOW and appendices.
- Acts, invoices, payment requests and supporting documents.
- Claims, notices, termination letters and amendments.
- Contract comparison, clause extraction and risk flagging.
- Missing-data detection and clause checklist generation.
- Jurisdiction-aware drafting with explicit legal uncertainty.
- Current law must be verified through authoritative sources; training weights must not be treated as current law.

## 7. Jobs and career operations
- Vacancy/project discovery.
- Filtering by role, skills, rate, geography, remote status and constraints.
- Vacancy-to-profile matching and gap analysis.
- CV/resume creation and tailoring.
- ATS-oriented variants.
- Cover letters and application messages.
- Portfolio/profile optimization.
- Interview preparation and mock interviews.
- Offer comparison and compensation analysis.
- Application tracking and follow-up.
- Submission requires explicit confirmation when an external action occurs.

## 8. Marketing
- Positioning, ICP, USP and offer architecture.
- Brand voice and messaging systems.
- Landing pages and conversion copy.
- SEO research and content planning.
- Social content, newsletters and email campaigns.
- Advertising concepts and campaign structures.
- Funnel design and lifecycle messaging.
- Experiments, hypotheses and A/B testing plans.
- KPI analysis: CTR, CPC, CPL, CPA, CAC, LTV, retention, ROI/ROMI.
- Marketing calendar and content repurposing.

## 9. Market and competitor intelligence
- Competitor discovery and categorization.
- Product/service, pricing, positioning and feature comparison.
- Public review/signal analysis where permitted and technically accessible.
- Market sizing and trend research where evidence supports it.
- SWOT and differentiation analysis.
- Opportunity/gap discovery.
- Source/date tracking and conflict resolution.
- Research reports with evidence trails.

## 10. Finance and accounting support
- Income, expense and payment categorization.
- Profit, margin, cash flow and budget analysis.
- Receivables, payables and overdue analysis.
- Unit economics and break-even analysis.
- Forecasts and scenario planning.
- Spreadsheet/CSV analysis and reconciliation.
- Financial dashboards and anomaly detection.
- Tax calculations only with current jurisdiction/source verification where applicable.
- Distinguish operational bookkeeping support from regulated professional advice.

## 11. CRM and business memory
- Clients, leads, deals, services, tasks, payments, documents, calendar events, notes and interactions.
- Search, create, update, link, summarize and audit records.
- Customer history and next-best-action suggestions.
- Automated document generation from CRM records.
- Pipeline, revenue and retention analytics.
- Personal CRM data remains external to model weights.

## 12. Documents and data
- DOCX, PDF, XLSX, CSV, HTML, Markdown and structured JSON workflows.
- Tables, formulas, charts and data cleaning.
- OCR/document extraction where supported.
- Template variables, validation, versioning and naming.
- Compare document versions and identify material changes.
- Produce print-ready and machine-readable outputs.

## 13. Research and global search
- Search planning and query decomposition.
- Multi-source research and source ranking.
- Official-source preference for legal/tax/financial/safety facts.
- Freshness/date validation.
- Cross-checking and contradiction handling.
- Structured extraction from long pages/documents.
- Research summaries with evidence and limitations.
- Never fabricate sources, search results, actions or current facts.

## 14. Phone / desktop operator
- Screen understanding and UI element identification.
- App/browser/file navigation.
- Tap, type, scroll, copy/paste, select, upload/download.
- Browser workflows and multi-step tasks.
- File operations and document handling.
- Email/calendar/message preparation and execution.
- Android permissions and service state awareness.
- Native Hands / TermuxMCP integration.
- Action planning, retries and post-action verification.
- Sensitive actions require explicit confirmation.
- A model response alone is never proof that an action occurred.

## 15. Tool calling and agents
- Tool selection and structured arguments.
- Multi-tool plans and dependency ordering.
- State tracking across steps.
- Error classification and recovery.
- Idempotency and duplicate-action prevention.
- Permission/policy checks before execution.
- Verification after execution.
- Human confirmation gates for consequential external actions.
- Clear distinction between simulated, prepared and executed actions.

## 16. Privacy, security and data governance
- Data classification and minimization.
- Redaction/tokenization before external model calls.
- Secret/credential protection.
- Provider routing based on privacy policy.
- Audit trails for external model/tool calls.
- No private CRM/customer data in training weights.
- No credentials or tokens in datasets.
- Distinguish local processing from external processing.
- User-visible disclosure of sensitive data routing where required.

## 17. Safety and reliability
- Detect ambiguous, contradictory or unsafe instructions.
- Refuse unsupported certainty rather than hallucinate.
- Protect against prompt injection in webpages/documents.
- Treat external content as untrusted data.
- Verify high-impact outputs.
- Maintain source provenance.
- Detect stale information.
- Avoid irreversible actions without confirmation.
- Recover safely after partial failures.

## 18. Business strategy
- Business model analysis.
- Service/product-market fit.
- Pricing strategy.
- Revenue diversification.
- Capacity and hiring/subcontracting considerations.
- Process automation opportunities.
- KPI/OKR design.
- Scenario and risk analysis.
- Growth planning.

## 19. Technical and AI competence
- Model/provider selection.
- Prompt and system-policy design.
- RAG architecture and retrieval evaluation.
- Embeddings, chunking and source freshness concepts.
- Agent orchestration and tool registries.
- Local/on-device inference concepts.
- LiteRT-LM/Gemma runtime concepts.
- Quantization/adapters/fine-tuning concepts.
- API integration, webhooks and automation.
- Debugging, logs, CI and runtime evidence.

## 20. Vision, audio and multimodal workflows
- Screenshot interpretation.
- UI state recognition.
- Document/image understanding.
- OCR-assisted workflows.
- Audio/transcript understanding where supported.
- Multimodal grounding for tool actions.
- Visual verification after phone actions.

## 21. Knowledge architecture
Model weights should learn reusable behavior, reasoning patterns, domain workflows, tool schemas, document structures and response style.

External knowledge/RAG should hold current laws, official guidance, market facts, vacancies, competitor information, provider documentation and other refreshable information.

Personal memory/CRM should remain outside model weights and be accessed only through authorized tools.

## 22. Training corpus design
The corpus must contain varied examples for every section, including:
- successful workflows;
- incomplete requests;
- conflicting requirements;
- realistic tool traces;
- tool failures;
- recovery;
- confirmation gates;
- verification;
- source citation behavior;
- privacy-sensitive routing;
- document generation;
- multilingual/current-source edge cases where relevant.

Do not stop at the existing 53-example seed. Treat it as a bootstrap corpus only.

## 23. Evaluation requirements
Every capability family must have held-out tests not present in training. Evaluation must separately measure:
- knowledge/answer quality;
- tool selection;
- argument correctness;
- confirmation behavior;
- source/evidence discipline;
- document completeness;
- refusal of fabricated execution;
- post-action verification;
- privacy handling;
- failure recovery.

A lower training loss is not sufficient evidence of capability.

## 24. Production gate
The model is not production-ready merely because SFT completes. Production readiness requires held-out capability results, real tool integration tests, runtime/device evidence for Hands, document-output validation, privacy/security tests and LiteRT-LM runtime validation.
