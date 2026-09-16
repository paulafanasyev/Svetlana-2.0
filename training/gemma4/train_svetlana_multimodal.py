"""Minimal native multimodal SFT entry point for Gemma 4 E2B.

This intentionally fails closed when the dataset contains no real media records.
It uses the model's AutoProcessor/AutoModelForMultimodalLM path instead of
converting media into pretend text placeholders.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_records(path: Path) -> list[dict]:
    rows = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"record {line_no} is not an object")
        media = row.get("media")
        if not media:
            raise ValueError(f"record {line_no} has no real media entries")
        rows.append(row)
    if not rows:
        raise ValueError("multimodal dataset is empty")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="google/gemma-4-E2B-it")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    args = parser.parse_args()
    if args.max_seq_length <= 0:
        raise ValueError("max_seq_length must be positive")

    records = load_records(args.dataset)

    try:
        from transformers import AutoModelForMultimodalLM, AutoProcessor
    except ImportError as exc:
        raise RuntimeError("installed Transformers must provide Gemma 4 multimodal classes") from exc

    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU is required for the multimodal training smoke test")

    processor = AutoProcessor.from_pretrained(args.model)
    model = AutoModelForMultimodalLM.from_pretrained(
        args.model,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )

    # Validate that every record can be resolved to existing media before
    # invoking a trainer. The actual collator/trainer is intentionally kept
    # separate so media handling cannot silently degrade to text-only SFT.
    root = Path.cwd()
    resolved = []
    for row in records:
        for media in row["media"]:
            media_path = root / media["path"]
            if not media_path.is_file():
                raise FileNotFoundError(media["path"])
            resolved.append(str(media_path))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    evidence = {
        "status": "multimodal_model_load_and_media_resolution_pass",
        "model": args.model,
        "records": len(records),
        "media_files": resolved,
        "processor_class": type(processor).__name__,
        "model_class": type(model).__name__,
        "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0),
        "note": "This smoke path proves native multimodal model loading and media resolution; it is not a completed SFT run.",
    }
    (args.output_dir / "multimodal_smoke_evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(evidence, ensure_ascii=False))


if __name__ == "__main__":
    main()
