"""Production text SFT runner for Svetlana Gemma 4 E2B.

The runner consumes the manifest-selected training corpus, performs deterministic
preflight validation, saves resumable checkpoints, exports the adapter, and writes
machine-readable evidence. It intentionally does not train on evaluation data.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
from pathlib import Path

import torch
import unsloth
from datasets import concatenate_datasets, load_dataset
from trl import SFTConfig, SFTTrainer
from unsloth import FastLanguageModel

from training.training_evidence import write_evidence
from training.validate_training import validate_manifest, validate_jsonl_splits


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
DEFAULT_MODEL = "google/gemma-4-E2B-it"


def load_config() -> dict:
    return {
        "max_seq_length": int(os.getenv("SVETLANA_MAX_SEQ_LENGTH", "2048")),
        "per_device_train_batch_size": int(os.getenv("SVETLANA_BATCH_SIZE", "1")),
        "gradient_accumulation_steps": int(os.getenv("SVETLANA_GRAD_ACCUM", "8")),
        "learning_rate": float(os.getenv("SVETLANA_LEARNING_RATE", "2e-5")),
        "num_train_epochs": float(os.getenv("SVETLANA_EPOCHS", "3")),
        "seed": int(os.getenv("SVETLANA_SEED", "3407")),
        "save_steps": int(os.getenv("SVETLANA_SAVE_STEPS", "100")),
        "logging_steps": int(os.getenv("SVETLANA_LOGGING_STEPS", "10")),
    }


def load_training_dataset(manifest: dict):
    paths = [REPO_ROOT / item["path"] for item in manifest["train"]]
    eval_paths = [REPO_ROOT / item["path"] for item in manifest.get("eval", [])]
    validate_jsonl_splits(paths, eval_paths, REPO_ROOT)
    datasets = [load_dataset("json", data_files=str(path), split="train") for path in paths]
    if not datasets:
        raise RuntimeError("Manifest contains no training inputs")
    return concatenate_datasets(datasets), paths


def format_dataset(dataset, tokenizer):
    def convert(example):
        messages = example.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError("Training example must contain non-empty messages")
        if not all(isinstance(m, dict) and m.get("role") and "content" in m for m in messages):
            raise ValueError("Every message must contain role and content")
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        if not text.strip():
            raise ValueError("Chat template produced empty training text")
        return {"text": text}
    return dataset.map(convert, remove_columns=dataset.column_names, desc="Formatting Gemma dataset")


def run(args: argparse.Namespace) -> dict:
    manifest = validate_manifest(REPO_ROOT / "training/datasets/manifest_v2.json", REPO_ROOT)
    if manifest.get("training_mode") != "text_production":
        raise RuntimeError("Production runner requires manifest training_mode=text_production")
    if manifest.get("trainer") != "training/gemma4/train_svetlana_production.py":
        raise RuntimeError("Active manifest does not authorize production runner")
    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA GPU detected; production training requires GPU evidence")

    cfg = load_config()
    model_name = os.getenv("SVETLANA_BASE_MODEL", manifest.get("base_model", DEFAULT_MODEL))
    out = Path(args.output or os.getenv("SVETLANA_OUTPUT", "training/gemma4/outputs/svetlana_gemma4_e2b_production"))
    out.mkdir(parents=True, exist_ok=True)
    checkpoint = args.resume_from or os.getenv("SVETLANA_RESUME_FROM")

    props = torch.cuda.get_device_properties(0)
    print(json.dumps({
        "event": "production_hardware",
        "gpu": props.name,
        "vram_gb": round(props.total_memory / 1024**3, 2),
        "cuda": torch.version.cuda,
        "python": platform.python_version(),
        "torch": torch.__version__,
        "unsloth": unsloth.__version__,
        "model": model_name,
    }, ensure_ascii=False))

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=model_name,
        max_seq_length=cfg["max_seq_length"],
        load_in_4bit=True,
        load_in_16bit=False,
        full_finetuning=False,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=cfg["seed"],
        max_seq_length=cfg["max_seq_length"],
    )

    dataset, data_paths = load_training_dataset(manifest)
    formatted = format_dataset(dataset, tokenizer)
    if len(formatted) < 100:
        raise RuntimeError(f"Production corpus unexpectedly small: {len(formatted)} records")
    print(json.dumps({"event": "production_dataset", "train_examples": len(formatted)}, ensure_ascii=False))

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=formatted,
        dataset_text_field="text",
        args=SFTConfig(
            max_length=cfg["max_seq_length"],
            per_device_train_batch_size=cfg["per_device_train_batch_size"],
            gradient_accumulation_steps=cfg["gradient_accumulation_steps"],
            warmup_ratio=0.05,
            num_train_epochs=cfg["num_train_epochs"],
            learning_rate=cfg["learning_rate"],
            logging_steps=cfg["logging_steps"],
            output_dir=str(out),
            optim="adamw_8bit",
            seed=cfg["seed"],
            dataset_num_proc=1,
            report_to="none",
            assistant_only_loss=False,
            save_strategy="steps",
            save_steps=cfg["save_steps"],
            save_total_limit=3,
        ),
    )
    result = trainer.train(resume_from_checkpoint=checkpoint)
    adapter_dir = out / "adapter"
    model.save_pretrained(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    evidence = write_evidence(
        out / "training_evidence.json",
        root=REPO_ROOT,
        adapter_dir=adapter_dir,
        dataset_paths=data_paths,
        config={**cfg, "runner": "train_svetlana_production.py", "resume_from": checkpoint},
        hardware={"gpu": props.name, "vram_gb": round(props.total_memory / 1024**3, 2), "cuda": torch.version.cuda},
        model=model_name,
    )
    return {
        "global_step": result.global_step,
        "training_loss": result.training_loss,
        "adapter_sha256": evidence["adapter_sha256"],
        "dataset_sha256": evidence["dataset_sha256"],
        "output": str(out),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--resume-from")
    args = parser.parse_args()
    print(json.dumps({"event": "production_train_complete", **run(args)}, ensure_ascii=False))
