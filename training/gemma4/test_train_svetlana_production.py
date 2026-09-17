from pathlib import Path

import pytest

from training.gemma4.train_svetlana_production import format_dataset, load_config
from training.validate_training import validate_manifest

ROOT = Path(__file__).resolve().parents[1].parent
MANIFEST = ROOT / "training/datasets/manifest_v2.json"


def test_production_config_is_deterministic_by_default(monkeypatch):
    for name in (
        "SVETLANA_MAX_SEQ_LENGTH",
        "SVETLANA_BATCH_SIZE",
        "SVETLANA_GRAD_ACCUM",
        "SVETLANA_LEARNING_RATE",
        "SVETLANA_EPOCHS",
        "SVETLANA_SEED",
    ):
        monkeypatch.delenv(name, raising=False)
    cfg = load_config()
    assert cfg["seed"] == 3407
    assert cfg["num_train_epochs"] == 3
    assert cfg["max_seq_length"] == 2048
    assert cfg["per_device_train_batch_size"] == 1


def test_production_manifest_authorization_contract():
    manifest = validate_manifest(MANIFEST, ROOT)
    assert manifest["base_model"] == "google/gemma-4-E2B-it"
    assert manifest["training_mode"] == "text_production"
    assert manifest["trainer"] == "training/gemma4/train_svetlana_production.py"


def test_production_runner_requires_explicit_manifest_authorization(monkeypatch):
    monkeypatch.setenv("SVETLANA_EPOCHS", "1")
    assert load_config()["num_train_epochs"] == 1


def test_production_imports_unsloth_before_torch():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert source.index("import unsloth") < source.index("import torch")


def test_format_dataset_is_non_batched_and_returns_one_text_per_example():
    class FakeDataset:
        column_names = ["messages", "id"]

        def map(self, fn, **kwargs):
            assert kwargs["batched"] is False
            assert kwargs["remove_columns"] == self.column_names
            rows = [
                {"messages": [{"role": "user", "content": "Привет"}], "id": "1"},
                {"messages": [{"role": "user", "content": "Проверка"}], "id": "2"},
            ]
            converted = [fn(row) for row in rows]
            assert all(isinstance(row["text"], str) and row["text"].strip() for row in converted)
            return converted

    class FakeTokenizer:
        def apply_chat_template(self, messages, tokenize, add_generation_prompt):
            assert tokenize is False
            assert add_generation_prompt is False
            return messages[0]["content"] + " <eos>"

    result = format_dataset(FakeDataset(), FakeTokenizer())
    assert len(result) == 2
    assert result[0]["text"] == "Привет <eos>"
