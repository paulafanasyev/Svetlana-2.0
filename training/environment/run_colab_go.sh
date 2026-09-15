#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${SVETLANA_OUTPUT_DIR:-training/outputs/colab_go}"
MIN_BASELINE="${SVETLANA_MIN_BASELINE_PASS_RATE:-0.75}"
mkdir -p "$OUT"

python -m pip install --upgrade pip
python -m pip install -r training/environment/requirements-colab-gpu.txt

python - <<'PY'
import importlib, json, platform, sys
import torch
for name in ['transformers', 'trl', 'unsloth', 'datasets', 'accelerate', 'peft']:
    importlib.import_module(name)
if not torch.cuda.is_available():
    raise SystemExit('CUDA is required; stopping before baseline/training')
print(json.dumps({'event':'environment_pass','python':platform.python_version(),'cuda':torch.version.cuda,'gpu':torch.cuda.get_device_name(0),'vram_gb':round(torch.cuda.get_device_properties(0).total_memory/1024**3,2)}))
PY

python training/validate_training.py --root .
python training/gemma4/generate_predictions.py --model google/gemma-4-E2B-it --eval training/datasets/svetlana_eval.jsonl --output "$OUT/baseline_predictions.jsonl"
python training/evaluation/run_structured_eval.py --eval training/datasets/svetlana_eval.jsonl --predictions "$OUT/baseline_predictions.jsonl" --output "$OUT/baseline_report.json" --label baseline
python training/gemma4/train_svetlana_smoke.py
ADAPTER="training/outputs/svetlana_gemma4_e2b_smoke/adapter"
python training/gemma4/generate_predictions.py --model "$ADAPTER" --eval training/datasets/svetlana_eval.jsonl --output "$OUT/adapter_predictions.jsonl"
python training/evaluation/run_structured_eval.py --eval training/datasets/svetlana_eval.jsonl --predictions "$OUT/adapter_predictions.jsonl" --output "$OUT/adapter_report.json" --label adapter
python training/evaluation/compare_reports.py --baseline "$OUT/baseline_report.json" --adapter "$OUT/adapter_report.json" --output "$OUT/baseline_vs_adapter.json" --min-baseline "$MIN_BASELINE"
cp training/outputs/svetlana_gemma4_e2b_smoke/training_evidence.json "$OUT/training_evidence.json"
printf '%s\n' 'COLAB_GO_GATE=PASS'
