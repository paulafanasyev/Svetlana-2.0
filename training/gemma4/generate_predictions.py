"""Generate held-out predictions for either base model or LoRA adapter."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Base model ID or adapter directory")
    parser.add_argument("--eval", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata-output", type=Path, default=None)
    parser.add_argument("--max-seq-length", type=int, default=1024)
    parser.add_argument("--max-new-tokens", type=int, default=160)
    args = parser.parse_args()
    if args.max_new_tokens <= 0:
        parser.error("--max-new-tokens must be positive")

    from unsloth import FastLanguageModel
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("Prediction generation requires CUDA; baseline is not proven without a real model runtime")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )
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
        inputs = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to(model.device)
        input_len = inputs["input_ids"].shape[-1]
        with torch.inference_mode():
            output = model.generate(
                input_ids=inputs["input_ids"],
                attention_mask=inputs["attention_mask"],
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                use_cache=True,
                pad_token_id=tokenizer.eos_token_id,
            )
        generated = tokenizer.decode(output[0][input_len:], skip_special_tokens=True).strip()
        rows.append({"id": case["id"], "generated": generated})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    args.output.write_text(payload, encoding="utf-8")
    metadata_path = args.metadata_output or args.output.with_suffix(".metadata.json")
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    cuda_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    metadata = {
        "schema_version": "prediction-v1",
        "artifact_type": "gemma4_text_predictions",
        "model": args.model,
        "eval_path": str(args.eval),
        "eval_sha256": _sha256(args.eval),
        "case_count": len(rows),
        "max_seq_length": args.max_seq_length,
        "max_new_tokens": args.max_new_tokens,
        "device": str(model.device),
        "cuda_available": bool(torch.cuda.is_available()),
        "cuda_version": torch.version.cuda,
        "cuda_device_name": cuda_name,
        "python": platform.python_version(),
        "torch": getattr(torch, "__version__", None),
        "transformers": _module_version("transformers"),
        "unsloth": _module_version("unsloth"),
        "prediction_sha256": _sha256(args.output),
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"event": "prediction_generation_complete", "model": args.model, "cases": len(rows), "output": str(args.output), "metadata": str(metadata_path)}, ensure_ascii=False))


def _module_version(name: str):
    try:
        module = __import__(name)
    except Exception:
        return None
    return getattr(module, "__version__", None)


if __name__ == "__main__":
    main()
