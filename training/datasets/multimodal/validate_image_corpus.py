"""Validate the generated multimodal image corpus before GPU training."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

REQUIRED_MEDIA = {"type", "path", "sha256", "license", "provenance"}


def validate(path: Path, root: Path | None = None) -> dict:
    root = root or Path.cwd()
    rows = []
    seen = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        for key in ("id", "modality", "task", "messages", "media", "privacy_classification", "split"):
            if key not in row:
                raise ValueError(f"line {line_no}: missing {key}")
        if row["id"] in seen:
            raise ValueError(f"duplicate id: {row['id']}")
        seen.add(row["id"])
        if row["modality"] != "image":
            raise ValueError(f"line {line_no}: expected image modality")
        if row["split"] not in {"train", "eval"}:
            raise ValueError(f"line {line_no}: invalid split")
        if row["privacy_classification"] != "synthetic_no_private_data":
            raise ValueError(f"line {line_no}: non-synthetic privacy classification")
        if not row["media"]:
            raise ValueError(f"line {line_no}: empty media")
        for media in row["media"]:
            missing = REQUIRED_MEDIA - set(media)
            if missing:
                raise ValueError(f"line {line_no}: media missing {sorted(missing)}")
            media_path = root / media["path"]
            if not media_path.is_file():
                raise FileNotFoundError(media["path"])
            actual = hashlib.sha256(media_path.read_bytes()).hexdigest()
            if actual != media["sha256"]:
                raise ValueError(f"line {line_no}: SHA mismatch for {media['path']}")
            if media["license"] != "synthetic":
                raise ValueError(f"line {line_no}: unexpected license")
        rows.append(row)

    train = sum(r["split"] == "train" for r in rows)
    eval_count = sum(r["split"] == "eval" for r in rows)
    if train == 0 or eval_count == 0:
        raise ValueError("both train and eval splits are required")
    return {"status": "PASS", "records": len(rows), "train": train, "eval": eval_count}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.dataset), ensure_ascii=False))
