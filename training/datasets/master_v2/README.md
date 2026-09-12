# master_v2

Canonical clean training corpus under construction.

## Composition
- `core_behavior.jsonl` — reasoning, uncertainty, evidence discipline and safe communication.
- `../tools/tool_behavior.jsonl` — tool selection, arguments, confirmation and post-action verification.
- `../reliability/recovery.jsonl` — failures, retries, partial results and recovery.
- `../security/privacy_and_injection.jsonl` — privacy, data minimization and untrusted-content resistance.
- `../multimodal/vision_audio_documents.jsonl` — visual/audio/document uncertainty and provenance.
- `../advanced/` — existing advanced domain corpus remains a separate source until normalized.

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

## Status
This directory is a construction target, not a training-ready claim. A future validator must establish completeness and train/eval separation before training begins.
