import json
import tempfile
import unittest
from pathlib import Path

from training.evaluation.compare_frozen_benchmark import main


class FrozenBenchmarkComparisonTest(unittest.TestCase):
    def test_comparison_records_delta_and_regression(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "training/evaluation").mkdir(parents=True)
            (root / "base").mkdir()
            (root / "candidate").mkdir()
            manifest = {
                "benchmark_id": "SVETLANA_FROZEN_BENCHMARK",
                "benchmark_version": "1.0",
                "suites": [{
                    "suite_id": "core_knowledge_skeleton_v1",
                    "node_prefix": "00.",
                    "eval_path": "training/evaluation/eval.jsonl",
                    "evaluator": "custom_behavior",
                    "status": "READY_FOR_EVAL"
                }]
            }
            evaluation = {
                "id": "case-1",
                "node_id": "00.core",
                "category": "core",
                "privacy_classification": "synthetic_no_personal_data",
                "messages": [{"role": "user", "content": "x"}],
                "evaluation": {"required_behaviors": ["does_not_guess"]}
            }
            (root / "training/evaluation/FROZEN_BENCHMARK_MANIFEST_V1.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )
            (root / "training/evaluation/eval.jsonl").write_text(
                json.dumps(evaluation) + "\n", encoding="utf-8"
            )
            (root / "base/core_knowledge_skeleton_v1.jsonl").write_text(
                json.dumps({"id": "case-1", "generated": "Не буду угадывать."}) + "\n",
                encoding="utf-8"
            )
            (root / "candidate/core_knowledge_skeleton_v1.jsonl").write_text(
                json.dumps({"id": "case-1", "generated": "Сделаю предположение."}) + "\n",
                encoding="utf-8"
            )
            config = root / "generation.json"
            config.write_text(json.dumps({"do_sample": False, "max_new_tokens": 160}), encoding="utf-8")
            output = root / "report.json"

            import sys
            old_argv = sys.argv
            try:
                sys.argv = [
                    "compare_frozen_benchmark.py",
                    "--manifest", str(root / "training/evaluation/FROZEN_BENCHMARK_MANIFEST_V1.json"),
                    "--baseline-dir", str(root / "base"),
                    "--candidate-dir", str(root / "candidate"),
                    "--baseline-model", "base",
                    "--candidate-model", "candidate",
                    "--eval-commit", "abc123",
                    "--generation-config", str(config),
                    "--output", str(output),
                ]
                self.assertEqual(main(), 0)
            finally:
                sys.argv = old_argv

            report = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["automated_comparison_status"], "VERIFIED")
            self.assertEqual(report["capability_status"], "NOT_PROVEN")
            self.assertEqual(report["regressions"], ["core_knowledge_skeleton_v1"])
            self.assertEqual(report["scores"]["baseline_pass_rate"], 1.0)
            self.assertEqual(report["scores"]["candidate_pass_rate"], 0.0)


if __name__ == "__main__":
    unittest.main()
