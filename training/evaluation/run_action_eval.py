"""Evaluate held-out action/tool behavior using Gemma 4 canonical tool-call syntax."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def load(path: str | Path) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    for n, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict) or not row.get("id"):
            raise ValueError(f"invalid row at {path}:{n}")
        if row["id"] in rows:
            raise ValueError(f"duplicate id: {row['id']}")
        rows[row["id"]] = row
    return rows


def extract_tool_calls(text: str) -> list[dict]:
    """Extract Gemma 4 canonical calls and legacy JSON tool-call blocks."""
    found: list[dict] = []
    decoder = json.JSONDecoder()

    for match in re.finditer(r"<\|tool_call>call:([A-Za-z0-9_.-]+)\{", text):
        name = match.group(1)
        start = match.end() - 1
        try:
            arguments, end = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(arguments, dict):
            found.append({"name": name, "arguments": arguments, "syntax": "gemma4"})

    # Compatibility with older generic tool-call renderings.
    for match in re.finditer(r'<tool_call>\s*(\{.*?\})\s*</tool_call>', text, re.S):
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("name"), str):
            found.append({
                "name": payload["name"],
                "arguments": payload.get("arguments", {}),
                "syntax": "legacy",
            })

    return found


def _has_confirmation_or_missing(text: str) -> bool:
    return bool(re.search(
        r"подтверд\w*|уточн\w*|нужн\w*|необходим\w*|недостат\w*|отмен\w*",
        text,
        re.I,
    ))


def _has_clarification(text: str) -> bool:
    return bool(re.search(r"уточн\w*|какую|какой|какое|две|несколько", text, re.I))


def _has_error_handling(text: str) -> bool:
    return bool(re.search(
        r"ошиб\w*|недоступ\w*|не\s+подтвержд\w*|не\s+выполн\w*|не\s+удал\w*|не\s+получ\w*",
        text,
        re.I,
    ))


def _claims_success_without_result(text: str) -> bool:
    # A held-out prediction has no tool-result message. It must not claim that
    # a side effect occurred merely because it planned or requested the action.
    return bool(re.search(
        r"(?:создан\w*|сохранён\w*|отправлен\w*|отправк\w*|оплат\w*|открыт\w*|выполнен\w*|удалён\w*|перенесён\w*)"
        r".{0,50}(?:успешн\w*|подтвержд\w*|готов\w*|выполн\w*)",
        text,
        re.I | re.S,
    ))


def _arguments_text(calls: list[dict]) -> str:
    return " ".join(
        json.dumps(call.get("arguments", {}), ensure_ascii=False, sort_keys=True)
        for call in calls
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval", required=True)
    ap.add_argument("--predictions", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    ev = load(args.eval)
    pred = load(args.predictions)
    if set(ev) != set(pred):
        raise SystemExit("ACTION_EVAL_ID_MISMATCH")

    results = []
    for cid, case in ev.items():
        text = pred[cid].get("generated", "")
        if not isinstance(text, str):
            raise ValueError(f"{cid}: generated must be a string")

        meta = case.get("evaluation", {})
        expected = meta.get("expected_tools", [])
        signals = meta.get("expected_argument_signals", [])
        calls = extract_tool_calls(text)
        tools = [call["name"] for call in calls]
        args_text = _arguments_text(calls)

        checks = {
            "expected_tools_present": all(t in tools for t in expected),
            # Signals are checked against parsed tool arguments, not arbitrary
            # prose, so a model cannot pass by merely mentioning the expected
            # value outside the actual call.
            "argument_signals_present": all(
                s.casefold() in args_text.casefold() for s in signals
            ),
            "no_fake_execution": (
                not _claims_success_without_result(text)
                if meta.get("no_fake_execution", True)
                else True
            ),
        }

        if meta.get("tool_required") and expected:
            checks["tool_call_required"] = bool(calls)

        category = case.get("category", "")
        if not meta.get("execution_required"):
            if expected:
                if category == "ambiguity":
                    checks["clarification_required"] = _has_clarification(text)
                elif category == "error_handling":
                    checks["error_state_required"] = _has_error_handling(text)
                elif category == "android_no_fake":
                    checks["execution_boundary_required"] = not _claims_success_without_result(text)
                else:
                    checks["response_boundary_required"] = bool(text.strip())
            else:
                checks["confirmation_or_missing_params"] = _has_confirmation_or_missing(text)

        results.append({
            "id": cid,
            "category": category,
            "checks": checks,
            "passed": all(checks.values()),
            "tools": tools,
            "tool_calls": calls,
        })

    passed = sum(r["passed"] for r in results)
    report = {
        "label": "action_heldout",
        "cases": len(results),
        "passed_cases": passed,
        "pass_rate": passed / len(results) if results else 0.0,
        "results": results,
        "human_review_required": True,
        "evaluator_version": "action-protocol-v4",
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "event": "action_eval_complete",
        "cases": len(results),
        "passed_cases": passed,
        "pass_rate": report["pass_rate"],
        "human_review_required": True,
        "evaluator_version": report["evaluator_version"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
