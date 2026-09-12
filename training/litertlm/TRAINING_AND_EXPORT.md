# Svetlana training + LiteRT-LM export gates

## Rule
LiteRT-LM does not replace training. Svetlana must first be trained/evaluated as a domain assistant, then the resulting model/adapter must be validated for an edge-runtime conversion path.

## Training pipeline
1. Validate `training/datasets/svetlana_seed.jsonl`.
2. Keep `training/datasets/svetlana_eval.jsonl` held out from training.
3. Run baseline evaluation before fine-tuning.
4. Run SFT + LoRA on the selected base model.
5. Evaluate CRM behavior, official-source/legal verification, confirmation policy, document/calendar behavior, missing-data handling and privacy.
6. Save the adapter as a build artifact; never commit model weights into Git.
7. Compare trained model against baseline on the held-out eval set.

## Edge path
1. Validate LiteRT-LM runtime >= 0.16.0.
2. Validate an official `.litertlm` model by SHA-256.
3. Run CPU inference first.
4. Run GPU inference only with the GPU-compatible artifact/runtime.
5. Record runtime version, model SHA, backend, latency, throughput and memory.
6. Run three-turn dialogue and tool declaration/denial tests.
7. Only after the published model passes do we attempt conversion of a trained Svetlana model/adapter.

## Important constraint
A Hugging Face LoRA adapter is **not assumed** to be directly loadable by LiteRT-LM. Conversion/export must be demonstrated by an actual artifact and an actual inference run.

## Evidence states
- VERIFIED: source code/config or successful CI validation.
- NOT PROVEN: requires actual model training, conversion, Android inference or device evidence.
- PENDING: next execution gate.
