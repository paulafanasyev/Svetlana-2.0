# Svetlana GPU smoke training: Google Colab + Gemma 4 E2B

The training smoke path now uses Google's `google/gemma-4-E2B-it` with 4-bit LoRA. The current free execution environment is Google Colab with a Tesla T4.

## Run

1. Open Google Colab and attach a GPU runtime.
2. Clone `paulafanasyev/Svetlana-2.0` branch `gpu-training-auto-run`.
3. Install current Unsloth.
4. Run `training/kaggle/train_svetlana_smoke.py`.
5. The script must print real hardware/model/training/export events.
6. Do not call the model trained until the run reaches `train_complete` and `export_complete` and the adapter files are inspected and checksummed.

## Model

- Base: `google/gemma-4-E2B-it`
- Training: SFT + LoRA
- T4 mode: 4-bit base weights + LoRA, batch size 1, gradient accumulation 4
- Smoke dataset: `training/datasets/svetlana_seed.jsonl`
- Held-out evaluation: `training/datasets/svetlana_eval.jsonl` is never used for training
- Official NPD data remains separate and can be added to a later training run

## Edge target

LiteRT-LM is the Google on-device runtime track. A successful LoRA adapter is **not** automatically a LiteRT-LM model. Conversion must be demonstrated with an actual artifact and an actual inference run.

## Evidence rule

- VERIFIED: code/config or successful CI validation.
- NOT PROVEN: actual model training, adapter quality, LiteRT-LM conversion or Android inference until logs/artifacts exist.
- Never commit trained model weights into Git.
