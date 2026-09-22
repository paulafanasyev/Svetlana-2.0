# Svetlana GPU training: Google Gemma 4 E2B + Colab

The active GPU training path uses Google's `google/gemma-4-E2B-it` with 4-bit LoRA on a real CUDA GPU. Google Colab/T4 is the current execution target.

## Run

1. Open Google Colab and attach a GPU runtime.
2. Clone `paulafanasyev/Svetlana-2.0`, branch `chore/training-acceptance-hardening-v2`.
3. Run `training/environment/run_colab_go.sh`. It installs the repository's exact pinned environment, validates the full manifest/corpus, measures a baseline, runs the authorized production trainer, exports the adapter, evaluates the adapter, and compares baseline vs adapter.
4. Do not call the model trained until `COLAB_GO_GATE=PASS`, `training_evidence.json`, the exported adapter, and baseline/adapter evaluation artifacts are present.

For an interrupted production run, set `SVETLANA_RESUME_FROM` to a valid Trainer checkpoint path before rerunning the production runner. The runner and Colab GO script preserve the resumable-checkpoint path; a partial run is never treated as completed evidence.

## Model

- Base: `google/gemma-4-E2B-it`
- Training: SFT + LoRA
- T4 mode: 4-bit base weights + LoRA, batch size 1, gradient accumulation 4
- Active training corpus: all files listed in `training/datasets/manifest_v2.json`
- Held-out evaluation: `training/datasets/svetlana_eval.jsonl` is never used for training
- Official-source knowledge remains separate from behavior-training weights

## Environment

Use only `training/environment/requirements-colab-gpu.txt`. The current pins are intentionally aligned as a single tested environment specification; do not install a newer Transformers/TRL/Unsloth combination ad hoc.

The repository validates package pins and CUDA before any model work. The current production runner also validates the training corpus before loading the 10.2 GB base checkpoint.

## Acceptance gates

A valid production run must produce:
- the configured final optimizer step exactly;
- resumable checkpoints during SFT;
- a non-empty adapter;
- training evidence with dataset and adapter hashes;
- baseline and adapter predictions;
- a structured evaluation comparison.

A lower or higher training loss by itself is not an acceptance proof. Human review remains required for behavioral quality.

## Edge target

LiteRT-LM is the Google on-device runtime. A successful LoRA adapter is **not** automatically a LiteRT-LM model; conversion must be demonstrated with an actual artifact and inference run.

## Evidence rule

- VERIFIED: code/config or successful CI validation.
- NOT PROVEN: actual model training, adapter quality, LiteRT-LM conversion or Android inference until logs/artifacts exist.
- Never commit trained model weights into Git.
