from training.evaluation.run_action_eval import extract_tool_calls


def test_gemma4_nested_arguments():
    text = '<|tool_call>call:tasks.create{"title":"Позвонить клиенту","meta":{"priority":"high"}}<tool_call|>'
    calls = extract_tool_calls(text)
    assert len(calls) == 1
    assert calls[0]["name"] == "tasks.create"
    assert calls[0]["arguments"]["title"] == "Позвонить клиенту"
    assert calls[0]["arguments"]["meta"]["priority"] == "high"


def test_gemma4_multiple_calls():
    text = (
        '<|tool_call>call:calendar.find_events{"query":"встреча"}<tool_call|>'
        '<|tool_call>call:tasks.get{"task_id":"t1"}<tool_call|>'
    )
    calls = extract_tool_calls(text)
    assert [c["name"] for c in calls] == ["calendar.find_events", "tasks.get"]


def test_invalid_call_is_not_accepted():
    text = '<|tool_call>call:tasks.create{"title":<tool_call|>'
    assert extract_tool_calls(text) == []
