import unittest

from training.evaluation.run_action_eval import extract_tool_calls


class ActionEvalParserTests(unittest.TestCase):
    def test_gemma4_nested_arguments(self):
        text = '<|tool_call>call:tasks.create{"title":"Позвонить клиенту","meta":{"priority":"high"}}<tool_call|>'
        calls = extract_tool_calls(text)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["name"], "tasks.create")
        self.assertEqual(calls[0]["arguments"]["title"], "Позвонить клиенту")
        self.assertEqual(calls[0]["arguments"]["meta"]["priority"], "high")

    def test_gemma4_multiple_calls(self):
        text = (
            '<|tool_call>call:calendar.find_events{"query":"встреча"}<tool_call|>'
            '<|tool_call>call:tasks.get{"task_id":"t1"}<tool_call|>'
        )
        calls = extract_tool_calls(text)
        self.assertEqual([c["name"] for c in calls], ["calendar.find_events", "tasks.get"])

    def test_invalid_call_is_not_accepted(self):
        text = '<|tool_call>call:tasks.create{"title":<tool_call|>'
        self.assertEqual(extract_tool_calls(text), [])


if __name__ == "__main__":
    unittest.main()
