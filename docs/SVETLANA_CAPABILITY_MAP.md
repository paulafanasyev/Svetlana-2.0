# Svetlana 2.0 — Capability Map

## Purpose
Svetlana is a general-purpose AI operator for self-employed workers, freelancers and small businesses. She combines Gemma reasoning/behavior with external knowledge, research, CRM data, document generation and verified tools. This document defines the target capability surface; it is not a claim that every capability is currently implemented.

## Evidence rule
Each capability is tracked as VERIFIED, NOT PROVEN, or PENDING. Model knowledge must not be confused with live tool access. Current legal/tax facts require source + verification date. Personal CRM data must never be baked into model weights.

## A. Core intelligence
- Russian-language instruction following, dialogue, summarization, rewriting and extraction.
- Reasoning, planning, classification, arithmetic and structured output.
- Multimodal understanding of documents, images, screenshots and supported audio.
- Programming and technical assistance.
- Long-form analysis and report generation.

## B. Self-employed / freelancer operations
- NPD/self-employed workflow, registration concepts, tax and receipt workflows.
- Freelancer workflow from finding work to delivery, invoicing and follow-up.
- Pricing, packaging, workload planning and income planning.
- Client management, deadlines, documents, payments and recurring work.
- Practical checklists and explanations for starting and operating independently.

## C. Legal and compliance knowledge
- Current official tax/legal knowledge through a refreshable knowledge layer.
- Contract selection and drafting patterns.
- Risk flags, missing clauses and questions to clarify.
- Source-aware answers that distinguish current verified law from model knowledge.
- No legal certainty claims without appropriate current sources.

## D. Documents and contracts
Generate, edit, compare and explain:
- service agreements;
- contractor/work agreements;
- software development agreements;
- design/marketing/consulting/education agreements;
- agency/commission/supply/rental agreements where applicable;
- NDA and confidentiality documents;
- license and author-order patterns;
- offers and public offers;
- statements of work/specifications;
- acts, invoices and payment documents;
- claims, notices, letters and additional agreements;
- commercial proposals, reports and business plans;
- resumes and cover letters.

Output targets: structured text, Markdown, HTML, DOCX/PDF generation pipelines, and machine-readable JSON where a tool requires it. Documents must support templates, variables, validation and versioning.

## E. Sales and commercial proposals
- ICP/target customer definition.
- Lead qualification and segmentation.
- Prospect discovery by category, geography and other explicit criteria.
- Personalized commercial proposals.
- Pricing options, packages and value propositions.
- Objection handling and follow-up.
- Sales funnel management and conversion analysis.
- Proposal generation from CRM data.

## F. Marketing
- Positioning, ICP, segmentation and offer design.
- USP/value proposition development.
- Content plans, SEO, social, email and advertising concepts.
- Funnel design and experiments.
- KPI analysis: conversion, CPL/CPA, CAC, LTV, ROI/ROMI and retention.
- Campaign analysis and actionable recommendations.

## G. Competitor research
- Discover competitors from public sources.
- Categorize and compare competitors.
- Compare products/services, positioning, public pricing and messaging.
- Analyze public reviews/signals where legally and technically accessible.
- Identify gaps and differentiation opportunities.
- Produce sourced comparison tables and research reports.

## H. Research and global search
- Decompose a research question into subqueries.
- Search multiple sources.
- Extract and normalize evidence.
- Compare conflicting information.
- Prefer authoritative/current sources for legal, tax, financial and safety-sensitive claims.
- Produce a concise answer plus evidence/source trail.
- Never fabricate search results, sources or current facts.

## I. Finance, accounting and analytics
- Income/expense/payment tracking through tools.
- Profit, margin, cash-flow and budget analysis.
- Receivables and overdue-payment analysis.
- Financial summaries and forecasts.
- Spreadsheet/CSV analysis.
- KPI dashboards and anomaly detection.
- Accounting assistance must distinguish bookkeeping support from regulated professional advice.

## J. Jobs and freelancing
- Search jobs and freelance opportunities.
- Filter by role, skills, geography, remote status, rate and other criteria.
- Assess fit and risks.
- Build and maintain resumes/CVs.
- Tailor resume to a specific vacancy.
- Create ATS-friendly variants.
- Create cover letters and application messages.
- Prepare portfolio/profile text.
- Track applications in CRM.
- Prepare an application for review and require confirmation before submission.

## K. CRM
Entities: clients, leads, deals, services, tasks, payments, documents, calendar events, notes and interactions.

Capabilities:
- create/read/update/search records;
- link records;
- summarize client history;
- identify overdue work/payments;
- recommend next actions;
- generate documents from CRM data;
- maintain audit trails.

## L. Phone and computer operation
Target loop:
Svetlana -> Planner -> Policy -> Tool Registry -> Hands -> Android/Desktop -> Verification -> Svetlana.

Capabilities include reading the current screen, locating controls, tapping, typing, copying/pasting, opening apps/files/browser pages, downloading/uploading files, preparing messages/emails, calendar operations and multi-step workflows. Sensitive external actions require explicit confirmation. Runtime capability must be proven through code -> CI -> APK/runtime -> device -> tool call -> real action evidence.

## M. Privacy and security
- Minimize data sent to external models.
- Classify sensitive data before routing.
- Redact/tokenize where possible.
- Keep personal CRM data outside model weights.
- Audit external-provider calls.
- Provide user-visible confirmation for sensitive actions.
- Support provider/model policies and local processing where available.
- Never expose credentials, tokens or private records in training data.

## N. Architecture
Model weights: behavior, reasoning patterns, tool calling, domain style and reusable document patterns.

Knowledge/RAG: current laws, official guidance, market information, job listings, competitor research and other refreshable knowledge.

Personal data/CRM: user-specific clients, payments, tasks, documents and history.

Tools: web/research, CRM, files, calendar, document generation, analytics and phone/desktop Hands.

Policy/verification: permissions, confirmations, validation and post-action verification.

## O. Training strategy
Do not attempt to memorize all current laws, competitors, jobs or private customer data in weights. Train reusable behavior and domain reasoning. Use held-out evaluation that covers every capability family. Use synthetic tool traces and synthetic CRM records for tool-calling training. Keep legal/current-source corpora refreshable.

## P. Capability status
The current 10-example smoke dataset and 8-case held-out evaluation are insufficient to represent this map. The next milestone is a structured capability dataset and a 100+ case evaluation suite covering core intelligence, self-employed/freelancer operations, legal verification, documents/contracts, sales, marketing, competitor research, finance/analytics, jobs/resumes, CRM, research, tools, phone operation and privacy.
