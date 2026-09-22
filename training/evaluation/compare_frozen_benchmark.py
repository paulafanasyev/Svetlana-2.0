"""Compare baseline and candidate predictions on the frozen Svetlana benchmark.

This is a model-evaluation artifact builder. It does not claim runtime success or final
model acceptance; those remain separate evidence gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

try:
    from training.evaluation.run_structured_eval import evaluate
except ModuleNotFoundError:
    from run_structured_eval import evaluate


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]:
            raise ValueError(f"{path}:{line_number}: invalid prediction record")
        if not isinstance(row.get("generated"), str):
            raise ValueError(f"{path}:{line_number}: generated must be string")
        rows.append(row)
    return rows


def index(rows: list[dict]) -> dict[str, dict]:
    result = {}
    for row in rows:
        if row["id"] in result:
            raise ValueError(f"duplicate prediction id: {row['id']}")
        result[row["id"]] = row
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--baseline-dir", type=Path, required=True)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--baseline-model", required=True)
    parser.add_argument("--candidate-model", required=True)
    parser.add_argument("--eval-commit", required=True)
    parser.add_argument("--generation-config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    suites = manifest.get("suites", [])
    if not suites:
        raise ValueError("benchmark manifest has no suites")

    generation_config = json.loads(args.generation_config.read_text(encoding="utf-8"))
    repo_root = args.manifest.resolve().parents[2]
    suite_results = []
    regressions = []

    for suite in suites:
        suite_id = suite["suite_id"]
        eval_path = repo_root / suite["eval_path"]
        if not eval_path.is_file():
            raise FileNotFoundError(eval_path)
        baseline_path = args.baseline_dir / f"{suite_id}.jsonl"
        candidate_path = args.candidate_dir / f"{suite_id}.jsonl"
        if not baseline_path.is_file():
            raise FileNotFoundError(baseline_path)
        if not candidate_path.is_file():
            raise FileNotFoundError(candidate_path)

        eval_rows = index(load_jsonl(eval_path))
        baseline_rows = index(load_jsonl(baseline_path))
        candidate_rows = index(load_jsonl(candidate_path))
        baseline_report = evaluate(eval_rows, baseline_rows)
        candidate_report = evaluate(eval_rows, candidate_rows)
        delta = candidate_report["pass_rate"] - baseline_report["pass_rate"]
        regression = delta < 0
        if regression:
            regressions.append(suite_id)

        suite_results.append({
            "suite_id": suite_id,
            "eval_path": suite["eval_path"],
            "eval_sha256": sha256(eval_path),
            "cases": baseline_report["cases"],
            "baseline": {
                "passed_cases": baseline_report["passed_cases"],
                "pass_rate": baseline_report["pass_rate"],
            },
            "candidate": {
                "passed_cases": candidate_report["passed_cases"],
                "pass_rate": candidate_report["pass_rate"],
            },
            "delta_pass_rate": delta,
            "regression": regression,
        })

    baseline_cases = sum(x["baseline"]["passed_cases"] for x in suite_results)
    candidate_cases = sum(x["candidate"]["passed_cases"] for x in suite_results)
    total_cases = sum(x["cases"] for x in suite_results)
    baseline_rate = baseline_cases / total_cases if total_cases else 0.0
    candidate_rate = candidate_cases / total_cases if total_cases else 0.0

    comparison = {
        "schema_version": "frozen-comparison-v1",
        "benchmark_id": manifest.get("benchmark_id"),
        "benchmark_version": manifest.get("benchmark_version"),
        "benchmark_manifest_sha256": sha256(args.manifest),
        "baseline_model": args.baseline_model,
        "candidate_model": args.candidate_model,
        "generation_config": generation_config,
        "eval_commit": args.eval_commit,
        "prediction_artifacts": {
            "baseline_dir": str(args.baseline_dir),
            "candidate_dir": str(args.candidate_dir),
        },
        "scores": {
            "total_cases": total_cases,
            "baseline_pass_rate": baseline_rate,
            "candidate_pass_rate": candidate_rate,
            "delta_pass_rate": candidate_rate - baseline_rate,
        },
        "suite_results": suite_results,
        "regressions": regressions,
        "automated_comparison_status": "VERIFIED",
        "capability_status": "NOT_PROVEN",
        "human_review": {"status": "PENDING"},
        "runtime_evidence": {"status": "PENDING"},
        "acceptance_note": "No final model acceptance is inferred from training loss or automated score alone.",
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "event": "frozen_benchmark_comparison_complete",
        "benchmark_id": comparison["benchmark_id"],
        "benchmark_version": comparison["benchmark_version"],
        "baseline_pass_rate": baseline_rate,
        "candidate_pass_rate": candidate_rate,
        "delta_pass_rate": candidate_rate - baseline_rate,
        "regressions": regressions,
        "capability_status": comparison["capability_status"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
