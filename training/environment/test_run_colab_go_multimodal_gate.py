from pathlib import Path


SCRIPT = Path(__file__).with_name("run_colab_go.sh").read_text(encoding="utf-8")
WORKFLOW = (Path(__file__).resolve().parents[2] / ".github/workflows/training-validation.yml").read_text(encoding="utf-8")


def test_multimodal_generation_and_validation_happen_before_training():
    generate = SCRIPT.index("python training/datasets/multimodal/generate_synthetic_images.py")
    validate = SCRIPT.index("python training/datasets/multimodal/validate_image_corpus.py")
    training = SCRIPT.index("python training/gemma4/train_svetlana_production.py")
    assert generate < validate < training


def test_validator_uses_generated_manifest():
    assert "training/datasets/multimodal/image_training_records.jsonl" in SCRIPT


def test_cuda_gate_precedes_multimodal_work():
    cuda_gate = SCRIPT.index("if not torch.cuda.is_available():")
    generate = SCRIPT.index("python training/datasets/multimodal/generate_synthetic_images.py")
    assert cuda_gate < generate


def test_production_mode_selects_production_runner_and_adapter():
    assert 'if [[ "$MODE" == "text_production" ]]; then' in SCRIPT
    assert "python training/gemma4/train_svetlana_production.py" in SCRIPT
    assert 'ADAPTER="training/gemma4/outputs/svetlana_gemma4_e2b_production/adapter"' in SCRIPT


def test_smoke_mode_remains_explicit_fallback():
    assert 'elif [[ "$MODE" == "text_smoke" ]]; then' in SCRIPT
    assert "python training/gemma4/train_svetlana_smoke.py" in SCRIPT


def test_expanded_text_training_is_not_blocked_by_multimodal_readiness_rule():
    assert "mode == 'multimodal_agent'" in SCRIPT
    assert "training_mode_gate_pass" in SCRIPT


def test_baseline_is_measurement_only():
    assert 'SVETLANA_MIN_BASELINE_PASS_RATE' not in SCRIPT
    assert '"status": "MEASURED_ONLY"' in SCRIPT
    assert "BASELINE_GATE_FAIL" not in SCRIPT


def test_adapter_artifact_must_be_non_empty():
    assert 'test -d "$ADAPTER"' in SCRIPT
    assert 'test -n "$(find "$ADAPTER" -type f -print -quit)"' in SCRIPT
