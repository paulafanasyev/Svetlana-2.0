from training.evaluation.compare_reports import category_regressions


def _report(categories):
    cases = sum(value["cases"] for value in categories.values())
    passed = sum(value["passed_cases"] for value in categories.values())
    return {
        "label": "test",
        "cases": cases,
        "passed_cases": passed,
        "pass_rate": passed / cases if cases else 0.0,
        "results": [],
        "categories": categories,
    }


def test_category_regressions_empty_when_adapter_improves_or_matches():
    baseline = _report({
        "calendar": {"cases": 3, "passed_cases": 1, "pass_rate": 1 / 3},
        "crm": {"cases": 3, "passed_cases": 2, "pass_rate": 2 / 3},
    })
    adapter = _report({
        "calendar": {"cases": 3, "passed_cases": 2, "pass_rate": 2 / 3},
        "crm": {"cases": 3, "passed_cases": 2, "pass_rate": 2 / 3},
    })
    assert category_regressions(baseline, adapter) == []


def test_category_regressions_detects_single_category_drop():
    baseline = _report({
        "calendar": {"cases": 3, "passed_cases": 2, "pass_rate": 2 / 3},
        "crm": {"cases": 3, "passed_cases": 1, "pass_rate": 1 / 3},
    })
    adapter = _report({
        "calendar": {"cases": 3, "passed_cases": 1, "pass_rate": 1 / 3},
        "crm": {"cases": 3, "passed_cases": 2, "pass_rate": 2 / 3},
    })
    assert category_regressions(baseline, adapter) == [{
        "category": "calendar",
        "baseline_passed_cases": 2,
        "adapter_passed_cases": 1,
        "baseline_pass_rate": 2 / 3,
        "adapter_pass_rate": 1 / 3,
    }]
