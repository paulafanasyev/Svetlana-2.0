"""Generate held-out predictions for either base model or LoRA adapter."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Base model ID or adapter directory")
    parser.add_argument("--eval", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-seq-length", type=int, default=1024)
    parser.add_argument("--max-new-tokens", type=int, default=160)
    args = parser.parse_args()

    import torch
    from unsloth import FastLanguageModel

    if not torch.cuda.is_available():
        raise RuntimeError("Prediction generation requires CUDA; baseline is not proven without a real model runtime")
    model, tokenizer = FastLanguageModel.from_pretrained(model_name=args.model, max_seq_length=args.max_seq_length, load_in_4bit=True)
    FastLanguageModel.for_inference(model)
    model.eval()
    rows = []
    for line in args.eval.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        messages = []
        for message in case["messages"]:
            if message["role"] != "assistant":
                content = message["content"]
                if isinstance(content, str):
                    content = [{"type": "text", "text": content}]
                messages.append({"role": message["role"], "content": content})
        prompt = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt").to("cuda")
        with torch.inference_mode():
            output = model.generate(input_ids=prompt, max_new_tokens=args.max_new_tokens, do_sample=False, use_cache=True, pad_token_id=tokenizer.eos_token_id)
        generated = tokenizer.decode(output[0][prompt.shape[-1]:], skip_special_tokens=True).strip()
        rows.append({"id": case["id"], "generated": generated})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    print(json.dumps({"event": "prediction_generation_complete", "model": args.model, "cases": len(rows), "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
