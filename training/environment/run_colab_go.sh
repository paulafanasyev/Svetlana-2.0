#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT\${PYTHONPATH:+:$PYTHONPATH}"
OUT="\${SVETLANA_OUTPUT_DIR:-training/outputs/colab_go}"
MIN_BASELINE="\${SVETLANA_MIN_BASELINE_PASS_RATE:-0.0}"
MAX_NEW_TOKENS="\${SVETLANA_MAX_NEW_TOKENS:-160}"
mkdir -p "$OUT"

python -m pip install --upgrade pip
python -m pip install -r training/environment/requirements-colab-gpu.txt

python - <<'PY'
import importlib, json, platform
import unsloth, torch
for name in ['transformers','trl','datasets','accelerate','peft']: importlib.import_module(name)
if not torch.cuda.is_available(): raise SystemExit('CUDA is required; stopping before baseline/training')
print(json.dumps({'event':'environment_pass','python':platform.python_version(),'cuda':torch.version.cuda,'gpu':torch.cuda.get_device_name(0),'vram_gb':round(torch.cuda.get_device_properties(0).total_memory/1024**3,2)}))
PY

python training/validate_training.py --root .
python training/evaluation/audit_action_corpus.py
python training/gemma4/tokenizer_preflight.py --model google/gemma-4-E2B-it --max-length 2048
python training/datasets/multimodal/generate_synthetic_images.py
python training/datasets/multimodal/validate_image_corpus.py training/datasets/multimodal/image_training_records.jsonl

python training/gemma4/generate_predictions.py --model google/gemma-4-E2B-it --eval training/datasets/svetlana_eval.jsonl --output "$OUT/baseline_predictions.jsonl" --max-new-tokens "$MAX_NEW_TOKENS" --metadata-output "$OUT/baseline_predictions.metadata.json"
test -s "$OUT/baseline_predictions.metadata.json"
python training/evaluation/run_structured_eval.py --eval training/datasets/svetlana_eval.jsonl --predictions "$OUT/baseline_predictions.jsonl" --output "$OUT/baseline_report.json" --label baseline
python training/gemma4/generate_predictions.py --model google/gemma-4-E2B-it --eval training/datasets/svetlana_action_eval_v1.jsonl --output "$OUT/baseline_action_predictions.jsonl" --max-new-tokens "$MAX_NEW_TOKENS" --metadata-output "$OUT/baseline_action_predictions.metadata.json"
python training/evaluation/run_action_eval.py --eval training/datasets/svetlana_action_eval_v1.jsonl --predictions "$OUT/baseline_action_predictions.jsonl" --output "$OUT/baseline_action_report.json"

python - "$OUT/baseline_report.json" "$MIN_BASELINE" <<'PY'
import json,sys
from pathlib import Path
r=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')); m=float(sys.argv[2])
print(json.dumps({"event":"baseline_measurement","pass_rate":r["pass_rate"],"minimum":m,"status":"PASS" if r["pass_rate"]>=m else "BELOW_TARGET"}))
if m>0 and r["pass_rate"]<m: raise SystemExit(f"BASELINE_GATE_FAIL: pass_rate={r['pass_rate']} < minimum={m}; set SVETLANA_MIN_BASELINE_PASS_RATE=0 to measure baseline without blocking SFT")
PY

MODE="$(python - <<'PY'
import json
from pathlib import Path
print(json.loads(Path('training/datasets/manifest_v2.json').read_text(encoding='utf-8'))['training_mode'])
PY
)"
if [[ "$MODE" == "text_production" ]]; then
  python training/gemma4/train_svetlana_production.py
  ADAPTER="training/gemma4/outputs/svetlana_gemma4_e2b_production/adapter"
  EVIDENCE="training/gemma4/outputs/svetlana_gemma4_e2b_production/training_evidence.json"
elif [[ "$MODE" == "text_smoke" ]]; then
  python training/gemma4/train_svetlana_smoke.py
  ADAPTER="training/outputs/svetlana_gemma4_e2b_smoke/adapter"
  EVIDENCE="training/outputs/svetlana_gemma4_e2b_smoke/training_evidence.json"
else
  echo "Unsupported training mode for Colab GO: $MODE" >&2; exit 2
fi

test -d "$ADAPTER"
python training/gemma4/generate_predictions.py --model "$ADAPTER" --eval training/datasets/svetlana_eval.jsonl --output "$OUT/adapter_predictions.jsonl" --max-new-tokens "$MAX_NEW_TOKENS" --metadata-output "$OUT/adapter_predictions.metadata.json"
test -s "$OUT/adapter_predictions.metadata.json"
python training/evaluation/run_structured_eval.py --eval training/datasets/svetlana_eval.jsonl --predictions "$OUT/adapter_predictions.jsonl" --output "$OUT/adapter_report.json" --label adapter
python training/evaluation/compare_reports.py --baseline "$OUT/baseline_report.json" --adapter "$OUT/adapter_report.json" --output "$OUT/baseline_vs_adapter.json" --min-baseline "$MIN_BASELINE"

python training/gemma4/generate_predictions.py --model "$ADAPTER" --eval training/datasets/svetlana_action_eval_v1.jsonl --output "$OUT/adapter_action_predictions.jsonl" --max-new-tokens "$MAX_NEW_TOKENS" --metadata-output "$OUT/adapter_action_predictions.metadata.json"
python training/evaluation/run_action_eval.py --eval training/datasets/svetlana_action_eval_v1.jsonl --predictions "$OUT/adapter_action_predictions.jsonl" --output "$OUT/adapter_action_report.json"
python - "$OUT/baseline_action_report.json" "$OUT/adapter_action_report.json" <<'PY'
import json,sys
from pathlib import Path
b=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')); a=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
print(json.dumps({"event":"action_eval_comparison","baseline_pass_rate":b["pass_rate"],"adapter_pass_rate":a["pass_rate"],"delta":a["pass_rate"]-b["pass_rate"],"human_review_required":True},ensure_ascii=False))
PY
test -s "$EVIDENCE"
cp "$EVIDENCE" "$OUT/training_evidence.json"
printf '%s\n' 'COLAB_TRAINING_COMPLETE=PASS'
printf '%s\n' 'COLAB_EVAL_REVIEW_REQUIRED=TRUE'
