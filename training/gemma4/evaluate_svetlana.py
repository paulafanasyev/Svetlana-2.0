"""Held-out evaluation for the trained Svetlana Gemma 4 E2B LoRA adapter.

Run this in the same Colab environment after train_svetlana_smoke.py. The
adapter is loaded directly by Unsloth; this does not merge weights and does
not claim LiteRT-LM compatibility.
"""
import json
import os
import re
from pathlib import Path

import torch
from unsloth import FastLanguageModel

ROOT = Path(__file__).resolve().parents[1]
EVAL = ROOT / "datasets" / "svetlana_eval.jsonl"
ADAPTER = ROOT / "outputs" / "svetlana_gemma4_e2b_smoke" / "adapter"
OUT = ROOT / "outputs" / "svetlana_gemma4_e2b_eval.json"
MODEL = os.getenv("SVETLANA_BASE_MODEL", "google/gemma-4-E2B-it")
MAX_SEQ = int(os.getenv("SVETLANA_MAX_SEQ_LENGTH", "1024"))
MAX_NEW = int(os.getenv("SVETLANA_EVAL_MAX_NEW_TOKENS", "160"))

if not torch.cuda.is_available():
    raise RuntimeError("No CUDA GPU detected. Evaluation must run on the Colab GPU for this harness.")
if not ADAPTER.exists():
    raise FileNotFoundError(f"LoRA adapter not found: {ADAPTER}")

cases = [json.loads(line) for line in EVAL.read_text(encoding="utf-8").splitlines() if line.strip()]

# These are behavioral gates, not a substitute for human/LLM quality review.
RUBRIC = {
    "crm": {"any": ["CRM", "клиент", "сделк"], "all": ["актуаль"]},
    "legal_verification": {"any": ["ФНС", "официальн", "провер"], "all": []},
    "confirmation": {"any": ["подтвержден", "подтвержд", "соглас", "перед фактической отправкой"], "all": []},
    "documents": {"any": ["инструмент", "подтвержд", "данные"], "all": []},
    "calendar": {"any": ["дата", "время", "календар"], "all": []},
    "missing_data": {"any": ["не буду", "не угада", "CRM", "актуаль"], "all": []},
    "official_source": {"any": ["ФНС", "официальн", "ссылк"], "all": []},
    "privacy": {"any": ["CRM", "хранилищ", "вес", "персональн"], "all": []},
}

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=str(ADAPTER),
    max_seq_length=MAX_SEQ,
    dtype=None,
    load_in_4bit=True,
)
FastLanguageModel.for_inference(model)
model.eval()

results = []
for case in cases:
    messages = [m for m in case["messages"] if m["role"] != "assistant"]
    prompt_ids = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to("cuda")
    with torch.inference_mode():
        output_ids = model.generate(
            input_ids=prompt_ids,
            max_new_tokens=MAX_NEW,
            do_sample=False,
            use_cache=True,
            pad_token_id=tokenizer.eos_token_id,
        )
    generated = tokenizer.decode(output_ids[0][prompt_ids.shape[-1]:], skip_special_tokens=True).strip()
    text = generated.lower()
    rubric = RUBRIC[case["category"]]
    any_hits = [term for term in rubric["any"] if term.lower() in text]
    all_hits = [term for term in rubric["all"] if term.lower() in text]
    passed = bool(any_hits) and len(all_hits) == len(rubric["all"])
    results.append({
        "id": case["id"],
        "category": case["category"],
        "passed_behavioral_gate": passed,
        "any_hits": any_hits,
        "all_hits": all_hits,
        "generated": generated,
        "reference": case["messages"][-1]["content"],
    })

summary = {
    "event": "eval_complete",
    "adapter": str(ADAPTER),
    "model": MODEL,
    "cases": len(results),
    "behavioral_gate_passed": sum(r["passed_behavioral_gate"] for r in results),
    "results": results,
    "note": "Behavioral keyword gates are diagnostic only; this is not a proof of production quality, legal correctness, or LiteRT-LM compatibility.",
}
OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({
    "event": "eval_complete",
    "cases": len(results),
    "behavioral_gate_passed": summary["behavioral_gate_passed"],
    "output": str(OUT),
}, ensure_ascii=False))
for result in results:
    print(json.dumps({
        "id": result["id"],
        "category": result["category"],
        "passed_behavioral_gate": result["passed_behavioral_gate"],
        "generated": result["generated"],
    }, ensure_ascii=False))
