import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from training.evaluation.validate_benchmark_manifest import git_blob_sha, main


class FrozenBenchmarkManifestTest(unittest.TestCase):
    def test_valid_frozen_suite_passes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            eval_dir = root / "training/evaluation"
            eval_dir.mkdir(parents=True)
            eval_path = eval_dir / "eval.jsonl"
            row = {
                "id": "case-1",
                "node_id": "00.core",
                "category": "core",
                "privacy_classification": "synthetic_no_personal_data",
                "messages": [{"role": "user", "content": "x"}],
                "evaluation": {"required_behaviors": ["does_not_guess"]},
            }
            eval_path.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            expected = git_blob_sha(eval_path)
            manifest = {
                "benchmark_id": "SVETLANA_FROZEN_BENCHMARK",
                "benchmark_version": "1.0",
                "evaluator_version": "structured-v2.2",
                "suites": [{
                    "suite_id": "suite-1",
                    "node_prefix": "00.",
                    "eval_path": "training/evaluation/eval.jsonl",
                    "eval_git_blob_sha": expected,
                    "evaluator": "custom_behavior",
                    "status": "READY_FOR_EVAL",
                }],
            }
            (eval_dir / "FROZEN_BENCHMARK_MANIFEST_V1.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )
            self.assertEqual(main(root), 0)

    def test_changed_suite_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            eval_dir = root / "training/evaluation"
            eval_dir.mkdir(parents=True)
            eval_path = eval_dir / "eval.jsonl"
            eval_path.write_text(
                json.dumps({
                    "id": "case-1",
                    "node_id": "00.core",
                    "category": "core",
                    "privacy_classification": "synthetic_no_personal_data",
                    "messages": [{"role": "user", "content": "x"}],
                    "evaluation": {"required_behaviors": ["does_not_guess"]},
                }) + "\n",
                encoding="utf-8",
            )
            locked = git_blob_sha(eval_path)
            eval_path.write_text(
                json.dumps({
                    "id": "case-1",
                    "node_id": "00.core",
                    "category": "core",
                    "privacy_classification": "synthetic_no_personal_data",
                    "messages": [{"role": "user", "content": "changed"}],
                    "evaluation": {"required_behaviors": ["does_not_guess"]},
                }) + "\n",
                encoding="utf-8",
            )
            manifest = {
                "benchmark_id": "SVETLANA_FROZEN_BENCHMARK",
                "benchmark_version": "1.0",
                "evaluator_version": "structured-v2.2",
                "suites": [{
                    "suite_id": "suite-1",
                    "node_prefix": "00.",
                    "eval_path": "training/evaluation/eval.jsonl",
                    "eval_git_blob_sha": locked,
                    "evaluator": "custom_behavior",
                    "status": "READY_FOR_EVAL",
                }],
            }
            (eval_dir / "FROZEN_BENCHMARK_MANIFEST_V1.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )
            self.assertEqual(main(root), 1)


if __name__ == "__main__":
    unittest.main()
