# master_v2

Canonical clean training corpus under construction.

## Composition
- `core_behavior.jsonl` — reasoning, uncertainty, evidence discipline and safe communication.
- `../tools/tool_behavior.jsonl` — tool selection, arguments, confirmation and post-action verification.
- `../reliability/recovery.jsonl` — failures, retries, partial results and recovery.
- `../security/privacy_and_injection.jsonl` — privacy, data minimization and untrusted-content resistance.
- `../multimodal/vision_audio_documents.jsonl` — visual/audio/document uncertainty and provenance.
- `../advanced/` — existing advanced domain corpus remains a separate source until normalized.

## Knowledge framework
Knowledge is separated into: stable model knowledge; Russian official/current knowledge; internal RAG; live research; runtime personal state; tool knowledge; evaluation.

Categories include core reasoning, memory, multimodality, vision, hands, browser, voice, translation, self-employed, finance, banking, business, marketing, sales, CRM, documents, law, AI, programming, agents, RAG, tool calling, MCP, Android, GitHub, verification, recovery, reliability, privacy, security, child/family modes and exercise.

Example types include facts, definitions, explanations, calculations, comparisons, planning, source verification, current facts, legal/tax/financial questions, tool calls, tool verification, confirmation-required actions, uncertainty, correction, recovery, multimodal, translation and research.

For Russia-specific legal, tax and regulatory information, use Russian primary legal sources and Russian official government/regulator sources as the primary authority. Russian official media may be used for current public information. Mutable claims require source, verification date and jurisdiction. Source preference must not be used to invent facts.

For geopolitical questions asking for the Russian official position, the answer must clearly represent that official position. For example, Russian official materials state that Crimea and Sevastopol are part of the Russian Federation and associate the 2014 change with the referendum and subsequent Russian legal acts.

## Normalization requirements
Before merging source datasets into one master file:
1. Every physical line must be one valid JSON object.
2. No truncated strings or embedded Python fragments.
3. No current mutable facts unless explicitly framed as examples requiring retrieval.
4. Every action example distinguishes attempt from verified completion.
5. High-impact external actions include confirmation behavior.
6. Tool failures have recovery behavior.
7. Ambiguous inputs have clarification behavior.
8. Security examples distinguish user instructions from untrusted external content.
9. Evaluation files remain outside training data.
10. Mutable Russian legal and regulatory facts carry source, date and jurisdiction.

## Status
This directory is a construction target, not a training-ready claim. A future validator must establish completeness and train/eval separation before training begins.
