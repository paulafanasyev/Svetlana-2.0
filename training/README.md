# Svetlana 2.0 training pipeline

## Corpus contract
Training corpus != current knowledge.

Stable concepts, reasoning patterns, capability behavior, safety, tool-use discipline, recovery and verification may be trained. Time-sensitive facts must be retrieved from current authoritative sources and verified at runtime.

## Evidence states
- VERIFIED: directly supported by an observed or authoritative result.
- NOT_VERIFIED: action or fact has not been sufficiently confirmed.
- UNKNOWN: insufficient information to determine truth.
- ATTEMPTED: an action was requested or initiated, but completion is not proven.
- COMPLETED: completion is supported by an appropriate observation or tool result.

Never transform NOT_VERIFIED or ATTEMPTED into COMPLETED by inference.

## Dataset layout
- `datasets/svetlana_seed.jsonl` — initial behavior/tool seed
- `datasets/svetlana_capability_seed.jsonl` — expanded capability seed
- `datasets/svetlana_advanced_training_v1.jsonl` — expanded advanced corpus
- `datasets/master_v2/` — canonical clean master corpus under construction
- `datasets/reliability/` — errors, recovery and uncertainty
- `datasets/security/` — privacy, injection and policy
- `datasets/tools/` — tool selection, arguments, confirmation and verification
- `datasets/multimodal/` — vision, audio and document interpretation
- `evaluation/` — held-out, adversarial, hallucination and runtime gates; never used for training

The legacy `svetlana_master_training_v1.jsonl` is quarantined until independently repaired and validated.

## Required capability families
1. Reasoning and decomposition
2. Uncertainty and clarification
3. Current-information retrieval
4. Tool selection and argument construction
5. Confirmation policy
6. Verification and evidence handling
7. Failure recovery
8. Privacy and security
9. Prompt-injection resistance
10. Multimodal interpretation
11. User communication and provenance
12. Hallucinated-execution resistance

## Dynamic-information policy
Taxes, laws, prices, vacancies, competitors, market metrics, service limits, current APIs, news and other mutable facts are runtime knowledge. Training should teach Svetlana how to identify the need for retrieval, select authoritative sources, compare dates, state assumptions and report provenance.

## Data rules
No real user data, credentials or private documents. Legal/tax facts require source and verification date. Tool records are synthetic. Evaluation data stays separate. Current laws, competitors, jobs and other changing facts belong in refreshable knowledge/research layers rather than only in model weights.

## Training gate
Do not start model training until corpus validation confirms: valid JSONL, no accidental truncation, no prohibited train/eval overlap, adequate negative examples, uncertainty coverage, tool-call coverage, confirmation coverage, verification coverage and security/adversarial coverage.

## Training stages
1. Baseline evaluation.
2. SFT for Svetlana behavior and domain reasoning.
3. Tool-calling fine-tuning with synthetic validated traces.
4. Expanded held-out evaluation.
5. Adapter/model export.
6. LiteRT-LM runtime validation and separate phone/tool validation.

## Compute
The active pipeline uses `training/gemma4/train_svetlana_smoke.py` with `google/gemma-4-E2B-it`, SFT+LoRA+4bit and a real CUDA GPU. The current Colab/T4 path is development infrastructure, not a production-quality claim. **Do not run this script during corpus construction.**

## Acceptance
Do not call a run successful merely because loss decreased. Record configuration, model revision, dataset revision/hash, per-domain evaluation, tool-call validity, hallucination/error cases, export checksum and runtime compatibility.

Status vocabulary: VERIFIED / NOT PROVEN / PENDING.

## Current status
- Capability map: VERIFIED.
- Expanded capability seed: VERIFIED.
- Advanced corpus: VERIFIED present on `knowledge-expansion-2026-09`.
- Clean master_v2: IN PROGRESS.
- 32-direction held-out matrix: NOT READY.
- Expanded held-out quality: NOT PROVEN.
- Fine-tuned adapter -> LiteRT-LM: NOT PROVEN.
- Native phone Hands: separate runtime gate; NOT PROVEN by this training pipeline.
- GPU/Colab training: NOT RUN in this corpus-construction phase.
