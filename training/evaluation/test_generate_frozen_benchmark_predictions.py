import json
import tempfile
import unittest
from pathlib import Path

from training.evaluation.generate_frozen_benchmark_predictions import _load_eval_cases, _prepare_messages


class FrozenPredictionRunnerTest(unittest.TestCase):
    def test_eval_loader_accepts_reference_and_prepares_prompt(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "eval.jsonl"
            path.write_text(
                json.dumps({
                    "id": "case-1",
                    "node_id": "00.core",
                    "messages": [
                        {"role": "system", "content": "system"},
                        {"role": "user", "content": "question"},
                        {"role": "assistant", "content": "reference"},
                    ],
                    "privacy_classification": "synthetic_no_personal_data",
                    "evaluation": {"required_behaviors": ["does_not_guess"]},
                }) + "\n",
                encoding="utf-8",
            )
            cases = _load_eval_cases(path)
            self.assertEqual([c["id"] for c in cases], ["case-1"])
            self.assertEqual(
                _prepare_messages(cases[0]),
                [
                    {"role": "system", "content": [{"type": "text", "text": "system"}]},
                    {"role": "user", "content": [{"type": "text", "text": "question"}]},
                ],
            )

    def test_eval_loader_rejects_missing_assistant_reference(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "eval.jsonl"
            path.write_text(
                json.dumps({
                    "id": "case-1",
                    "messages": [{"role": "user", "content": "question"}],
                }) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                _load_eval_cases(path)


if __name__ == "__main__":
    unittest.main()
