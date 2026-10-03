from pathlib import Path

from training.datasets.audit_training_corpus import audit_manifest


ROOT = Path(__file__).resolve().parents[2]


def test_audit_reports_manifest_totals_and_file_hashes():
    report = audit_manifest(ROOT)

    assert report["base_model"] == "google/gemma-4-E2B-it"
    assert report["totals"]["train_records"] > 0
    assert report["totals"]["eval_records"] > 0
    assert report["groups"]["train"]
    for item in report["groups"]["train"] + report["groups"]["eval"]:
        assert len(item["sha256"]) == 64
        assert item["records"] > 0


def test_audit_exposes_behavior_coverage_without_claiming_quality_pass():
    report = audit_manifest(ROOT)
    signals = [
        item["behavior_signal_records"]
        for item in report["groups"]["train"]
    ]
    assert any(item["verification"] > 0 for item in signals)
    assert any(item["uncertainty"] > 0 for item in signals)
