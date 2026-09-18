#!/usr/bin/env python3
"""Real Gemma 4 tokenizer preflight for assistant-only SFT masking."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from train_svetlana_production import format_dataset, load_training_dataset, tokenize_dataset, validate_manifest

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="google/gemma-4-E2B-it")
    parser.add_argument("--max-length", type=int, default=2048)
    args = parser.parse_args()
    from transformers import AutoTokenizer
    root = Path(__file__).resolve().parents[2]
    manifest = validate_manifest(root / "training/datasets/manifest_v2.json", root)
    if manifest.get("base_model") != args.model:
        raise RuntimeError(f"Manifest base model {manifest.get('base_model')!r} != requested {args.model!r}")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    train, evaluation, paths = load_training_dataset(manifest)
    tokenized = tokenize_dataset(format_dataset(train, tokenizer), tokenizer, args.max_length)
    tokenized_eval = tokenize_dataset(format_dataset(evaluation, tokenizer), tokenizer, args.max_length)
    def summarize(label, dataset):
        loss_tokens = sum(dataset["_assistant_loss_tokens"])
        truncated = sum(dataset["_was_truncated"])
        zero = sum(1 for n in dataset["_assistant_loss_tokens"] if n == 0)
        if zero:
            raise RuntimeError(f"{label}: {zero} examples have zero assistant loss tokens")
        print(json.dumps({"event":"real_tokenizer_assistant_loss_preflight","label":label,
                          "records":len(dataset),"assistant_loss_tokens":loss_tokens,
                          "truncated_records":truncated,"zero_loss_records":zero,
                          "max_seq_length":args.max_length,"model":args.model,
                          "dataset_paths":paths}, ensure_ascii=False))
    summarize("train", tokenized)
    summarize("eval", tokenized_eval)
    print(json.dumps({"event":"real_tokenizer_preflight_complete","status":"PASS",
                      "model":args.model,"max_seq_length":args.max_length}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
