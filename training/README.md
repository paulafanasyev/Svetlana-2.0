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
1. Baseline evaluation.
2. SFT for Svetlana behavior and domain reasoning.
3. Tool-calling fine-tuning with synthetic validated traces.
4. Expanded held-out evaluation.
5. Adapter/model export.
6. LiteRT-LM runtime validation and separate phone/tool validation.

## Compute
The active pipeline uses `training/gemma4/train_svetlana_smoke.py` with `google/gemma-4-E2B-it`, SFT+LoRA+4bit and a real CUDA GPU. The current Colab/T4 path is development infrastructure, not a production-quality claim.

## Data rules
No real user data, credentials or private documents. Legal/tax facts require source and verification date. Tool records are synthetic. Evaluation data stays separate. Current laws, competitors, jobs and other changing facts belong in refreshable knowledge/research layers rather than only in model weights.

## Acceptance
Do not call a run successful merely because loss decreased. Record configuration, model revision, dataset revision/hash, per-domain evaluation, tool-call validity, hallucination/error cases, export checksum and runtime compatibility.

Status vocabulary: VERIFIED / NOT PROVEN / PENDING.

## Current status
- Capability map: VERIFIED.
- Expanded capability seed: VERIFIED.
- 120-case target evaluation matrix: VERIFIED; execution PENDING.
- Real GPU training: VERIFIED for the previous 10-example seed run; expanded-dataset run PENDING.
- Expanded held-out quality: NOT PROVEN.
- Fine-tuned adapter -> LiteRT-LM: NOT PROVEN.
- Native phone Hands: separate runtime gate; NOT PROVEN by this training pipeline.
