import json
import tempfile
import unittest
from pathlib import Path

from validate_training import validate_manifest, validate_jsonl_splits


class TrainingValidationTests(unittest.TestCase):
    def test_manifest_rejects_multimodal_mode_without_native_trainer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = {
                "schema_version": "1.1",
                "base_model": "google/gemma-4-E2B-it",
                "runtime_target": "LiteRT-LM",
                "training_mode": "multimodal_agent",
                "trainer": "training/gemma4/train_svetlana_smoke.py",
                "train": [],
                "reference_knowledge": [],
                "eval": [],
                "rules": {"do_not_start_training_until_multimodal_trainer_is_ready": True},
            }
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(ValueError, msg="multimodal mode must require a native multimodal trainer"):
                validate_manifest(root / "manifest.json", root)

    def test_jsonl_validator_rejects_missing_media_and_non_messages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dataset = root / "multimodal.jsonl"
            dataset.write_text(
                json.dumps({
                    "id": "mm_1",
                    "messages": [{"role": "user", "content": [{"type": "image", "path": "missing.png"}]}],
                    "media": [{"path": "missing.png", "sha256": "bad"}],
                }) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError, msg="missing media must fail validation"):
                validate_jsonl_splits([dataset], [], root)

    def test_jsonl_validator_rejects_train_eval_normalized_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            train = root / "train.jsonl"
            evaluation = root / "eval.jsonl"
            train.write_text(json.dumps({"messages": [{"role": "user", "content": "Hello  world"}]}) + "\n", encoding="utf-8")
            evaluation.write_text(json.dumps({"messages": [{"role": "user", "content": " hello world "}]}) + "\n", encoding="utf-8")
            with self.assertRaises(ValueError, msg="normalized train/eval duplicate must fail validation"):
                validate_jsonl_splits([train], [evaluation], root)

    def test_jsonl_validator_rejects_missing_privacy_classification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            train = root / "train.jsonl"
            train.write_text(json.dumps({"messages": [{"role": "user", "content": "Hello"}]}) + "\n", encoding="utf-8")
            with self.assertRaises(ValueError, msg="privacy classification is mandatory"):
                validate_jsonl_splits([train], [], root)


if __name__ == "__main__":
    unittest.main()
