from __future__ import annotations

import argparse
import json
from pathlib import Path


def validate_report(report: dict, label: str) -> None:
    required = {"label", "cases", "passed_cases", "pass_rate", "results"}
    missing = required - set(report)
    if missing:
        raise ValueError(f"{label} report missing fields: {sorted(missing)}")
    results = report["results"]
    if not isinstance(results, list) or len(results) != report["cases"]:
        raise ValueError(f"{label} report cases/results mismatch")
    ids = [row.get("id") for row in results]
    if any(not isinstance(case_id, str) or not case_id for case_id in ids) or len(set(ids)) != len(ids):
        raise ValueError(f"{label} report has missing or duplicate case IDs")
    for row in results:
        if not isinstance(row, dict) or not isinstance(row.get("passed"), bool):
            raise ValueError(f"{label} report passed must be boolean")
        checks = row.get("checks")
        if not isinstance(checks, dict) or any(not isinstance(value, bool) for value in checks.values()):
            raise ValueError(f"{label} report checks must be boolean mapping")
        if row["passed"] != all(checks.values()):
            raise ValueError(f"{label} report passed is inconsistent with checks")
    counted = sum(row["passed"] for row in results)
    if counted != report["passed_cases"]:
        raise ValueError(f"{label} report passed_cases is not reproducible from results")
    expected_rate = counted / len(results) if results else 0.0
    if abs(float(report["pass_rate"]) - expected_rate) > 1e-9:
        raise ValueError(f"{label} report pass_rate is not reproducible from results")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--min-baseline", type=float, default=0.75)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    adapter = json.loads(args.adapter.read_text(encoding="utf-8"))
    validate_report(baseline, "baseline")
    validate_report(adapter, "adapter")
    baseline_ids = [row["id"] for row in baseline["results"]]
    adapter_ids = [row["id"] for row in adapter["results"]]
    if baseline_ids != adapter_ids:
        raise SystemExit("baseline and adapter case IDs differ or are out of order")
    if baseline["cases"] != adapter["cases"]:
        raise SystemExit("baseline and adapter case counts differ")
    report = {
        "baseline_pass_rate": baseline["pass_rate"],
        "adapter_pass_rate": adapter["pass_rate"],
        "delta": adapter["pass_rate"] - baseline["pass_rate"],
        "cases": baseline["cases"],
        "evaluator_version": baseline.get("evaluator_version"),
        "pass": adapter["pass_rate"] >= args.min_baseline and adapter["pass_rate"] >= baseline["pass_rate"],
        "human_review_required": True,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"event": "comparison_complete", **report}, ensure_ascii=False))
    if not report["pass"]:
        raise SystemExit("baseline/adapter acceptance gate failed")


if __name__ == "__main__":
    main()
