import unittest

from evaluation.compare_reports import validate_report


class ReportIntegrityTests(unittest.TestCase):
    def _report(self, passed=True):
        return {
            "label": "baseline",
            "cases": 1,
            "passed_cases": 1 if passed else 0,
            "pass_rate": 1.0 if passed else 0.0,
            "results": [{"id": "x", "category": "privacy", "checks": {"a": passed}, "passed": passed, "generated": "ok"}],
        }

    def test_string_boolean_is_rejected(self):
        report = self._report()
        report["results"][0]["passed"] = "false"
        with self.assertRaises(ValueError):
            validate_report(report, "baseline")

    def test_inconsistent_check_is_rejected(self):
        report = self._report()
        report["results"][0]["checks"]["a"] = False
        with self.assertRaises(ValueError):
            validate_report(report, "baseline")


if __name__ == "__main__":
    unittest.main()
