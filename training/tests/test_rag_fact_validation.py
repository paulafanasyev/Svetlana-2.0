import json
import tempfile
import unittest
from pathlib import Path

from validate_training import validate_jsonl_splits


class RagFactValidationTests(unittest.TestCase):
    def _valid(self):
        return {
            "id": "rag_1",
            "record_type": "RAG_FACT",
            "messages": [{"role": "user", "content": "Что указано в источнике?"}],
            "privacy_classification": "synthetic_no_personal_data",
            "privacy": "synthetic_no_personal_data",
            "source_url": "https://www.cbr.ru/finprosvet/",
            "source_type": "official_primary",
            "authority": "Банк России",
            "verified_at": "2026-09-17",
            "jurisdiction": "Российская Федерация",
            "legal_status": "in_force",
            "effective_date": "2026-01-01",
            "supersedes": None,
            "confidence": 1.0,
        }

    def _write(self, root, row):
        path = root / "train.jsonl"
        path.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
        return path

    def test_valid_rag_fact_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            validate_jsonl_splits([self._write(root, self._valid())], [], root)

    def test_missing_rag_fact_provenance_field_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            row = self._valid()
            del row["source_url"]
            with self.assertRaisesRegex(ValueError, "RAG_FACT.*source_url"):
                validate_jsonl_splits([self._write(root, row)], [], root)

    def test_rag_fact_rejects_boolean_confidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            row = self._valid()
            row["confidence"] = True
            with self.assertRaisesRegex(ValueError, "confidence"):
                validate_jsonl_splits([self._write(root, row)], [], root)

    def test_rag_fact_allows_unknown_without_effective_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            row = self._valid()
            row["legal_status"] = "unknown"
            row["effective_date"] = None
            validate_jsonl_splits([self._write(root, row)], [], root)


if __name__ == "__main__":
    unittest.main()
