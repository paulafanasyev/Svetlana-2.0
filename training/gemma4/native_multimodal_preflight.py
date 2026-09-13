"""Native Gemma 4 multimodal preflight scaffold. No training is started here."""
from pathlib import Path
import json

MODEL_ID = "google/gemma-4-E2B-it"
REQUIRED = {"image", "audio", "document", "video", "mixed"}


def load_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def validate_curriculum(path: Path):
    rows = load_jsonl(path)
    modalities = {row.get("modality") for row in rows}
    if modalities != REQUIRED:
        raise RuntimeError(f"curriculum modalities mismatch: {sorted(modalities)}")
    if not all(row.get("media_required") is True for row in rows):
        raise RuntimeError("every multimodal curriculum row must require real media")
    return rows


def import_native_transformers():
    from transformers import AutoProcessor, AutoModelForMultimodalLM
    return AutoProcessor, AutoModelForMultimodalLM


def main():
    curriculum = Path("training/datasets/multimodal/multimodal_training_curriculum.jsonl")
    rows = validate_curriculum(curriculum)
    print(json.dumps({"event": "curriculum", "status": "PASS", "rows": len(rows)}, ensure_ascii=False))
    print(json.dumps({"event": "model_target", "model": MODEL_ID, "status": "DECLARED_NOT_LOADED"}, ensure_ascii=False))
    print(json.dumps({"event": "gpu_training", "status": "BLOCKED"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
