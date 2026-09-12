# Svetlana training pipeline

## v0.1 goal
Train domain behavior without embedding private customer data or assuming that model weights contain current legislation.

## Dataset layout
- `datasets/svetlana_seed.jsonl` — initial behavior/tool seed
- `datasets/self_employed/` — NPD and practical scenarios
- `datasets/documents/` — document-generation patterns
- `datasets/tool_calling/` — structured tool selection and arguments
- `datasets/agent/` — planning, policy and verification behavior
- `evaluation/` — held-out tests; never used for training

## Training stages
1. Baseline evaluation of the selected base model.
2. Supervised fine-tuning for Svetlana behavior and domain reasoning.
3. Tool-calling fine-tuning using synthetic, validated tool traces.
4. Evaluation against the held-out set.
5. Export adapter/model for inference.

## Unsloth / compute
The active smoke pipeline uses `training/gemma4/train_svetlana_smoke.py`. It requires a real CUDA GPU and fails closed when CUDA is unavailable. The current target is `google/gemma-4-E2B-it` with SFT+LoRA+4bit.

## Smoke run
From a GPU environment:
```bash
pip install --upgrade --force-reinstall --no-cache-dir unsloth unsloth_zoo
python training/gemma4/train_svetlana_smoke.py
```
The script records GPU/VRAM and exports a LoRA adapter under `training/outputs/svetlana_gemma4_e2b_smoke/adapter`. A smoke run is only a pipeline check; it is not evidence of production model quality.

## Current official knowledge seed
The first legal/tax corpus should prioritize current FNS pages and official legislation. Source records are kept with verification dates so the knowledge layer can be refreshed without retraining the model.

## Data quality rules
- No real user personal data.
- No API keys, passwords, tokens or private documents.
- Every legal/tax fact in the knowledge corpus carries source and verification date.
- Tool examples use synthetic IDs and records.
- Evaluation data is isolated from training data.
- Archived/undated material must not silently override a newer official source.

## Acceptance gates
A training run is not called successful merely because loss decreased. Record:
- training configuration;
- base model revision;
- dataset revision/hash;
- evaluation score;
- tool-call validity;
- hallucination/error cases;
- export artifact checksum.

Status vocabulary: VERIFIED / NOT PROVEN / PENDING.

## Current status
- Foundation branch: VERIFIED.
- Seed dataset: VERIFIED.
- Held-out evaluation set: VERIFIED.
- Kaggle training path: REMOVED.
- Real GPU training: NOT PROVEN until a CUDA-backed run produces the required training and export markers.
