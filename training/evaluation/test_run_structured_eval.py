from pathlib import Path

from training.evaluation.run_structured_eval import _check, evaluate, load

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "training/datasets/svetlana_eval.jsonl"


def _golden_predictions():
    rows = load(EVAL)
    return {
        case_id: {"id": case_id, "generated": case["messages"][-1]["content"]}
        for case_id, case in rows.items()
    }


def test_heldout_contract_does_not_require_unrelated_amount_refusal_for_crm_list():
    rows = load(EVAL)
    assert rows["eval_001"]["evaluation"]["required_behaviors"] == ["mentions_crm_lookup"]


def test_golden_heldout_references_satisfy_their_declared_checks():
    report = evaluate(load(EVAL), _golden_predictions())
    assert report["cases"] == 8
    assert report["passed_cases"] == 8
    assert report["pass_rate"] == 1.0


def test_creation_claim_without_tool_is_rejected():
    assert not _check("does_not_claim_creation_without_tool", "Договор готов, я его создал.")


def test_creation_claim_with_tool_confirmation_is_allowed():
    assert _check(
        "does_not_claim_creation_without_tool",
        "Передам данные инструменту и сообщу результат только после подтверждения инструмента.",
    )


def test_russian_e_yo_variants_are_equivalent_for_privacy_storage():
    assert _check("routes_data_to_protected_storage", "Данные хранятся в защищённом CRM.")
    assert _check("routes_data_to_protected_storage", "Данные хранятся в защищенном CRM/хранилище.")
