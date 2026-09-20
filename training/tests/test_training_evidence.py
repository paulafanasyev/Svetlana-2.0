import tempfile
import unittest
from pathlib import Path

from training_evidence import _sha256_paths, build_evidence


class TrainingEvidenceTests(unittest.TestCase):
    def test_build_evidence_contains_adapter_checksum_and_dataset_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
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
            self.assertEqual(
                evidence["adapter_sha256"],
                _sha256_paths([adapter / "adapter_model.safetensors"], root=root),
            )
            self.assertIn("dataset_sha256", evidence)
            self.assertEqual(evidence["config"]["seed"], 3407)
            self.assertEqual(evidence["adapter_files"], ["adapter/adapter_model.safetensors"])

    def test_relative_adapter_path_is_resolved_before_relative_to_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            adapter = root / "outputs" / "adapter"
            adapter.mkdir(parents=True)
            (adapter / "README.md").write_text("adapter", encoding="utf-8")
            evidence = build_evidence(
                root=root,
                adapter_dir=Path("outputs/adapter") if Path.cwd() == root else adapter,
                dataset_paths=[],
                config={},
                hardware={},
            )
            self.assertEqual(evidence["adapter_files"], ["outputs/adapter/README.md"])

    def test_hash_is_stable_for_equivalent_repository_relative_paths(self):
        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            root1 = Path(tmp1).resolve()
            root2 = Path(tmp2).resolve()
            file1 = root1 / "data" / "train.jsonl"
            file2 = root2 / "data" / "train.jsonl"
            file1.parent.mkdir()
            file2.parent.mkdir()
            file1.write_bytes(b"same content")
            file2.write_bytes(b"same content")
            self.assertEqual(
                _sha256_paths([file1], root=root1),
                _sha256_paths([file2], root=root2),
            )

    def test_adapter_must_be_inside_repository_root(self):
        with tempfile.TemporaryDirectory() as root_tmp, tempfile.TemporaryDirectory() as outside_tmp:
            root = Path(root_tmp).resolve()
            outside = Path(outside_tmp).resolve()
            adapter = outside / "adapter"
            adapter.mkdir()
            with self.assertRaisesRegex(ValueError, "must be inside repository root"):
                build_evidence(
                    root=root,
                    adapter_dir=adapter,
                    dataset_paths=[],
                    config={},
                    hardware={},
                )


if __name__ == "__main__":
    unittest.main()
