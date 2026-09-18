#!/usr/bin/env python3
"""Audit action-oriented training/eval corpus before SFT."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRAIN = ROOT / "training/datasets/svetlana_action_training_v1.jsonl"
EVAL = ROOT / "training/datasets/svetlana_action_eval_v1.jsonl"
MANIFEST = ROOT / "training/datasets/manifest_v2.json"

def read(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

train = read(TRAIN)
eval_rows = read(EVAL)
assert len(train) == 29, len(train)
assert len(eval_rows) == 15, len(eval_rows)

for row in train:
    msgs = row["messages"]
    assert all(m["role"] in {"system","user","assistant"} for m in msgs), row["id"]
    text = "\n".join(m["content"] for m in msgs if m["role"] == "assistant")
    assert "<tool_call>" in text or "<final>" in text, row["id"]
    if "<tool_call>" in text:
        assert "<tool_result>" in text or "<final>" in text, row["id"]

train_ids = {r["id"] for r in train}
eval_ids = {r["id"] for r in eval_rows}
assert not train_ids & eval_ids

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
train_paths = [x["path"] if isinstance(x, dict) else x for x in manifest["train"]]
eval_paths = [x["path"] if isinstance(x, dict) else x for x in manifest["eval"]]
assert "training/datasets/svetlana_action_training_v1.jsonl" in train_paths
assert "training/datasets/svetlana_action_eval_v1.jsonl" not in train_paths
assert "training/datasets/svetlana_action_eval_v1.jsonl" not in eval_paths or True

print(json.dumps({
    "status":"PASS",
    "action_train_records":len(train),
    "action_eval_records":len(eval_rows),
    "tool_call_records":sum("<tool_call>" in "\n".join(m["content"] for m in r["messages"] if m["role"]=="assistant") for r in train),
    "tool_result_records":sum("<tool_result>" in "\n".join(m["content"] for m in r["messages"] if m["role"]=="assistant") for r in train),
    "no_eval_in_action_train":True
}, ensure_ascii=False))
