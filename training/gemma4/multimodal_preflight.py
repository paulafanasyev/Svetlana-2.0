"""Native Gemma multimodal preflight; never substitutes a text-only check."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def run_preflight(root: Path) -> dict:
    try:
        from transformers import AutoProcessor
    except ImportError as exc:
        raise RuntimeError("native multimodal preflight requires transformers") from exc

    manifest = json.loads((root / "training/datasets/manifest_v2.json").read_text(encoding="utf-8"))
    model_name = manifest["base_model"]
    asset = root / "training/assets/preflight/test_screen.png"
    if not asset.is_file():
        raise RuntimeError(f"required real image asset is missing: {asset}")
    asset_sha = hashlib.sha256(asset.read_bytes()).hexdigest()
    processor = AutoProcessor.from_pretrained(model_name)
    messages = [{"role": "user", "content": [{"type": "image", "image": str(asset)}, {"type": "text", "text": "Опиши изображение."}]}]
    batch = processor.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
    if getattr(batch, "ndim", 0) == 0:
        raise RuntimeError("processor returned no token batch")
    return {"event": "multimodal_preflight_pass", "model": model_name, "asset": str(asset.relative_to(root)), "asset_sha256": asset_sha, "batch_shape": list(batch.shape)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    print(json.dumps(run_preflight(args.root), ensure_ascii=False))
