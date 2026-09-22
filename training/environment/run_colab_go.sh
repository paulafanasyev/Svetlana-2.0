#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
OUT="${SVETLANA_OUTPUT_DIR:-training/outputs/colab_go}"
MIN_ACCEPTANCE="${SVETLANA_MIN_ACCEPTANCE_PASS_RATE:-0.75}"
MAX_NEW_TOKENS="${SVETLANA_MAX_NEW_TOKENS:-160}"
ACCEPTANCE_EVAL="${SVETLANA_ACCEPTANCE_EVAL:-training/evaluation/svetlana_acceptance_eval_v2.jsonl}"
mkdir -p "$OUT"
test -s "$ACCEPTANCE_EVAL"

python -m pip install --upgrade pip
python -m pip install -r training/environment/requirements-colab-gpu.txt
# Text-only Gemma4 training does not use TorchAudio. Remove preinstalled mismatched wheels
# from hosted Colab images so CUDA 12.8/12.6 warnings cannot mask real failures.
python -m pip uninstall -y torchaudio >/dev/null 2>&1 || true

python - <<'PY'
import importlib
import json
import platform
import re
from importlib.metadata import version
from pathlib import Path

REQUIREMENTS = Path('training/environment/requirements-colab-gpu.txt')
required_names = ('unsloth', 'unsloth-zoo', 'torchcodec', 'transformers', 'trl', 'datasets', 'accelerate', 'peft')
pins = {}
for line in REQUIREMENTS.read_text(encoding='utf-8').splitlines():
    match = re.fullmatch(r'([A-Za-z0-9_.-]+)==([^\s]+)', line.strip())
    if match:
        pins[match.group(1).lower().replace('_', '-')] = match.group(2)
EXPECTED = {name: pins.get(name) for name in required_names}
missing_pins = [name for name, expected in EXPECTED.items() if not expected]
if missing_pins:
    raise SystemExit(f'PACKAGE_PIN_SPEC_FAIL: missing exact pins for {missing_pins}')
for name in EXPECTED:
    importlib.import_module('unsloth_zoo' if name == 'unsloth-zoo' else name)
for name, expected in EXPECTED.items():
    actual = version(name)
    # CUDA wheels can expose a local suffix such as +cu126.
    if actual != expected and not actual.startswith(expected + '+'):
        raise SystemExit(f'PACKAGE_PIN_FAIL: {name}={actual}, expected {expected}')
import torch
if not torch.cuda.is_available():
    raise SystemExit('CUDA is required; stopping before baseline/training')
print(json.dumps({
    'event': 'environment_pass',
    'python': platform.python_version(),
    'cuda': torch.version.cuda,
    'gpu': torch.cuda.get_device_name(0),
    'vram_gb': round(torch.cuda.get_device_properties(0).total_memory/1024**3, 2),
    'packages': EXPECTED,
}, ensure_ascii=False))
PY

python training/validate_training.py --root .
python training/datasets/multimodal/generate_synthetic_images.py
python training/datasets/multimodal/validate_image_corpus.py training/datasets/multimodal/image_training_records.jsonl

# Baseline is diagnostic only. A weak untrained baseline must not prevent SFT from starting.
python training/gemma4/generate_predictions.py   --model google/gemma-4-E2B-it   --eval "$ACCEPTANCE_EVAL"   --output "$OUT/baseline_predictions.jsonl"   --max-new-tokens "$MAX_NEW_TOKENS"   --metadata-output "$OUT/baseline_predictions.metadata.json"
test -s "$OUT/baseline_predictions.metadata.json"

python training/evaluation/run_structured_eval.py   --eval "$ACCEPTANCE_EVAL"   --predictions "$OUT/baseline_predictions.jsonl"   --output "$OUT/baseline_report.json"   --label baseline

python - "$OUT/baseline_report.json" <<'PY'
import json
import sys
from pathlib import Path
report = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
print(json.dumps({
    "event": "baseline_measurement",
    "pass_rate": float(report["pass_rate"]),
    "status": "MEASURED_ONLY",
}, ensure_ascii=False))
PY

python - <<'PY'
import json
from pathlib import Path
manifest = json.loads(Path('training/datasets/manifest_v2.json').read_text(encoding='utf-8'))
rules = manifest.get('rules', {})
mode = manifest.get('training_mode')
if mode == 'multimodal_agent' and rules.get('do_not_start_training_until_multimodal_trainer_is_ready'):
    trainer = manifest.get('native_multimodal_trainer')
    if not trainer or not Path(trainer).is_file():
        print(json.dumps({
            'event': 'training_gate_blocked',
            'reason': 'native_multimodal_trainer_not_ready',
            'native_multimodal_trainer': trainer,
        }, ensure_ascii=False))
        raise SystemExit(2)
print(json.dumps({'event': 'training_mode_gate_pass', 'training_mode': mode}, ensure_ascii=False))
PY

MODE="$(python - <<'PY'
import json
from pathlib import Path
print(json.loads(Path('training/datasets/manifest_v2.json').read_text(encoding='utf-8'))['training_mode'])
PY
)"

if [[ "$MODE" == "text_production" ]]; then
  if [[ "${SVETLANA_EVIDENCE_ONLY:-0}" == "1" ]]; then
    python training/gemma4/train_svetlana_production.py --evidence-only
  else
    python training/gemma4/train_svetlana_production.py
  fi
  ADAPTER="training/gemma4/outputs/svetlana_gemma4_e2b_production/adapter"
  EVIDENCE="training/gemma4/outputs/svetlana_gemma4_e2b_production/training_evidence.json"
elif [[ "$MODE" == "text_smoke" ]]; then
  python training/gemma4/train_svetlana_smoke.py
  ADAPTER="training/outputs/svetlana_gemma4_e2b_smoke/adapter"
  EVIDENCE="training/outputs/svetlana_gemma4_e2b_smoke/training_evidence.json"
else
  echo "Unsupported training mode for Colab GO: $MODE" >&2
  exit 2
fi

test -d "$ADAPTER"
test -n "$(find "$ADAPTER" -type f -print -quit)"
test -s "$EVIDENCE"

python training/gemma4/generate_predictions.py   --model "$ADAPTER"   --eval "$ACCEPTANCE_EVAL"   --output "$OUT/adapter_predictions.jsonl"   --max-new-tokens "$MAX_NEW_TOKENS"   --metadata-output "$OUT/adapter_predictions.metadata.json"
test -s "$OUT/adapter_predictions.metadata.json"

python training/evaluation/run_structured_eval.py   --eval "$ACCEPTANCE_EVAL"   --predictions "$OUT/adapter_predictions.jsonl"   --output "$OUT/adapter_report.json"   --label adapter

python training/evaluation/compare_reports.py   --baseline "$OUT/baseline_report.json"   --adapter "$OUT/adapter_report.json"   --output "$OUT/baseline_vs_adapter.json"   --min-baseline "$MIN_ACCEPTANCE"

test -s "$EVIDENCE"
cp "$EVIDENCE" "$OUT/training_evidence.json"
test -s "$OUT/training_evidence.json"
printf '%s\n' 'COLAB_GO_GATE=PASS'
