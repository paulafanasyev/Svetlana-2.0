# Svetlana training pipeline

The target capability surface is defined in `docs/SVETLANA_CAPABILITY_MAP.md`. It covers self-employed/freelancer operations, legal/tax verification, contracts and documents, sales, commercial proposals, marketing, competitor research, finance/accounting/analytics, jobs/resumes, CRM, global research, phone/computer operation and privacy.

## Dataset layout
- `datasets/svetlana_seed.jsonl` — initial behavior/tool seed
- `datasets/svetlana_capability_seed.jsonl` — expanded synthetic capability seed
- `datasets/self_employed/` — NPD and practical scenarios
- `datasets/documents/` — document-generation patterns
- `datasets/tool_calling/` — structured tool selection and arguments
- `datasets/agent/` — planning, policy and verification behavior
- `evaluation/` — held-out tests; never used for training

## Training stages
1. Baseline evaluation (diagnostic; never blocks the start of SFT).
2. Production SFT for Svetlana behavior and domain reasoning.
3. Tool-calling fine-tuning with synthetic validated traces when that corpus is explicitly included in the active manifest.
4. Expanded held-out evaluation.
5. Adapter/model export.
6. LiteRT-LM runtime validation and separate phone/tool validation.

## Compute
The active manifest authorizes `training/gemma4/train_svetlana_production.py` with `google/gemma-4-E2B-it`, LoRA+4bit and a real CUDA GPU. `train_svetlana_smoke.py` remains an explicit fallback only when the manifest selects `text_smoke`. The Colab/T4 path is execution infrastructure; a completed training run is accepted only after adapter/evaluation evidence is produced.

## Data rules
No real user data, credentials or private documents. Legal/tax facts require source and verification date. Tool records are synthetic. Evaluation data stays separate. Current laws, competitors, jobs and other changing facts belong in refreshable knowledge/research layers rather than only in model weights.

## Acceptance
Do not call a run successful merely because loss decreased. A valid run must produce resumable checkpoints during SFT, a non-empty adapter at `training/gemma4/outputs/svetlana_gemma4_e2b_production/adapter`, training evidence, baseline/adapter predictions, and an evaluation comparison. Tool-call quality remains a separate requirement when its held-out corpus is available.

Status vocabulary: VERIFIED / NOT PROVEN / PENDING.

## Current status
- Capability map: VERIFIED.
- Expanded capability seed: VERIFIED.
- 120-case target evaluation matrix: VERIFIED; execution PENDING.
- Production training pipeline: CODE FIXED; fresh expanded-dataset GPU execution PENDING.
- Expanded held-out quality: NOT PROVEN.
- Fine-tuned adapter -> LiteRT-LM: NOT PROVEN.
- Native phone Hands: separate runtime gate; NOT PROVEN by this training pipeline.
