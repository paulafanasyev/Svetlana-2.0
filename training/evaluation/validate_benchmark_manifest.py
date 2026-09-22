"""Validate the frozen benchmark registry without executing a model.

The validator checks that benchmark suite files exist, are unique and contain
privacy classifications. It intentionally does not produce a quality PASS.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

def main(root: Path) -> int:
    m = json.loads((root / "training/evaluation/FROZEN_BENCHMARK_MANIFEST_V1.json").read_text(encoding="utf-8"))
    suites = m.get("suites", [])
    errors = []
    ids = [s.get("suite_id") for s in suites]
    if len(ids) != len(set(ids)):
        errors.append("duplicate suite_id")
    for suite in suites:
        p = root / suite["eval_path"]
        if not p.is_file():
            errors.append(f"missing eval file: {suite['eval_path']}")
            continue
        seen = set()
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            rid = row.get("id")
            if not rid:
                errors.append(f"{p}:{n}: missing id")
            elif rid in seen:
                errors.append(f"{p}:{n}: duplicate id {rid}")
            seen.add(rid)
            if row.get("privacy_classification") != "synthetic_no_personal_data":
                errors.append(f"{p}:{n}: invalid privacy classification")
    result = "VERIFIED" if not errors else "NOT_PROVEN"
    report = {"result": result, "suites": len(suites), "errors": errors}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    raise SystemExit(main(parser.parse_args().root))
