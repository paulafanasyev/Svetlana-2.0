"""Validate the frozen benchmark registry without executing a model.

The validator checks benchmark identity, suite paths, held-out record integrity and
structured-evaluator compatibility. It intentionally does not produce a model-quality PASS.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

try:
    from training.evaluation.run_structured_eval import PATTERNS
except ModuleNotFoundError:
    from run_structured_eval import PATTERNS


REQUIRED_SUITE_KEYS = ("suite_id", "node_prefix", "eval_path", "evaluator", "status")
ALLOWED_SUITE_STATUS = {"READY_FOR_EVAL"}
ALLOWED_EVALUATORS = {"structural_or_custom", "custom_behavior"}


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode("utf-8")
    return hashlib.sha1(header + data).hexdigest()


def main(root: Path) -> int:
    manifest_path = root / "training/evaluation/FROZEN_BENCHMARK_MANIFEST_V1.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []

    if manifest.get("benchmark_id") != "SVETLANA_FROZEN_BENCHMARK":
        errors.append("invalid benchmark_id")
    if manifest.get("benchmark_version") != "1.0":
        errors.append("invalid benchmark_version")
    if manifest.get("evaluator_version") != "structured-v2.2":
        errors.append("invalid evaluator_version")

    suites = manifest.get("suites", [])
    if not suites:
        errors.append("benchmark has no suites")

    suite_ids: set[str] = set()
    eval_paths: set[str] = set()
    global_record_ids: set[str] = set()

    for suite in suites:
        for key in REQUIRED_SUITE_KEYS:
            if key not in suite:
                errors.append(f"suite missing {key}")
        suite_id = suite.get("suite_id")
        eval_path = suite.get("eval_path")
        if not isinstance(suite_id, str) or not suite_id:
            continue
        if suite_id in suite_ids:
            errors.append(f"duplicate suite_id: {suite_id}")
        suite_ids.add(suite_id)
        if eval_path in eval_paths:
            errors.append(f"duplicate eval_path: {eval_path}")
        eval_paths.add(eval_path)

        if suite.get("status") not in ALLOWED_SUITE_STATUS:
            errors.append(f"{suite_id}: unsupported status {suite.get('status')!r}")
        if suite.get("evaluator") not in ALLOWED_EVALUATORS:
            errors.append(f"{suite_id}: unsupported evaluator {suite.get('evaluator')!r}")

        if not isinstance(eval_path, str):
            continue
        p = root / eval_path
        if not p.is_file():
            errors.append(f"missing eval file: {eval_path}")
            continue
        expected_blob_sha = suite.get("eval_git_blob_sha")
        if not isinstance(expected_blob_sha, str) or not expected_blob_sha:
            errors.append(f"{suite_id}: missing eval_git_blob_sha")
        else:
            actual_blob_sha = git_blob_sha(p)
            if actual_blob_sha != expected_blob_sha:
                errors.append(
                    f"{suite_id}: frozen eval blob mismatch: expected {expected_blob_sha}, got {actual_blob_sha}"
                )

        seen: set[str] = set()
        node_prefixes = suite.get("node_prefixes")
        if not isinstance(node_prefixes, list) or not node_prefixes:
            node_prefixes = [suite.get("node_prefix", "")]
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(f"{p}:{n}: invalid JSON: {exc}")
                continue

            rid = row.get("id")
            if not isinstance(rid, str) or not rid:
                errors.append(f"{p}:{n}: missing id")
            else:
                if rid in seen:
                    errors.append(f"{p}:{n}: duplicate id {rid}")
                if rid in global_record_ids:
                    errors.append(f"{p}:{n}: record id repeated across benchmark suites: {rid}")
                seen.add(rid)
                global_record_ids.add(rid)

            if row.get("privacy_classification") != "synthetic_no_personal_data":
                errors.append(f"{p}:{n}: invalid privacy classification")

            node_id = row.get("node_id")
            if not isinstance(node_id, str) or not node_id:
                errors.append(f"{p}:{n}: missing node_id")
            elif not any(isinstance(prefix, str) and node_id.startswith(prefix) for prefix in node_prefixes):
                errors.append(f"{p}:{n}: node_id {node_id!r} does not match suite prefixes {node_prefixes!r}")

            required_behaviors = row.get("evaluation", {}).get("required_behaviors")
            if not isinstance(required_behaviors, list) or not required_behaviors:
                errors.append(f"{p}:{n}: missing evaluation.required_behaviors")
            else:
                for behavior in required_behaviors:
                    if behavior not in PATTERNS:
                        errors.append(f"{p}:{n}: unknown required behavior {behavior!r}")

    result = "VERIFIED" if not errors else "NOT_PROVEN"
    report = {
        "result": result,
        "benchmark_id": manifest.get("benchmark_id"),
        "benchmark_version": manifest.get("benchmark_version"),
        "evaluator_version": manifest.get("evaluator_version"),
        "suites": len(suites),
        "record_count": len(global_record_ids),
        "errors": errors,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    raise SystemExit(main(parser.parse_args().root))
