"""Deterministic validation gates for Svetlana training assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse


SUPPORTED_TRAINING_MODES = {"text_smoke", "text_production", "multimodal_agent"}


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


def _check_rag_fact(record: dict[str, Any], path: Path, line_no: int) -> None:
    if record.get("record_type") != "RAG_FACT":
        return
    context = f"RAG_FACT {record.get('id', '<unknown>')} at {path}:{line_no}"
    required = ("source_url", "source_type", "authority", "verified_at", "jurisdiction", "legal_status", "effective_date", "supersedes", "confidence", "privacy")
    missing = [field for field in required if field not in record]
    if missing:
        raise ValueError(f"{context} missing provenance field(s): {', '.join(missing)}")
    parsed = urlparse(record["source_url"]) if isinstance(record["source_url"], str) else None
    if not parsed or parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{context} source_url must be an absolute http(s) URL")
    for field in ("source_type", "authority", "jurisdiction", "legal_status", "privacy"):
        if not isinstance(record[field], str) or not record[field].strip():
            raise ValueError(f"{context} {field} must be a non-empty string")
    statuses = {"in_force", "repealed", "superseded", "draft", "historical", "not_applicable", "unknown"}
    if record["legal_status"] not in statuses:
        raise ValueError(f"{context} legal_status is unsupported")

    def valid_iso(value: Any) -> bool:
        if not isinstance(value, str) or not value.strip():
            return False
        try:
            date.fromisoformat(value) if len(value) == 10 else datetime.fromisoformat(value)
            return True
        except ValueError:
            return False

    if not valid_iso(record["verified_at"]):
        raise ValueError(f"{context} verified_at must be ISO-8601")
    if record["effective_date"] is None:
        if record["legal_status"] not in {"not_applicable", "unknown"}:
            raise ValueError(f"{context} effective_date is required")
    elif not valid_iso(record["effective_date"]):
        raise ValueError(f"{context} effective_date must be ISO-8601 or null")
    supersedes = record["supersedes"]
    if supersedes is not None and (not isinstance(supersedes, list) or any(not isinstance(item, str) or not item.strip() for item in supersedes) or len(set(supersedes)) != len(supersedes) or record.get("id") in supersedes):
        raise ValueError(f"{context} supersedes must be null or a unique list without self-reference")
    confidence = record["confidence"]
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise ValueError(f"{context} confidence must be a number in [0, 1]")


def validate_manifest(manifest_path: Path, root: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    mode = manifest.get("training_mode")
    trainer = manifest.get("trainer")
    if mode not in SUPPORTED_TRAINING_MODES:
        raise ValueError("training_mode must be one of: " + ", ".join(sorted(SUPPORTED_TRAINING_MODES)))
    if not trainer:
        raise ValueError("manifest must identify the actual trainer")
    if not (root / trainer).is_file():
        raise ValueError(f"trainer does not exist: {trainer}")
    if mode == "text_production" and trainer != "training/gemma4/train_svetlana_production.py":
        raise ValueError("text_production requires training/gemma4/train_svetlana_production.py")
    if mode == "text_smoke" and trainer != "training/gemma4/train_svetlana_smoke.py":
        raise ValueError("text_smoke requires training/gemma4/train_svetlana_smoke.py")
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


def _validate_records(rows: list[dict[str, Any]], path: Path, root: Path, require_messages: bool) -> None:
    for line_no, row in enumerate(rows, 1):
        if require_messages and "messages" not in row:
            raise ValueError(f"record lacks messages: {path}:{line_no}")
        if require_messages and not isinstance(row.get("messages"), list):
            raise ValueError(f"messages must be a list: {path}:{line_no}")
        _check_privacy(row)
        _check_rag_fact(row, path, line_no)
        _check_media(row, root)


def validate_jsonl_splits(train_paths: Iterable[Path], eval_paths: Iterable[Path], root: Path) -> dict[str, int]:
    train_rows: list[dict[str, Any]] = []
    eval_rows: list[dict[str, Any]] = []
    for path in train_paths:
        rows = _load_jsonl(path)
        train_rows.extend(rows)
        _validate_records(rows, path, root, require_messages=True)
    for path in eval_paths:
        rows = _load_jsonl(path)
        eval_rows.extend(rows)
        _validate_records(rows, path, root, require_messages=True)

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


def validate_reference_knowledge(paths: Iterable[Path], root: Path) -> int:
    rows_count = 0
    for path in paths:
        rows = _load_jsonl(path)
        for line_no, row in enumerate(rows, 1):
            for field in ("question", "answer", "source_url", "source_type", "verified_at"):
                if not isinstance(row.get(field), str) or not row[field].strip():
                    raise ValueError(f"reference record missing non-empty {field}: {path}:{line_no}")
            parsed = urlparse(row["source_url"])
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(f"reference record has invalid source_url: {path}:{line_no}")
            try:
                date.fromisoformat(row["verified_at"])
            except ValueError as exc:
                raise ValueError(f"reference record verified_at must be ISO-8601: {path}:{line_no}") from exc
            _check_privacy(row)
            _check_media(row, root)
            rows_count += 1
    return rows_count


def validate_repository(root: Path) -> dict[str, Any]:
    manifest = validate_manifest(root / "training/datasets/manifest_v2.json", root)
    train_paths = [root / item["path"] for item in manifest.get("train", [])]
    reference_paths = [root / item["path"] for item in manifest.get("reference_knowledge", [])]
    eval_paths = [root / item["path"] for item in manifest.get("eval", [])]
    counts = validate_jsonl_splits(train_paths, eval_paths, root)
    reference_records = validate_reference_knowledge(reference_paths, root)
    return {
        "manifest_mode": manifest["training_mode"],
        "trainer": manifest["trainer"],
        "train_inputs": [str(p.relative_to(root)) for p in train_paths],
        "reference_inputs": [str(p.relative_to(root)) for p in reference_paths],
        "eval_inputs": [str(p.relative_to(root)) for p in eval_paths],
        "reference_records": reference_records,
        **counts,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(json.dumps({"event": "training_validation_pass", **validate_repository(args.root)}, ensure_ascii=False))
