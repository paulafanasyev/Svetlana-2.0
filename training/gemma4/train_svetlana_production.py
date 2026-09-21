#!/usr/bin/env python3
"""Production Gemma 4 E2B SFT runner with resumable checkpoints and evidence."""
from __future__ import annotations

import argparse
import json
import math
import os
import platform
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = "google/gemma-4-E2B-it"


def load_config() -> dict:
    return {
        "max_seq_length": int(os.getenv("SVETLANA_MAX_SEQ_LENGTH", "2048")),
        "per_device_train_batch_size": int(os.getenv("SVETLANA_BATCH_SIZE", "1")),
        "gradient_accumulation_steps": int(os.getenv("SVETLANA_GRAD_ACCUM", "4")),
        "learning_rate": float(os.getenv("SVETLANA_LEARNING_RATE", "2e-5")),
        "num_train_epochs": int(os.getenv("SVETLANA_EPOCHS", "3")),
        "seed": int(os.getenv("SVETLANA_SEED", "3407")),
        "save_steps": int(os.getenv("SVETLANA_SAVE_STEPS", "25")),
        "logging_steps": int(os.getenv("SVETLANA_LOGGING_STEPS", "5")),
        "eval_steps": int(os.getenv("SVETLANA_EVAL_STEPS", "25")),
    }


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def manifest_paths(manifest: dict, key: str) -> list[str]:
    entries = manifest.get(key)
    if not isinstance(entries, list):
        raise ValueError(f"manifest missing {key} list")
    paths = []
    for entry in entries:
        if isinstance(entry, str):
            paths.append(entry)
        elif isinstance(entry, dict) and isinstance(entry.get("path"), str):
            paths.append(entry["path"])
        else:
            raise ValueError(f"manifest {key} entry must be a path string or object with a path")
    return paths


def validate_manifest(path: Path, root: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    for key in ("train", "eval"):
        for rel in manifest_paths(manifest, key):
            candidate = root / rel
            if not candidate.exists():
                raise FileNotFoundError(candidate)
    return manifest


def load_training_dataset(manifest: dict):
    from datasets import concatenate_datasets, load_dataset

    train_paths = manifest_paths(manifest, "train")
    eval_paths = manifest_paths(manifest, "eval")
    train_parts = [
        load_dataset("json", data_files=str(REPO_ROOT / p), split="train")
        for p in train_paths
    ]
    eval_parts = [
        load_dataset("json", data_files=str(REPO_ROOT / p), split="train")
        for p in eval_paths
    ]
    return concatenate_datasets(train_parts), concatenate_datasets(eval_parts), train_paths + eval_paths


def format_dataset(dataset):
    """Convert conversations to TRL prompt/completion examples.

    Keeping the final assistant turn in ``completion`` makes the SFT objective
    explicitly completion-only instead of training on system/user prompt tokens.
    """
    def convert(example):
        messages = example.get("messages")
        if not isinstance(messages, list) or len(messages) < 2:
            raise ValueError("Every example must contain a prompt and assistant completion")
        for message in messages:
            if not isinstance(message, dict) or "role" not in message or "content" not in message:
                raise ValueError("Every message must contain role and content")
        if messages[-1].get("role") != "assistant":
            raise ValueError("Every training example must end with an assistant message")
        return {
            "prompt": messages[:-1],
            "completion": [messages[-1]],
        }

    return dataset.map(
        convert,
        remove_columns=dataset.column_names,
        batched=False,
        desc="Formatting Gemma prompt/completion dataset",
    )


def write_existing_evidence(args: argparse.Namespace) -> dict:
    """Build evidence from an already-exported adapter without re-running SFT."""
    import importlib.metadata
    import torch
    from training.training_evidence import write_evidence

    manifest = validate_manifest(REPO_ROOT / "training/datasets/manifest_v2.json", REPO_ROOT)
    if manifest.get("training_mode") != "text_production":
        raise RuntimeError("Evidence recovery requires manifest training_mode=text_production")
    if not torch.cuda.is_available():
        raise RuntimeError("Evidence recovery requires CUDA so hardware evidence is real")

    cfg = load_config()
    out = Path(
        args.output
        or os.getenv(
            "SVETLANA_OUTPUT",
            "training/gemma4/outputs/svetlana_gemma4_e2b_production",
        )
    )
    training_result_path = out / "training_result.json"
    if not training_result_path.is_file():
        raise FileNotFoundError(f"Training result not found: {training_result_path}")
    try:
        training_result = json.loads(training_result_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid training result JSON: {training_result_path}") from exc

    cfg = load_config()
    train_dataset, _, _ = load_training_dataset(manifest)
    formatted_train = format_dataset(train_dataset)
    updates_per_epoch = math.ceil(
        len(formatted_train)
        / (cfg["per_device_train_batch_size"] * cfg["gradient_accumulation_steps"])
    )
    expected_global_steps = updates_per_epoch * cfg["num_train_epochs"]
    global_step = int(training_result.get("global_step", 0))
    recorded_expected = int(training_result.get("expected_global_step", expected_global_steps))
    if recorded_expected != expected_global_steps:
        raise ValueError(
            f"Training result expected_global_step does not match current config: "
            f"{recorded_expected}/{expected_global_steps}"
        )
    if global_step != expected_global_steps:
        raise ValueError(
            f"Training result does not prove completion: global_step={global_step}, "
            f"expected={expected_global_steps}"
        )

    adapter_dir = (out / "adapter").resolve()
    if not adapter_dir.is_dir():
        raise FileNotFoundError(f"Existing adapter directory not found: {adapter_dir}")
    if not any(path.is_file() for path in adapter_dir.rglob("*")):
        raise ValueError(f"Existing adapter directory is empty: {adapter_dir}")

    props = torch.cuda.get_device_properties(0)
    hardware = {
        "gpu": props.name,
        "vram_gb": round(props.total_memory / 1024**3, 2),
        "cuda": torch.version.cuda,
        "python": platform.python_version(),
        "torch": torch.__version__,
        "unsloth": importlib.metadata.version("unsloth"),
    }
    train_paths = manifest_paths(manifest, "train")
    eval_paths = manifest_paths(manifest, "eval")
    evidence_path = out / "training_evidence.json"
    evidence = write_evidence(
        evidence_path,
        root=REPO_ROOT,
        adapter_dir=adapter_dir,
        dataset_paths=[REPO_ROOT / path for path in train_paths + eval_paths],
        config=cfg,
        hardware=hardware,
        model=os.getenv("SVETLANA_BASE_MODEL", manifest.get("base_model", DEFAULT_MODEL)),
    )
    print(
        json.dumps(
            {
                "event": "evidence_complete",
                "recovered": True,
                "path": str(evidence_path),
                "adapter_sha256": evidence["adapter_sha256"],
                "dataset_sha256": evidence["dataset_sha256"],
                "global_step": int(training_result["global_step"]),
            },
            ensure_ascii=False,
        )
    )
    return {
        "output": str(out),
        "adapter": str(adapter_dir),
        "evidence": str(evidence_path),
        "recovered": True,
    }

def run(args: argparse.Namespace) -> dict:
    # Unsloth must see this before its first import so the trainer receives real logits.
    os.environ["UNSLOTH_RETURN_LOGITS"] = "1"

    import unsloth
    import torch
    from trl import SFTConfig, SFTTrainer
    from unsloth import FastLanguageModel
    from training.training_evidence import write_evidence

    manifest = validate_manifest(REPO_ROOT / "training/datasets/manifest_v2.json", REPO_ROOT)
    if manifest.get("training_mode") != "text_production":
        raise RuntimeError("Production runner requires manifest training_mode=text_production")
    if manifest.get("trainer") != "training/gemma4/train_svetlana_production.py":
        raise RuntimeError("Active manifest does not authorize production runner")
    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA GPU detected; production training requires GPU evidence")

    cfg = load_config()
    if cfg["save_steps"] <= 0 or cfg["eval_steps"] <= 0:
        raise ValueError("save/eval steps must be positive")

    model_name = os.getenv("SVETLANA_BASE_MODEL", manifest.get("base_model", DEFAULT_MODEL))
    out = Path(
        args.output
        or os.getenv(
            "SVETLANA_OUTPUT",
            "training/gemma4/outputs/svetlana_gemma4_e2b_production",
        )
    )
    out.mkdir(parents=True, exist_ok=True)
    adapter_dir = out / "adapter"
    checkpoint = args.resume_from or os.getenv("SVETLANA_RESUME_FROM")

    props = torch.cuda.get_device_properties(0)
    hardware = {
        "gpu": props.name,
        "vram_gb": round(props.total_memory / 1024**3, 2),
        "cuda": torch.version.cuda,
        "python": platform.python_version(),
        "torch": torch.__version__,
        "unsloth": unsloth.__version__,
    }
    print(
        json.dumps(
            {
                "event": "production_hardware",
                **hardware,
                "model": model_name,
            },
            ensure_ascii=False,
        )
    )

    dataset, evaluation, data_paths = load_training_dataset(manifest)
    formatted = format_dataset(dataset)
    formatted_eval = format_dataset(evaluation)

    model, processor = FastLanguageModel.from_pretrained(
        model_name=model_name,
        max_seq_length=cfg["max_seq_length"],
        load_in_4bit=True,
        load_in_16bit=False,
        full_finetuning=False,
    )
    tokenizer = getattr(processor, "tokenizer", processor)
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules="all-linear",
        lora_alpha=32,
        lora_dropout=0.0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=cfg["seed"],
        max_seq_length=cfg["max_seq_length"],
    )
    if hasattr(model, "config"):
        model.config.use_cache = False

    updates_per_epoch = math.ceil(
        len(formatted)
        / (
            cfg["per_device_train_batch_size"]
            * cfg["gradient_accumulation_steps"]
        )
    )
    total_steps = updates_per_epoch * cfg["num_train_epochs"]
    warmup_steps = max(1, round(total_steps * 0.05))

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=formatted,
        eval_dataset=formatted_eval,
        args=SFTConfig(
            output_dir=str(out),
            max_length=cfg["max_seq_length"],
            per_device_train_batch_size=cfg["per_device_train_batch_size"],
            per_device_eval_batch_size=cfg["per_device_train_batch_size"],
            gradient_accumulation_steps=cfg["gradient_accumulation_steps"],
            learning_rate=cfg["learning_rate"],
            num_train_epochs=cfg["num_train_epochs"],
            # Tesla T4 does not support native BF16. Gemma 4/Unsloth also
            # reports that FP16 is not supported for this model, so force FP32
            # to prevent TRL/Transformers from implicitly enabling BF16.
            bf16=False,
            fp16=False,
            completion_only_loss=True,
            warmup_steps=warmup_steps,
            max_grad_norm=0.3,
            logging_steps=cfg["logging_steps"],
            save_steps=cfg["save_steps"],
            save_strategy="steps",
            save_total_limit=3,
            eval_steps=cfg["eval_steps"],
            eval_strategy="steps",
            optim="adamw_8bit",
            dataset_num_proc=1,
            report_to="none",
            seed=cfg["seed"],
            remove_unused_columns=False,
        ),
    )

    objective_batch = next(iter(trainer.get_train_dataloader()))
    labels = objective_batch.get("labels")
    if labels is None:
        raise RuntimeError("Training objective gate failed: trainer batch has no labels")
    supervised_tokens = int((labels != -100).sum().item())
    total_tokens = int(labels.numel())
    if supervised_tokens <= 0:
        raise RuntimeError("Training objective gate failed: zero supervised completion tokens")
    if supervised_tokens >= total_tokens:
        raise RuntimeError("Training objective gate failed: full-sequence labels detected")
    print(
        json.dumps(
            {
                "event": "training_objective_gate_pass",
                "objective": "completion_only",
                "supervised_tokens_first_batch": supervised_tokens,
                "total_tokens_first_batch": total_tokens,
            },
            ensure_ascii=False,
        )
    )
    del objective_batch, labels
    print(
        json.dumps(
            {
                "event": "training_start",
                "train_records": len(formatted),
                "eval_records": len(formatted_eval),
                "epochs": cfg["num_train_epochs"],
                "effective_batch_size": (
                    cfg["per_device_train_batch_size"] * cfg["gradient_accumulation_steps"]
                ),
                "save_steps": cfg["save_steps"],
                "eval_steps": cfg["eval_steps"],
                "output": str(out),
                "resume_from": checkpoint,
            },
            ensure_ascii=False,
        )
    )

    result = trainer.train(resume_from_checkpoint=checkpoint)
    if int(result.global_step) != total_steps:
        raise RuntimeError(
            f"Training did not reach configured final optimizer step: "
            f"{result.global_step}/{total_steps}"
        )
    training_result = {
        "global_step": int(result.global_step),
        "expected_global_step": total_steps,
        "training_loss": float(result.training_loss),
        "train_runtime": float(result.metrics.get("train_runtime", 0.0)),
        "train_samples_per_second": float(result.metrics.get("train_samples_per_second", 0.0)),
        "train_steps_per_second": float(result.metrics.get("train_steps_per_second", 0.0)),
    }
    (out / "training_result.json").write_text(
        json.dumps(training_result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"event": "training_complete", **training_result}, ensure_ascii=False))

    adapter_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    adapter_files = [path for path in adapter_dir.rglob("*") if path.is_file()]
    if not adapter_files:
        raise RuntimeError(f"Adapter export produced no files: {adapter_dir}")
    print(json.dumps({"event": "export_complete", "path": str(adapter_dir)}, ensure_ascii=False))

    evidence_path = out / "training_evidence.json"
    evidence = write_evidence(
        evidence_path,
        root=REPO_ROOT,
        adapter_dir=adapter_dir,
        dataset_paths=[REPO_ROOT / p for p in data_paths],
        config=cfg,
        hardware=hardware,
        model=model_name,
    )
    print(
        json.dumps(
            {
                "event": "evidence_complete",
                "path": str(evidence_path),
                "adapter_sha256": evidence["adapter_sha256"],
                "dataset_sha256": evidence["dataset_sha256"],
            },
            ensure_ascii=False,
        )
    )
    return {
        "output": str(out),
        "adapter": str(adapter_dir),
        "evidence": str(evidence_path),
        "training_result": training_result,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--resume-from")
    parser.add_argument(
        "--evidence-only",
        action="store_true",
        help="Recover evidence from an already-exported adapter without re-running SFT",
    )
    args = parser.parse_args()
    result = write_existing_evidence(args) if args.evidence_only else run(args)
    print(json.dumps({"event": "production_train_complete", **result}, ensure_ascii=False))
