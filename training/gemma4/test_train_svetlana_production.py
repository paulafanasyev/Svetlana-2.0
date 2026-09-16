from pathlib import Path

import pytest

from training.gemma4.train_svetlana_production import load_config
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
