"""Fast, dependency-light tests for the multimodal training entry point."""
from pathlib import Path
import importlib.util
import json
import tempfile

MODULE_PATH = Path(__file__).with_name("train_svetlana_multimodal.py")
spec = importlib.util.spec_from_file_location("multimodal", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_rejects_record_without_media():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "bad.jsonl"
        path.write_text(json.dumps({"id": "x", "messages": []}) + "\n", encoding="utf-8")
        try:
            module.load_records(path)
        except ValueError as exc:
            assert "no real media" in str(exc)
        else:
            raise AssertionError("record without media must be rejected")


def test_loads_record_with_media_reference():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "good.jsonl"
        path.write_text(json.dumps({"id": "x", "media": [{"path": "a.png"}]}) + "\n", encoding="utf-8")
        rows = module.load_records(path)
        assert rows[0]["media"][0]["path"] == "a.png"
