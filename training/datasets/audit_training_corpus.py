"""Deterministic audit report for the Svetlana training corpus.

This is an audit, not a quality PASS gate. It reports composition and structural
coverage so a training run cannot silently use an incomplete corpus.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"record must be an object: {path}:{line_no}")
        rows.append(value)
    return rows


def _message_text(row: dict[str, Any]) -> str:
    messages = row.get("messages", [])
    return "\n".join(str(item.get("content", "")) for item in messages if isinstance(item, dict))


def _audit_file(root: Path, rel_path: str) -> dict[str, Any]:
    path = root / rel_path
    rows = _load_jsonl(path)
    privacy: dict[str, int] = {}
    modalities: dict[str, int] = {}
    ids = 0
    media_records = 0
    tool_signals = 0
    verification_signals = 0
    confirmation_signals = 0
    recovery_signals = 0
    uncertainty_signals = 0

    for row in rows:
        classification = str(row.get("privacy_classification", "<missing>"))
        privacy[classification] = privacy.get(classification, 0) + 1
        modality = str(row.get("modality", "text"))
        modalities[modality] = modalities.get(modality, 0) + 1
        ids += int(bool(row.get("id")))
        media_records += int(bool(row.get("media")))
        text = _message_text(row).casefold()
        tool_signals += int(any(token in text for token in ("tool", "инструмент", "вызов", "функци")))
        verification_signals += int(any(token in text for token in ("провер", "verify", "подтвержд")))
        confirmation_signals += int(any(token in text for token in ("подтверждени", "соглас", "разрешени")))
        recovery_signals += int(any(token in text for token in ("ошиб", "повтор", "восстанов", "fallback")))
        uncertainty_signals += int(any(token in text for token in ("неизвест", "неопредел", "допущ", "уточн")))

    return {
        "path": rel_path,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "records": len(rows),
        "records_with_id": ids,
        "records_with_media": media_records,
        "privacy_classifications": privacy,
        "modalities": modalities,
        "behavior_signal_records": {
            "tool_calling": tool_signals,
            "verification": verification_signals,
            "confirmation": confirmation_signals,
            "recovery": recovery_signals,
            "uncertainty": uncertainty_signals,
        },
    }


def audit_manifest(root: Path) -> dict[str, Any]:
    manifest_path = root / "training/datasets/manifest_v2.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    groups: dict[str, list[dict[str, Any]]] = {}
    for group in ("train", "reference_knowledge", "eval", "pending_multimodal"):
        groups[group] = []
        for item in manifest.get(group, []):
            if isinstance(item, dict) and item.get("path"):
                groups[group].append(_audit_file(root, item["path"]))

    train_total = sum(item["records"] for item in groups["train"])
    eval_total = sum(item["records"] for item in groups["eval"])
    return {
        "schema_version": manifest.get("schema_version"),
        "training_mode": manifest.get("training_mode"),
        "base_model": manifest.get("base_model"),
        "trainer": manifest.get("trainer"),
        "totals": {
            "train_records": train_total,
            "eval_records": eval_total,
            "reference_records": sum(item["records"] for item in groups["reference_knowledge"]),
            "pending_multimodal_records": sum(item["records"] for item in groups["pending_multimodal"]),
        },
        "groups": groups,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    print(json.dumps(audit_manifest(args.root), ensure_ascii=False, indent=2))
