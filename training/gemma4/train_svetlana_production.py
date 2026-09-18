#!/usr/bin/env python3
"""Production Gemma 4 SFT runner with explicit evidence output."""
from __future__ import annotations

import argparse
import hashlib
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
        "save_steps": int(os.getenv("SVETLANA_SAVE_STEPS", "100")),
        "logging_steps": int(os.getenv("SVETLANA_LOGGING_STEPS", "10")),
    }


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    train_parts = [load_dataset("json", data_files=str(REPO_ROOT / p), split="train") for p in train_paths]
    train = concatenate_datasets(train_parts)
    eval_parts = [load_dataset("json", data_files=str(REPO_ROOT / p), split="train") for p in eval_paths]
    evaluation = concatenate_datasets(eval_parts)
    return train, evaluation, train_paths + eval_paths


def format_dataset(dataset, tokenizer):
    def convert(example):
        messages = example.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError("Every example must contain non-empty messages")
        for message in messages:
            if not isinstance(message, dict) or "role" not in message or "content" not in message:
                raise ValueError("Every message must contain role and content")
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Chat template produced empty training text")
        return {"text": text, "messages": messages}

    return dataset.map(convert, remove_columns=dataset.column_names, batched=False, desc="Formatting Gemma dataset")


def tokenize_dataset(dataset, tokenizer, max_length: int):
    def chat_ids(messages):
        # Gemma 4 may return non-builtin integer scalar types when chat_template
        # tokenization is requested directly. Render first, then use the tokenizer's
        # normal text path so input_ids are a plain flat Python-int list.
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        # Gemma4Processor.__call__ has images as its first positional argument.
        # Pass text by keyword so a rendered string is not interpreted as images.
        encoded = tokenizer(text=text, add_special_tokens=False)
        value = encoded["input_ids"]
        if hasattr(value, "tolist"):
            value = value.tolist()
        if isinstance(value, list) and value and isinstance(value[0], list):
            value = value[0]
        try:
            value = [int(item) for item in value]
        except (TypeError, ValueError):
            raise RuntimeError("Gemma4 tokenizer did not return a flat token-id list") from None
        if not isinstance(value, list):
            raise RuntimeError("Gemma4 tokenizer did not return a flat token-id list")
        return value

    def tokenize(example):
        messages = example["messages"]
        full_ids = chat_ids(messages)
        truncated = len(full_ids) > max_length
        ids = full_ids[:max_length]

        labels = [-100] * len(ids)

        for index, message in enumerate(messages):
            if message["role"] != "assistant":
                continue
            before_ids = chat_ids(messages[:index])
            through_ids = chat_ids(messages[: index + 1])
            start = len(before_ids)
            end = len(through_ids)

            clipped_start = max(0, min(start, len(ids)))
            clipped_end = max(0, min(end, len(ids)))
            if clipped_end > clipped_start:
                for position in range(clipped_start, clipped_end):
                    labels[position] = ids[position]

        assistant_loss_tokens = sum(label != -100 for label in labels)
        if assistant_loss_tokens == 0:
            raise RuntimeError("Example produced zero assistant loss tokens")

        return {
            "input_ids": ids,
            "attention_mask": [1] * len(ids),
            "labels": labels,
            "_assistant_loss_tokens": assistant_loss_tokens,
            "_was_truncated": truncated,
        }

    return dataset.map(
        tokenize,
        remove_columns=dataset.column_names,
        batched=False,
        desc="Tokenizing Gemma dataset with assistant-only loss",
    )


def make_manual_collator(tokenizer):
    """Pad text-only Gemma4 batches without calling Gemma4Processor.pad()."""
    import torch

    pad_id = tokenizer.tokenizer.pad_token_id if hasattr(tokenizer, "tokenizer") else tokenizer.pad_token_id
    if pad_id is None:
        raise RuntimeError("Gemma4 tokenizer has no pad_token_id")

    def collate(features):
        max_len = max(len(feature["input_ids"]) for feature in features)
        input_ids = []
        attention_mask = []
        labels = []
        for feature in features:
            ids = list(feature["input_ids"])
            mask = list(feature.get("attention_mask", [1] * len(ids)))
            target = list(feature.get("labels", ids))
            padding = max_len - len(ids)
            input_ids.append(ids + [pad_id] * padding)
            attention_mask.append(mask + [0] * padding)
            labels.append(target + [-100] * padding)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "attention_mask": torch.tensor(attention_mask, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
        }

    return collate


def write_evidence(path: Path, *, root: Path, adapter_dir: Path, dataset_paths: list[str], config: dict, hardware: dict, model: str) -> dict:
    adapter_hash = hashlib.sha256()
    for item in sorted(p for p in adapter_dir.rglob("*") if p.is_file()):
        adapter_hash.update(item.relative_to(adapter_dir).as_posix().encode())
        adapter_hash.update(item.read_bytes())
    dataset_hash = hashlib.sha256()
    for rel in sorted(dataset_paths):
        file_path = root / rel
        dataset_hash.update(rel.encode())
        dataset_hash.update(file_path.read_bytes())
    evidence = {
        "model": model,
        "config": config,
        "hardware": hardware,
        "dataset_paths": dataset_paths,
        "adapter_sha256": adapter_hash.hexdigest(),
        "dataset_sha256": dataset_hash.hexdigest(),
    }
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    return evidence


def run(args: argparse.Namespace) -> dict:
    import unsloth
    import torch
    from transformers import Trainer, TrainingArguments
    from unsloth import FastLanguageModel

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

    dataset, evaluation, data_paths = load_training_dataset(manifest)
    formatted = format_dataset(dataset, tokenizer)
    formatted_eval = format_dataset(evaluation, tokenizer)
    tokenized = tokenize_dataset(formatted, tokenizer, cfg["max_seq_length"])
    tokenized_eval = tokenize_dataset(formatted_eval, tokenizer, cfg["max_seq_length"])

    def print_tokenization_diagnostics(label, dataset):
        loss_tokens = sum(dataset["_assistant_loss_tokens"])
        truncated = sum(dataset["_was_truncated"])
        zero_loss = sum(1 for count in dataset["_assistant_loss_tokens"] if count == 0)
        print(json.dumps({
            "event": "assistant_loss_diagnostics",
            "label": label,
            "records": len(dataset),
            "assistant_loss_tokens": loss_tokens,
            "truncated_records": truncated,
            "zero_loss_records": zero_loss,
            "max_seq_length": cfg["max_seq_length"],
        }, ensure_ascii=False))

    print_tokenization_diagnostics("train", tokenized)
    print_tokenization_diagnostics("eval", tokenized_eval)
    tokenized = tokenized.remove_columns(["_assistant_loss_tokens", "_was_truncated"])
    tokenized_eval = tokenized_eval.remove_columns(["_assistant_loss_tokens", "_was_truncated"])
    collator = make_manual_collator(tokenizer)

    training_args = TrainingArguments(
        output_dir=str(out),
        per_device_train_batch_size=cfg["per_device_train_batch_size"],
        per_device_eval_batch_size=cfg["per_device_train_batch_size"],
        gradient_accumulation_steps=cfg["gradient_accumulation_steps"],
        learning_rate=cfg["learning_rate"],
        num_train_epochs=cfg["num_train_epochs"],
        logging_steps=cfg["logging_steps"],
        save_steps=cfg["save_steps"],
        save_strategy="steps",
        eval_strategy="steps",
        eval_steps=cfg["save_steps"],
        report_to="none",
        fp16=False,
        bf16=False,
        remove_unused_columns=False,
        seed=cfg["seed"],
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        eval_dataset=tokenized_eval,
        data_collator=collator,
    )
    print(json.dumps({
        "event": "training_start",
        "train_records": len(tokenized),
        "eval_records": len(tokenized_eval),
        "epochs": cfg["num_train_epochs"],
        "batch_size": cfg["per_device_train_batch_size"],
        "gradient_accumulation_steps": cfg["gradient_accumulation_steps"],
        "output": str(out),
        "resume_from": checkpoint,
    }, ensure_ascii=False))
    trainer.train(resume_from_checkpoint=checkpoint)
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    hardware = {
        "gpu": props.name,
        "vram_gb": round(props.total_memory / 1024**3, 2),
        "cuda": torch.version.cuda,
        "python": platform.python_version(),
        "torch": torch.__version__,
        "unsloth": unsloth.__version__,
    }
    evidence_path = out / "training_evidence.json"
    evidence = write_evidence(
        evidence_path,
        root=REPO_ROOT,
        adapter_dir=out,
        dataset_paths=data_paths,
        config=cfg,
        hardware=hardware,
        model=model_name,
    )
    return {"output": str(out), "evidence": evidence}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--resume-from")
    args = parser.parse_args()
    print(json.dumps({"event": "production_train_complete", **run(args)}, ensure_ascii=False))
