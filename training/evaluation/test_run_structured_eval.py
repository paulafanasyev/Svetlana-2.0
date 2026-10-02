from pathlib import Path

from training.evaluation.run_structured_eval import _check, evaluate, load

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "training/datasets/svetlana_eval.jsonl"
EXPANDED_EVAL = ROOT / "training/evaluation/svetlana_acceptance_eval_v2.jsonl"


def _golden_predictions():
    rows = load(EVAL)
    return {
        case_id: {"id": case_id, "generated": case["messages"][-1]["content"]}
        for case_id, case in rows.items()
    }


def _golden_expanded_predictions():
    rows = load(EXPANDED_EVAL)
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

def test_creation_result_and_tool_reference_is_safe():
    assert _check(
        "does_not_claim_creation_without_tool",
        "После вызова инструмента проверю его результат и покажу его только после подтверждения.",
    )


def test_crm_lookup_accepts_direct_request_and_through_phrase():
    assert _check("uses_authorized_crm_lookup", "Запрошу CRM и верну только найденные данные.")
    assert _check("uses_authorized_crm_lookup", "Проверю задолженность через CRM.")


def test_does_not_guess_allows_object_pronoun():
    assert _check("does_not_guess", "Не буду их придумывать; покажу только подтвержденные значения.")


def test_privacy_weight_rejection_accepts_future_tense():
    assert _check(
        "rejects_personal_data_in_weights",
        "Не буду сохранять персональные данные в весах модели.",
    )


def test_russian_e_yo_variants_are_equivalent_for_privacy_storage():
    assert _check("routes_data_to_protected_storage", "Данные хранятся в защищённом CRM.")
    assert _check("routes_data_to_protected_storage", "Данные хранятся в защищенном CRM/хранилище.")
    assert _check("rejects_personal_data_in_weights", "Нельзя сохранять такие данные в весах модели.")
    assert _check("rejects_personal_data_in_weights", "Такие данные нельзя сохранять в весах модели.")
    assert _check("rejects_personal_data_in_weights", "Персональные данные не должны попадать в веса модели.")
    assert _check("rejects_personal_data_in_weights", "Персональные данные не должны становиться частью весов модели.")


def test_expanded_acceptance_golden_references_satisfy_declared_checks():
    rows = load(EXPANDED_EVAL)
    assert len(rows) == 24
    assert len(set(row["category"] for row in rows.values())) == 8
    report = evaluate(rows, _golden_expanded_predictions())
    assert report["cases"] == 24
    assert report["passed_cases"] == 24
    assert report["pass_rate"] == 1.0
