#!/usr/bin/env python3
"""Strict audit for native Gemma4 action/tool-orchestration SFT assets."""
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
TRAIN=ROOT/"training/datasets/svetlana_action_training_v1.jsonl"
EVAL=ROOT/"training/datasets/svetlana_action_eval_v1.jsonl"
MANIFEST=ROOT/"training/datasets/manifest_v2.json"

def read(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

train=read(TRAIN); eval_rows=read(EVAL)
assert len(train)==29, len(train)
assert len(eval_rows)==15, len(eval_rows)

tool_calls=tool_results=0
for row in train:
    msgs=row.get("messages")
    assert isinstance(msgs,list) and msgs, row.get("id")
    assert all(isinstance(m,dict) and m.get("role") in {"system","user","assistant","tool"} for m in msgs), row.get("id")
    pending=set()
    for m in msgs:
        if m["role"]=="assistant" and m.get("tool_calls"):
            assert isinstance(m["tool_calls"],list) and m["tool_calls"], row["id"]
            for call in m["tool_calls"]:
                fn=call.get("function",{})
                assert isinstance(call.get("id"),str) and isinstance(fn.get("name"),str), row["id"]
                assert isinstance(fn.get("arguments",{}),dict), row["id"]
                pending.add(call["id"]); tool_calls+=1
        if m["role"]=="tool":
            assert isinstance(m.get("tool_call_id"),str), row["id"]
            assert m["tool_call_id"] in pending, row["id"]
            tool_results+=1
            pending.remove(m["tool_call_id"])
    assert not pending, row["id"]

train_ids={r["id"] for r in train}; eval_ids={r["id"] for r in eval_rows}
assert len(train_ids)==len(train) and len(eval_ids)==len(eval_rows)
assert not train_ids & eval_ids

for row in eval_rows:
    msgs=row.get("messages")
    assert isinstance(msgs,list) and msgs, row["id"]
    assert msgs[-1]["role"]=="assistant", row["id"]
    assert msgs[-1].get("content","")=="" and len(msgs[-1])==2, row["id"]
    meta=row.get("evaluation",{})
    assert isinstance(meta.get("expected_tools"),list), row["id"]
    assert isinstance(meta.get("expected_argument_signals"),list), row["id"]
    assert all(isinstance(x,bool) for x in [meta.get("tool_required"),meta.get("execution_required"),meta.get("no_fake_execution"),meta.get("human_review_required")]), row["id"]

manifest=json.loads(MANIFEST.read_text(encoding="utf-8"))
train_paths=[x["path"] for x in manifest["train"]]
assert str(TRAIN.relative_to(ROOT)) in train_paths
assert str(EVAL.relative_to(ROOT)) not in train_paths
print(json.dumps({
    "status":"PASS",
    "action_train_records":len(train),
    "action_eval_records":len(eval_rows),
    "native_tool_call_records":tool_calls,
    "native_tool_result_records":tool_results,
    "no_eval_in_action_train":True
},ensure_ascii=False))
