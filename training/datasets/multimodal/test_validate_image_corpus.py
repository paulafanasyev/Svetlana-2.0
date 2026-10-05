from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile

MODULE_PATH = Path(__file__).with_name("validate_image_corpus.py")
spec = importlib.util.spec_from_file_location("validator", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def _write_case(root: Path, sha: str = "") -> Path:
    media = root / "x.png"
    media.write_bytes(b"synthetic")
    digest = sha or hashlib.sha256(media.read_bytes()).hexdigest()
    row = {
        "id": "x", "modality": "image", "task": "screen_understanding",
        "messages": [{"role": "user", "content": "describe"}],
        "media": [{"type": "image", "path": "x.png", "sha256": digest,
                   "license": "synthetic", "provenance": "test"}],
        "privacy_classification": "synthetic_no_private_data", "split": "train"
    }
    path = root / "records.jsonl"
    path.write_text(json.dumps(row) + "\n", encoding="utf-8")
    return path


def test_valid_record_passes():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        path = _write_case(root)
        # Add an eval record so both required splits are exercised.
        row = json.loads(path.read_text().strip())
        row["id"] = "eval-x"
        row["split"] = "eval"
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        result = module.validate(path, root)
        assert result == {"status": "PASS", "records": 2, "train": 1, "eval": 1}


def test_sha_mismatch_is_rejected():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        path = _write_case(root, sha="0" * 64)
        try:
            module.validate(path, root)
        except ValueError as exc:
            assert "SHA mismatch" in str(exc)
        else:
            raise AssertionError("SHA mismatch must be rejected")


def test_non_synthetic_license_is_rejected():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        path = _write_case(root)
        text = path.read_text(encoding="utf-8").replace('"license": "synthetic"', '"license": "unknown"')
        path.write_text(text, encoding="utf-8")
        try:
            module.validate(path, root)
        except ValueError as exc:
            assert "unexpected license" in str(exc)
        else:
            raise AssertionError("unexpected license must be rejected")
