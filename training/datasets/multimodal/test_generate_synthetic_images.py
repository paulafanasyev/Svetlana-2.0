from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile

MODULE_PATH = Path(__file__).with_name("generate_synthetic_images.py")
spec = importlib.util.spec_from_file_location("generator", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_specs_are_unique_and_have_train_eval_split():
    ids = [item[0] for item in module.SPECS]
    assert len(ids) == len(set(ids))
    assert len(module.SPECS) == 8


def test_generated_png_is_deterministic_and_hashable():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "sample.png"
        module.make_image("screen_understanding", "dashboard", 1).save(path, format="PNG", optimize=False)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert len(digest) == 64
        assert path.read_bytes() == path.read_bytes()


def test_record_contract_contains_media_and_privacy_fields():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        module.ASSET_DIR = root / "synthetic_images"
        module.MANIFEST = root / "records.jsonl"
        module.main()
        rows = [json.loads(line) for line in module.MANIFEST.read_text(encoding="utf-8").splitlines()]
        assert len(rows) == 8
        assert {row["split"] for row in rows} == {"train", "eval"}
        for row in rows:
            assert row["media"][0]["license"] == "synthetic"
            assert len(row["media"][0]["sha256"]) == 64
            assert row["privacy_classification"] == "synthetic_no_private_data"
            media_path = Path(row["media"][0]["path"])
            assert media_path.is_file()
