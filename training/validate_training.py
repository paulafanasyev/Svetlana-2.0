"""Deterministic validation gates for Svetlana training assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON at {path}:{line_no}: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"JSONL record must be an object at {path}:{line_no}")
        rows.append(value)
    return rows


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _normalized(value: Any) -> str:
    text = _canonical(value).casefold()
    return re.sub(r"\s+", " ", text).strip()


def _records_to_text(value: Any) -> str:
    return _normalized(value)


def _check_media(record: dict[str, Any], root: Path) -> None:
    media = record.get("media", [])
    if record.get("media_required") and not media:
        raise ValueError(f"record {record.get('id', '<unknown>')} requires media metadata")
    for item in media:
        if not isinstance(item, dict) or not item.get("path"):
            raise ValueError(f"record {record.get('id', '<unknown>')} has invalid media metadata")
        media_path = root / item["path"]
        if not media_path.is_file():
            raise ValueError(f"missing media asset: {item['path']}")
        expected = item.get("sha256")
        if not expected:
            raise ValueError(f"media asset lacks sha256: {item['path']}")
        actual = hashlib.sha256(media_path.read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"media sha256 mismatch: {item['path']}")
        if not item.get("source") or not item.get("license"):
            raise ValueError(f"media asset lacks source/license: {item['path']}")


def _check_privacy(record: dict[str, Any]) -> None:
    classification = record.get("privacy_classification")
    if not isinstance(classification, str) or not classification.strip():
        raise ValueError(f"record {record.get('id', '<unknown>')} lacks privacy_classification")


def validate_manifest(manifest_path: Path, root: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    mode = manifest.get("training_mode")
    trainer = manifest.get("trainer")
    if mode not in {"text_smoke", "multimodal_agent"}:
        raise ValueError("training_mode must be text_smoke or multimodal_agent")
    if not trainer:
        raise ValueError("manifest must identify the actual trainer")
    if not (root / trainer).is_file():
        raise ValueError(f"trainer does not exist: {trainer}")
    if mode == "multimodal_agent":
        if not manifest.get("native_multimodal_trainer"):
            raise ValueError("multimodal_agent requires native_multimodal_trainer")
        if not (root / manifest["native_multimodal_trainer"]).is_file():
            raise ValueError("native multimodal trainer file is missing")
    for group in ("train", "reference_knowledge", "eval"):
        for item in manifest.get(group, []):
            path = item.get("path") if isinstance(item, dict) else None
            if not path or not (root / path).is_file():
                raise ValueError(f"manifest path missing: {path}")
    return manifest


def validate_jsonl_splits(train_paths: Iterable[Path], eval_paths: Iterable[Path], root: Path) -> dict[str, int]:
    train_rows: list[dict[str, Any]] = []
    eval_rows: list[dict[str, Any]] = []
    for path in train_paths:
        rows = _load_jsonl(path)
        train_rows.extend(rows)
        for row in rows:
            if "messages" not in row and not row.get("media_required"):
                raise ValueError(f"training record lacks messages: {path}")
            _check_privacy(row)
            _check_media(row, root)
    for path in eval_paths:
        rows = _load_jsonl(path)
        eval_rows.extend(rows)
        for row in rows:
            if "messages" not in row:
                raise ValueError(f"evaluation record lacks messages: {path}")
            _check_privacy(row)
            _check_media(row, root)

    exact_train = {_canonical(row) for row in train_rows}
    exact_eval = {_canonical(row) for row in eval_rows}
    if exact_train & exact_eval:
        raise ValueError("exact train/eval overlap detected")
    normalized_train = {_normalized(row) for row in train_rows}
    normalized_eval = {_normalized(row) for row in eval_rows}
    if normalized_train & normalized_eval:
        raise ValueError("normalized train/eval overlap detected")
    for train in map(_records_to_text, train_rows):
        for evaluation in map(_records_to_text, eval_rows):
            if SequenceMatcher(None, train, evaluation).ratio() >= 0.96:
                raise ValueError("near-duplicate train/eval overlap detected")
    return {"train_records": len(train_rows), "eval_records": len(eval_rows)}


def validate_repository(root: Path) -> dict[str, Any]:
    manifest = validate_manifest(root / "training/datasets/manifest_v2.json", root)
    train_paths = [root / item["path"] for item in manifest.get("train", [])]
    eval_paths = [root / item["path"] for item in manifest.get("eval", [])]
    counts = validate_jsonl_splits(train_paths, eval_paths, root)
    return {
        "manifest_mode": manifest["training_mode"],
        "trainer": manifest["trainer"],
        "train_inputs": [str(p.relative_to(root)) for p in train_paths],
        "eval_inputs": [str(p.relative_to(root)) for p in eval_paths],
        **counts,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(json.dumps({"event": "training_validation_pass", **validate_repository(args.root)}, ensure_ascii=False))
