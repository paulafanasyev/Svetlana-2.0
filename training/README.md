# Svetlana training pipeline

## v0.1 goal
Train domain behavior without embedding private customer data or assuming that model weights contain current legislation.

## Dataset layout
- `datasets/svetlana_seed.jsonl` — initial seed examples
- `datasets/self_employed/` — NPD and practical scenarios
- `datasets/documents/` — document generation patterns
- `datasets/tool_calling/` — structured tool selection and arguments
- `datasets/agent/` — planning, policy and verification behavior
- `evaluation/` — held-out tests; never used for training

## Training stages
1. Baseline evaluation of the selected base model.
2. Supervised fine-tuning for Svetlana behavior and domain reasoning.
3. Tool-calling fine-tuning using synthetic, validated tool traces.
4. Evaluation against the held-out set.
5. Export adapter/model for inference.

## Unsloth
Use the current Unsloth documentation and model-specific notebook for the selected base model. Do not hard-code a QLoRA recipe until the chosen model and available GPU are verified.

## Data quality rules
- No real user personal data.
- No API keys, passwords, tokens or private documents.
- Every legal/tax fact in the knowledge corpus carries source and verification date.
- Tool examples use synthetic IDs and records.
- Evaluation data is isolated from training data.

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