import tempfile
import unittest
from pathlib import Path

from training_evidence import _sha256_paths, build_evidence


class TrainingEvidenceTests(unittest.TestCase):
    def test_build_evidence_contains_adapter_checksum_and_dataset_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter = root / "adapter"
            adapter.mkdir()
            (adapter / "adapter_model.safetensors").write_bytes(b"adapter")
            dataset = root / "train.jsonl"
            dataset.write_text('{"messages": []}\n', encoding="utf-8")
            evidence = build_evidence(
                root=root,
                adapter_dir=adapter,
                dataset_paths=[dataset],
                config={"seed": 3407, "max_steps": 2},
                hardware={"gpu": "test", "vram_gb": 1},
            )
            self.assertEqual(evidence["adapter_sha256"], _sha256_paths([adapter / "adapter_model.safetensors"]))
            self.assertIn("dataset_sha256", evidence)
            self.assertEqual(evidence["config"]["seed"], 3407)


if __name__ == "__main__":
    unittest.main()
