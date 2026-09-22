# Svetlana 2.0 — Architecture Contract

Status: PENDING implementation; this document is the normative target architecture.

## 1. Core
Svetlana is one universal AI core shared by three product environments: Мир Самозанятых, Marketplace/Atria, and Я‑Зарядка. Domain skills change context and tools; they do not create separate foundational identities.

## 2. Runtime layers
1. Client surface: Android, iOS, web/desktop and voice interfaces.
2. Session/context: account, project/tenant, locale, conversation state, current task and authorized memory.
3. Policy: authentication result, authorization, data classification, tool risk, confirmation policy and safety policy.
4. Planner: intent classification, decomposition, dependency ordering, budget/time limits and recovery strategy.
5. Skill router: selects universal or domain skill modules.
6. Tool registry: provider-neutral capability registry. Providers may be MCP, REST/API, local function, browser/computer-use, Android/Hands or another transport.
7. Execution: structured tool call, result capture and idempotency protection.
8. Verification: independent evidence that the expected state or artifact exists.
9. Response: report what was prepared, executed, verified or remains unproven.

## 3. Identity and authorization
Canonical flow: Account → Authentication → Authorization → Project/Tenant Context → Svetlana.
Roles: CLIENT, ADMIN, SYSTEM.
Device identity is not authorization. Never infer ADMIN from device, voice, face or model judgment.
Sensitive operations require step-up authentication and/or explicit confirmation according to policy.

## 4. Knowledge plane
Knowledge is divided into: stable model behavior, external current knowledge, project context, personal memory/CRM, and private secrets.
Model weights may contain reusable concepts, procedures, schemas and behavior patterns. They must not contain customer records, credentials, tokens, mutable inventory, private CRM histories or frozen assumptions that are expected to be current.
Current legal, tax, market, vacancy, competitor and provider facts come from controlled retrieval/search/tools with provenance and freshness.

## 5. Skill contract
Every skill defines: skill_id, purpose, prerequisites, allowed contexts, tool dependencies, risk level, confirmation rules, output contract, verification contract, training coverage, evaluation coverage and owner/status.
Core skills are cross-domain. Domain skills are explicitly scoped. Admin skills are isolated.

## 6. Tool contract
Every tool defines: capability_id, provider, input schema, permissions, data classification, risk level, confirmation requirement, idempotency behavior, execution output, verification method, provenance/version and availability state.
The model may select a capability, but authorization/policy remains outside the model.
MCP is an internal optional transport. Clients must not need to know that MCP exists.

## 7. Universal execution state
Every operation has one of: PLANNED, PREPARING, CONFIRMATION_REQUIRED, EXECUTING, EXECUTED_UNVERIFIED, VERIFIED, FAILED, BLOCKED, UNKNOWN_STATE.
UNKNOWN_STATE is used when an error occurs after an operation may already have happened.
The assistant must never convert a tool response or model text directly into VERIFIED without evidence.

## 8. Domain environments
### Self-employed
Clients, requests, tasks, CRM, documents, contracts, invoices, payments, tax/accounting support, calendar, jobs, research and site/security audit.
### Marketplace
Catalog, products, sellers, buyers, orders, pricing, reviews, SEO, competitor intelligence, advertising, analytics, media and presentation workflows.
### Я‑Зарядка
Child-safe conversation, education/games, voice/TTS, avatar state, tightly constrained tools and stricter content/privacy policy.
### Admin
Identity/authorization management, model/provider configuration, datasets, RAG governance, tool governance, evaluations, deployment, diagnostics and audit.

## 9. Training boundary
Training teaches transferable behavior: reasoning, planning, tool use, evidence discipline, confirmation, recovery, privacy and domain workflows.
Training does not store mutable business facts or personal records as memory.

## 10. Evidence contract
Use the vocabulary VERIFIED / NOT PROVEN / PENDING.
Static/code evidence and runtime evidence are separate.
For external/device actions, target the chain: code → CI → artifact → real environment/device → tool call → real action → independent verification.
Tests added to the repository do not by themselves prove runtime success.

## 11. Capability discovery
Continuous discovery is a first-class pipeline: discover → inspect source → inspect license → assess maintenance → map capabilities → security/privacy review → integrate/adapt/wrap/learn-only decision → record evidence.
Chinese and other global ecosystems are included; README-only adoption is not permitted.

## 12. Build order
Architecture contract → knowledge skeleton → coverage matrix → training expansion → held-out evaluation → real GPU training → adapter evaluation → runtime conversion → product integration → end-to-end verification.

## 13. Non-goals
No client-facing MCP dependency; no device-bound admin identity; no private-data training; no claim of execution without runtime evidence; no automatic integration of external projects without source/license/security review.