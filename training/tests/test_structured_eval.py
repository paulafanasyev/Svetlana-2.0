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
