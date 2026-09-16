from pathlib import Path


SCRIPT = Path(__file__).with_name("run_colab_go.sh").read_text(encoding="utf-8")


def test_multimodal_generation_and_validation_happen_before_training():
    generate = SCRIPT.index("python training/datasets/multimodal/generate_synthetic_images.py")
    validate = SCRIPT.index("python training/datasets/multimodal/validate_image_corpus.py")
    training = SCRIPT.index("python training/gemma4/train_svetlana_smoke.py")
    assert generate < validate < training


def test_validator_uses_generated_manifest():
    assert "training/datasets/multimodal/image_training_records.jsonl" in SCRIPT


def test_cuda_gate_precedes_multimodal_work():
    cuda_gate = SCRIPT.index("if not torch.cuda.is_available():")
    generate = SCRIPT.index("python training/datasets/multimodal/generate_synthetic_images.py")
    assert cuda_gate < generate
