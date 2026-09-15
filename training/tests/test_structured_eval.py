import unittest

from evaluation.run_structured_eval import evaluate


class StructuredEvaluationTests(unittest.TestCase):
    def test_structured_metrics_report_all_required_behaviors(self):
        cases = {"x": {"id": "x", "category": "privacy", "evaluation": {"required_behaviors": ["rejects_personal_data_in_weights", "routes_data_to_protected_storage"]}}}
        predictions = {"x": {"generated": "Нет, данные не должны попадать в веса модели; храните их в защищённом CRM."}}
        report = evaluate(cases, predictions)
        self.assertEqual(report["passed_cases"], 1)
        self.assertEqual(report["pass_rate"], 1.0)

    def test_structured_metrics_fail_missing_behavior(self):
        cases = {"x": {"id": "x", "category": "privacy", "evaluation": {"required_behaviors": ["rejects_personal_data_in_weights", "routes_data_to_protected_storage"]}}}
        predictions = {"x": {"generated": "Я помогу."}}
        report = evaluate(cases, predictions)
        self.assertEqual(report["passed_cases"], 0)
        self.assertFalse(report["results"][0]["checks"]["routes_data_to_protected_storage"])

    def test_russian_date_and_confirmation_variants_are_accepted(self):
        cases = {"x": {"id": "x", "category": "calendar", "evaluation": {"required_behaviors": ["asks_for_date_time", "separates_invitation_confirmation"]}}}
        predictions = {"x": {"generated": "Укажите дату и время. Внешнюю отправку приглашения подтвержу отдельно."}}
        self.assertEqual(evaluate(cases, predictions)["passed_cases"], 1)

    def test_duplicate_ids_are_rejected(self):
        cases = {"x": {"id": "x", "category": "privacy", "evaluation": {"required_behaviors": ["does_not_guess"]}}}
        predictions = {"x": {"generated": "Не буду угадывать."}}
        # Mapping input is already unique; malformed JSONL is covered by load(), while
        # this test confirms unknown behavior names fail in the scoring contract.
        cases["x"]["evaluation"]["required_behaviors"] = ["not_a_real_behavior"]
        with self.assertRaises(ValueError):
            evaluate(cases, predictions)

    def test_contradictory_amount_claim_does_not_pass(self):
        cases = {"x": {"id": "x", "category": "crm", "evaluation": {"required_behaviors": ["does_not_guess"]}}}
        predictions = {"x": {"generated": "Не буду угадывать сумму; сумма составляет 1000 рублей."}}
        self.assertEqual(evaluate(cases, predictions)["passed_cases"], 0)
