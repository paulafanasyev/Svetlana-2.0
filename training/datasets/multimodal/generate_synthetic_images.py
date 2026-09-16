"""Generate deterministic synthetic PNG media for multimodal training.

No external or private media is used. The generated assets are intentionally
simple, reproducible, and hashed in the resulting JSONL manifest.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
ASSET_DIR = ROOT / "synthetic_images"
MANIFEST = ROOT / "image_training_records.jsonl"

SPECS = [
    ("img_001", "screen_understanding", "green dashboard with three cards and a status badge"),
    ("img_002", "document_understanding", "synthetic invoice with readable total and date"),
    ("img_003", "screen_understanding", "calendar with two marked appointments"),
    ("img_004", "document_understanding", "synthetic receipt with item rows and total"),
    ("img_005", "screen_understanding", "simple bar chart with three labeled categories"),
    ("img_006", "screen_understanding", "settings screen with enabled and disabled rows"),
    ("img_007", "document_understanding", "synthetic contract cover with title and date"),
    ("img_008", "screen_understanding", "task list with three tasks and one completed task"),
]


def make_image(kind: str, description: str, index: int) -> Image.Image:
    image = Image.new("RGB", (768, 512), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((24, 24, 744, 488), outline="black", width=3)
    draw.text((48, 44), f"Synthetic sample {index}", fill="black")
    draw.text((48, 78), kind.replace("_", " "), fill="black")
    if "dashboard" in description:
        for i in range(3):
            x = 48 + i * 220
            draw.rectangle((x, 140, x + 190, 280), outline="black", width=2)
            draw.text((x + 16, 160), f"Card {i + 1}", fill="black")
    elif "invoice" in description:
        draw.text((60, 140), "INVOICE", fill="black")
        draw.text((60, 190), "Date: 2026-09-01", fill="black")
        draw.text((60, 230), "Total: 12500 RUB", fill="black")
    elif "calendar" in description:
        for i in range(3):
            x = 60 + i * 210
            draw.rectangle((x, 150, x + 170, 360), outline="black")
            draw.text((x + 18, 170), f"Day {i + 1}", fill="black")
        draw.rectangle((270, 220, 430, 280), outline="black", width=4)
    elif "receipt" in description:
        draw.text((60, 140), "RECEIPT", fill="black")
        for i, label in enumerate(("Item A  300", "Item B  450", "Item C  250")):
            draw.text((70, 190 + i * 42), label, fill="black")
        draw.text((70, 330), "TOTAL 1000 RUB", fill="black")
    elif "bar chart" in description:
        for i, height in enumerate((80, 150, 110)):
            x = 90 + i * 190
            draw.rectangle((x, 390 - height, x + 90, 390), outline="black", width=2)
            draw.text((x + 12, 410), chr(65 + i), fill="black")
    elif "settings" in description:
        for i, state in enumerate(("ON", "OFF", "ON")):
            y = 150 + i * 80
            draw.text((70, y), f"Setting {i + 1}", fill="black")
            draw.rectangle((500, y - 8, 590, y + 28), outline="black", width=2)
            draw.text((520, y), state, fill="black")
    elif "contract" in description:
        draw.text((60, 150), "SERVICE AGREEMENT", fill="black")
        draw.text((60, 205), "Date: 2026-09-10", fill="black")
        draw.text((60, 260), "Synthetic training document", fill="black")
    else:
        for i, text in enumerate(("Task A", "Task B", "Task C")):
            y = 150 + i * 75
            draw.rectangle((60, y, 90, y + 30), outline="black", width=2)
            draw.text((115, y), text, fill="black")
        draw.rectangle((60, 150, 90, 180), outline="black", width=5)
    return image


def _portable_path(path: Path) -> str:
    """Return a repository-relative path when possible, otherwise the given path."""
    try:
        return path.relative_to(Path.cwd()).as_posix()
    except ValueError:
        return path.as_posix()


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for index, (sample_id, task, description) in enumerate(SPECS, 1):
        path = ASSET_DIR / f"{sample_id}.png"
        make_image(task, description, index).save(path, format="PNG", optimize=False)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        split = "eval" if index in (7, 8) else "train"
        portable_path = _portable_path(path)
        rows.append({
            "id": sample_id,
            "modality": "image",
            "task": task,
            "messages": [{"role": "user", "content": [{"type": "image", "path": portable_path}, {"type": "text", "text": "Опиши только то, что действительно видно на изображении."}]}],
            "media": [{"type": "image", "path": portable_path, "sha256": digest, "license": "synthetic", "provenance": "generated locally by this repository"}],
            "expected_output": description,
            "privacy_classification": "synthetic_no_private_data",
            "split": split,
        })
    MANIFEST.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(rows), "train": 6, "eval": 2, "manifest": str(MANIFEST)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
