from __future__ import annotations

import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--baseline", type=Path, required=True)
parser.add_argument("--adapter", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--min-baseline", type=float, default=0.75)
args = parser.parse_args()
baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
adapter = json.loads(args.adapter.read_text(encoding="utf-8"))
if baseline["cases"] != adapter["cases"]:
    raise SystemExit("baseline and adapter case counts differ")
report = {
    "baseline_pass_rate": baseline["pass_rate"],
    "adapter_pass_rate": adapter["pass_rate"],
    "delta": adapter["pass_rate"] - baseline["pass_rate"],
    "cases": baseline["cases"],
    "pass": baseline["pass_rate"] >= args.min_baseline and adapter["pass_rate"] >= baseline["pass_rate"],
    "human_review_required": True,
}
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"event": "comparison_complete", **report}, ensure_ascii=False))
if not report["pass"]:
    raise SystemExit("baseline/adapter acceptance gate failed")
