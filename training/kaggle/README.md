# Kaggle run: Svetlana v0.1

1. Open a Kaggle Notebook and enable GPU.
2. As of 2026-09-12, Kaggle states T4x2 is the replacement for P100, with two 16 GB GPUs; P100 is scheduled to retire on 2026-09-15.
3. Clone this repository and checkout `svetlana-self-employed-crm-foundation`.
4. Install current Unsloth using its current installation instructions rather than pinning an old release.
5. Select the base model only after checking the current Unsloth model-specific fine-tuning guide and the actual accelerator.
6. Train first on `training/datasets/svetlana_seed.jsonl` as a smoke test.
7. Do not claim the model is trained until a Kaggle run ID, logs and exported artifact are available.
8. For the next run, add the official NPD seed and a held-out evaluation set; never train on the held-out set.

Recommended first experiment: a small, reproducible SFT/LoRA run with fixed seed 3407, one training configuration, and an explicit artifact checksum. The purpose is to validate the pipeline before spending GPU time on a large corpus.

References:
- https://docs.unsloth.ai/basics/tutorial
- https://docs.unsloth.ai/get-started/installing-%2B-updating/pip-install
- https://www.kaggle.com/product-announcements/735239
