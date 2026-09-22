"""Generate predictions for every suite in the frozen Svetlana benchmark.

The model is loaded once and reused across all suites. This script requires a real CUDA
runtime and never turns generated predictions into an acceptance verdict by itself.
"""
from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path

try:
    from training.evaluation.validate_benchmark_manifest import git_blob_sha, main as validate_manifest
except ModuleNotFoundError:
    from validate_benchmark_manifest import git_blob_sha, main as validate_manifest


def _load_eval_cases(path: Path) -> list[dict]:
    cases = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]:
            raise ValueError(f"{path}:{line_number}: invalid eval record")
        messages = row.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError(f"{path}:{line_number}: messages must be non-empty")
        if messages[-1].get("role") != "assistant":
            raise ValueError(f"{path}:{line_number}: final message must be assistant reference")
        cases.append(row)
    return cases


def _prepare_messages(case: dict) -> list[dict]:
    messages = []
    for message in case["messages"][:-1]:
        role = message.get("role")
        if role not in {"system", "user", "tool"}:
            raise ValueError(f"{case['id']}: unsupported message role {role!r}")
        content = message.get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        messages.append({"role": role, "content": content})
    return messages


def _generate_suite(model, tokenizer, cases: list[dict], max_new_tokens: int) -> list[dict]:
    rows = []
    for case in cases:
        inputs = tokenizer.apply_chat_template(
            _prepare_messages(case),
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to(model.device)
        input_len = inputs["input_ids"].shape[-1]
        with __import__("torch").inference_mode():
            output = model.generate(
                input_ids=inputs["input_ids"],
                attention_mask=inputs["attention_mask"],
                max_new_tokens=max_new_tokens,
                do_sample=False,
                use_cache=True,
                pad_token_id=(
                    tokenizer.pad_token_id
                    if tokenizer.pad_token_id is not None
                    else tokenizer.eos_token_id
                ),
            )
        generated = tokenizer.decode(output[0][input_len:], skip_special_tokens=True).strip()
        rows.append({"id": case["id"], "generated": generated})
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("training/evaluation/FROZEN_BENCHMARK_MANIFEST_V1.json"),
    )
    parser.add_argument(
        "--generation-config",
        type=Path,
        default=Path("training/evaluation/FROZEN_BENCHMARK_GENERATION_V1.json"),
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    root = args.manifest.resolve().parents[2]
    if validate_manifest(root) != 0:
        raise RuntimeError("frozen benchmark manifest validation failed")

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    generation = json.loads(args.generation_config.read_text(encoding="utf-8"))
    frozen_config_path = root / manifest.get("generation_config_path", "")
    if args.generation_config.resolve() != frozen_config_path.resolve():
        raise ValueError("generation config path does not match frozen benchmark manifest")
    expected_config_sha = manifest.get("generation_config_git_blob_sha")
    actual_config_sha = git_blob_sha(args.generation_config)
    if not isinstance(expected_config_sha, str) or actual_config_sha != expected_config_sha:
        raise ValueError(
            f"generation config is not frozen benchmark config: expected {expected_config_sha}, got {actual_config_sha}"
        )
    if generation.get("benchmark_id") != manifest.get("benchmark_id"):
        raise ValueError("generation config benchmark_id mismatch")
    if generation.get("benchmark_version") != manifest.get("benchmark_version"):
        raise ValueError("generation config benchmark_version mismatch")

    import torch
    from unsloth import FastLanguageModel

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for frozen benchmark prediction generation")

    max_seq_length = int(generation["generation"]["max_seq_length"])
    max_new_tokens = int(generation["generation"]["max_new_tokens"])
    load_in_4bit = bool(generation["generation"]["load_in_4bit"])

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=max_seq_length,
        load_in_4bit=load_in_4bit,
    )
    FastLanguageModel.for_inference(model)
    model.eval()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    suite_metadata = []
    total_cases = 0

    for suite in manifest["suites"]:
        eval_path = root / suite["eval_path"]
        expected_sha = suite["eval_git_blob_sha"]
        actual_sha = git_blob_sha(eval_path)
        if actual_sha != expected_sha:
            raise RuntimeError(
                f"{suite['suite_id']}: frozen eval blob mismatch: expected {expected_sha}, got {actual_sha}"
            )
        cases = _load_eval_cases(eval_path)
        predictions = _generate_suite(model, tokenizer, cases, max_new_tokens)
        out_path = args.output_dir / f"{suite['suite_id']}.jsonl"
        out_path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in predictions),
            encoding="utf-8",
        )
        suite_metadata.append({
            "suite_id": suite["suite_id"],
            "eval_path": suite["eval_path"],
            "eval_git_blob_sha": expected_sha,
            "prediction_path": str(out_path),
            "case_count": len(predictions),
        })
        total_cases += len(predictions)

    metadata = {
        "schema_version": "frozen-predictions-v1",
        "benchmark_id": manifest.get("benchmark_id"),
        "benchmark_version": manifest.get("benchmark_version"),
        "benchmark_manifest_git_blob_sha": git_blob_sha(args.manifest),
        "generation_config_git_blob_sha": git_blob_sha(args.generation_config),
        "model": args.model,
        "runtime": {
            "device": str(model.device),
            "cuda_available": True,
            "cuda_version": torch.version.cuda,
            "cuda_device_name": torch.cuda.get_device_name(0),
        },
        "generation": generation["generation"],
        "python": platform.python_version(),
        "torch": getattr(torch, "__version__", None),
        "suite_count": len(suite_metadata),
        "total_cases": total_cases,
        "suites": suite_metadata,
    }
    (args.output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "event": "frozen_benchmark_predictions_complete",
        "benchmark_id": metadata["benchmark_id"],
        "benchmark_version": metadata["benchmark_version"],
        "model": args.model,
        "suite_count": metadata["suite_count"],
        "total_cases": total_cases,
        "output_dir": str(args.output_dir),
        "cuda_device_name": metadata["runtime"]["cuda_device_name"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
