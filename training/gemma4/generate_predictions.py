"""Generate held-out predictions for either base model or LoRA adapter."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _module_version(name: str):
    try:
        module = __import__(name)
    except Exception:
        return None
    return getattr(module, "__version__", None)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Base model ID or adapter directory")
    parser.add_argument("--eval", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata-output", type=Path, default=None)
    parser.add_argument("--max-seq-length", type=int, default=1024)
    parser.add_argument("--max-new-tokens", type=int, default=160)
    args = parser.parse_args()
    if args.max_seq_length <= 0:
        parser.error("--max-seq-length must be positive")
    if args.max_new_tokens <= 0:
        parser.error("--max-new-tokens must be positive")

    # Import Unsloth before its submodules so runtime patches are initialized first.
    import unsloth
    import torch
    from unsloth import FastLanguageModel

    if not torch.cuda.is_available():
        raise RuntimeError(
            "Prediction generation requires CUDA; baseline is not proven without a real model runtime"
        )

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)
    model.eval()

    rows = []
    eval_cases = []
    for line_number, line in enumerate(args.eval.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            case = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON in eval at line {line_number}: {exc}") from exc

        case_id = case.get("id")
        messages_in = case.get("messages")
        if not case_id:
            raise ValueError(f"Eval line {line_number}: missing non-empty 'id'")
        if not isinstance(messages_in, list) or not messages_in:
            raise ValueError(f"{case_id}: 'messages' must be a non-empty list")
        if messages_in[-1].get("role") != "assistant":
            raise ValueError(f"{case_id}: final message must be the held-out assistant reference")

        messages = []
        for message in messages_in[:-1]:
            role = message.get("role")
            if role == "assistant":
                raise ValueError(f"{case_id}: assistant messages before the final reference are not allowed")
            if role not in {"system", "user", "tool"}:
                raise ValueError(f"{case_id}: unsupported message role: {role!r}")
            content = message.get("content")
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            messages.append({"role": role, "content": content})

        eval_cases.append(case_id)
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
                pad_token_id=(
                    tokenizer.pad_token_id
                    if tokenizer.pad_token_id is not None
                    else tokenizer.eos_token_id
                ),
            )
        generated = tokenizer.decode(output[0][input_len:], skip_special_tokens=True).strip()
        rows.append({"id": case_id, "generated": generated})

    if len(rows) != len(eval_cases):
        raise RuntimeError("Internal prediction count mismatch")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    args.output.write_text(payload, encoding="utf-8")

    metadata_path = args.metadata_output or args.output.with_suffix(".metadata.json")
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    cuda_name = torch.cuda.get_device_name(0)
    metadata = {
        "schema_version": "prediction-v1",
        "artifact_type": "gemma4_text_predictions",
        "model": args.model,
        "eval_path": str(args.eval),
        "eval_sha256": _sha256(args.eval),
        "case_count": len(rows),
        "case_ids": eval_cases,
        "max_seq_length": args.max_seq_length,
        "max_new_tokens": args.max_new_tokens,
        "generation": {
            "do_sample": False,
            "use_cache": True,
            "skip_special_tokens": True,
        },
        "device": str(model.device),
        "cuda_available": True,
        "cuda_version": torch.version.cuda,
        "cuda_device_name": cuda_name,
        "python": platform.python_version(),
        "torch": getattr(torch, "__version__", None),
        "transformers": _module_version("transformers"),
        "unsloth": _module_version("unsloth"),
        "prediction_sha256": _sha256(args.output),
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "event": "prediction_generation_complete",
                "model": args.model,
                "cases": len(rows),
                "output": str(args.output),
                "metadata": str(metadata_path),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
