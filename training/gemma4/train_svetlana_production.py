#!/usr/bin/env python3
"""Production Gemma 4 E2B SFT runner with resumable checkpoints and evidence."""
from __future__ import annotations

import argparse
import json
import os
import platform
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = "google/gemma-4-E2B-it"


def load_config() -> dict:
    return {
        "max_seq_length": int(os.getenv("SVETLANA_MAX_SEQ_LENGTH", "2048")),
        "per_device_train_batch_size": int(os.getenv("SVETLANA_BATCH_SIZE", "1")),
        "gradient_accumulation_steps": int(os.getenv("SVETLANA_GRAD_ACCUM", "8")),
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


def format_dataset(dataset, tokenizer):
    def convert(example):
        messages = example.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError("Every example must contain non-empty messages")
        for message in messages:
            if not isinstance(message, dict) or "role" not in message or "content" not in message:
                raise ValueError("Every message must contain role and content")
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Chat template produced empty training text")
        return {"text": text}

    return dataset.map(
        convert,
        remove_columns=dataset.column_names,
        batched=False,
        desc="Formatting Gemma dataset",
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
    if int(training_result.get("global_step", 0)) <= 0:
        raise ValueError("Training result does not prove any optimizer steps were completed")

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
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=cfg["seed"],
        max_seq_length=cfg["max_seq_length"],
    )
    if hasattr(model, "config"):
        model.config.use_cache = False

    dataset, evaluation, data_paths = load_training_dataset(manifest)
    formatted = format_dataset(dataset, tokenizer)
    formatted_eval = format_dataset(evaluation, tokenizer)

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=formatted,
        eval_dataset=formatted_eval,
        dataset_text_field="text",
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
            warmup_ratio=0.05,
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
    training_result = {
        "global_step": int(result.global_step),
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
