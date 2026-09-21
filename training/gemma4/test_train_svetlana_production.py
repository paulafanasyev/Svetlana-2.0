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
        "SVETLANA_SAVE_STEPS",
        "SVETLANA_LOGGING_STEPS",
        "SVETLANA_EVAL_STEPS",
    ):
        monkeypatch.delenv(name, raising=False)
    cfg = load_config()
    assert cfg["seed"] == 3407
    assert cfg["num_train_epochs"] == 3
    assert cfg["max_seq_length"] == 2048
    assert cfg["per_device_train_batch_size"] == 1
    assert cfg["gradient_accumulation_steps"] == 4
    assert cfg["save_steps"] == 25
    assert cfg["eval_steps"] == 25
    assert cfg["logging_steps"] == 5


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
    run_source = source[source.index("def run("):]
    assert 'os.environ["UNSLOTH_RETURN_LOGITS"] = "1"' in run_source
    assert run_source.index("import unsloth") < run_source.index("import torch")


def test_production_exports_to_adapter_subdirectory():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert 'adapter_dir = out / "adapter"' in source
    assert "model.save_pretrained(adapter_dir)" in source
    assert "tokenizer.save_pretrained(adapter_dir)" in source


def test_production_has_resumable_checkpoints():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert '"save_steps": int(os.getenv("SVETLANA_SAVE_STEPS", "25"))' in source
    assert 'save_total_limit=3' in source
    assert 'trainer.train(resume_from_checkpoint=checkpoint)' in source

def test_production_supports_evidence_only_recovery():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert '"--evidence-only"' in source
    assert "write_existing_evidence" in source
    assert 'training_result_path = out / "training_result.json"' in source
    assert "global_step" in source

def test_format_dataset_is_non_batched_and_splits_final_assistant_completion():
    class FakeDataset:
        column_names = ["messages", "id"]

        def map(self, fn, **kwargs):
            assert kwargs["batched"] is False
            assert kwargs["remove_columns"] == self.column_names
            rows = [
                {
                    "messages": [
                        {"role": "system", "content": "Система"},
                        {"role": "user", "content": "Привет"},
                        {"role": "assistant", "content": "Ответ"},
                    ],
                    "id": "1",
                },
                {
                    "messages": [
                        {"role": "user", "content": "Проверка"},
                        {"role": "assistant", "content": "Готово"},
                    ],
                    "id": "2",
                },
            ]
            converted = [fn(row) for row in rows]
            assert all(isinstance(row["prompt"], list) for row in converted)
            assert all(isinstance(row["completion"], list) for row in converted)
            assert all(row["completion"][0]["role"] == "assistant" for row in converted)
            return converted

    result = format_dataset(FakeDataset())
    assert len(result) == 2
    assert result[0]["prompt"][-1]["role"] == "user"
    assert result[0]["completion"][0]["content"] == "Ответ"


def test_format_dataset_rejects_examples_without_final_assistant():
    class FakeDataset:
        column_names = ["messages"]

        def map(self, fn, **kwargs):
            return fn({
                "messages": [
                    {"role": "user", "content": "Запрос"},
                    {"role": "user", "content": "Нет ответа"},
                ]
            })

    with pytest.raises(ValueError, match="end with an assistant message"):
        format_dataset(FakeDataset())


def test_production_uses_completion_only_sft_loss():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert "completion_only_loss=True" in source
    assert 'dataset_text_field="text"' not in source
    assert '"prompt": messages[:-1]' in source
    assert '"completion": [messages[-1]]' in source


def test_production_uses_explicit_warmup_steps():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert "warmup_steps=warmup_steps" in source
    assert "warmup_ratio=0.05" not in source

def test_production_requires_final_configured_optimizer_step():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert "if int(result.global_step) != total_steps:" in source
    assert '"expected_global_step": total_steps' in source


def test_evidence_recovery_requires_completed_training_steps():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert "expected_global_steps" in source
    assert "global_step != expected_global_steps" in source


def test_production_uses_full_linear_lora_and_zero_dropout():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert 'target_modules="all-linear"' in source
    assert "lora_dropout=0.0" in source
    assert 'target_modules=[' not in source


def test_training_objective_runtime_gate_is_present():
    source = Path(__file__).with_name("train_svetlana_production.py").read_text(encoding="utf-8")
    assert '"event": "training_objective_gate_pass"' in source
    assert "supervised_tokens <= 0" in source
    assert "supervised_tokens >= total_tokens" in source
