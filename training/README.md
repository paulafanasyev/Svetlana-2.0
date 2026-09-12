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
Unsloth currently supports Qwen3.5 fine-tuning and publishes model-specific guidance. Current Qwen3.5 guidance recommends bf16/16-bit LoRA and explicitly says 4-bit QLoRA is not recommended because of quantization differences. We therefore do not reuse the older hard-coded QLoRA recipe. The smoke script detects CUDA hardware and defaults to `unsloth/Qwen3.5-0.8B` with a short run. The base model can be overridden after verifying the actual accelerator. Unsloth also publishes free-GPU notebooks for Qwen3.5 0.8B/2B/4B. cite-source: https://unsloth.ai/docs/models/qwen3.5/fine-tune

Kaggle currently provides free notebook GPU access; Kaggle has announced that P100 availability ends on **2026-09-15** and recommends T4x2, with two 16 GB GPUs, as the replacement accelerator. We therefore do not hard-code a P100-only recipe.

## Smoke run
From a GPU notebook:
```bash
pip install --upgrade --force-reinstall --no-cache-dir unsloth unsloth_zoo
python training/kaggle/train_svetlana_smoke.py
```
The script records GPU/VRAM and exports a LoRA adapter under `training/outputs/svetlana_smoke/adapter`. A smoke run is only a pipeline check; it is not evidence of production model quality.

## Current official knowledge seed
The first legal/tax corpus should prioritize current FNS pages and official legislation. As of the source check on 2026-09-12, FNS's NPD page was updated 2026-09-10 and states the current NPD rates, payment procedure and reporting rules; Federal Law 422-FZ is available through the official publication portal. These source records are kept with verification dates so the knowledge layer can be refreshed without retraining the model.

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
- Current Qwen3.5 training recipe: VERIFIED against current Unsloth guidance.
- Smoke training run: PENDING actual GPU execution.
- Fine-tuned model quality: NOT PROVEN.
