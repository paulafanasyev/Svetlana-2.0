"""Svetlana training smoke run.

Designed for Kaggle/Unsloth. It detects the available GPU and uses a current
Qwen3.5 small model with bf16 LoRA rather than assuming a P100 or 4-bit QLoRA.
This script is intentionally a smoke run: it proves the training pipeline can
start and export an adapter; it does not prove production quality.
"""
import json
import os
import platform
from pathlib import Path

import torch
from datasets import load_dataset
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets" / "svetlana_seed.jsonl"
OUT = ROOT / "outputs" / "svetlana_smoke"
MAX_SEQ = int(os.getenv("SVETLANA_MAX_SEQ_LENGTH", "1024"))
MAX_STEPS = int(os.getenv("SVETLANA_MAX_STEPS", "20"))
MODEL = os.getenv("SVETLANA_BASE_MODEL", "unsloth/Qwen3.5-0.8B")

if not torch.cuda.is_available():
    raise RuntimeError("No CUDA GPU detected. Do not label this as a GPU training run.")

props = torch.cuda.get_device_properties(0)
print(json.dumps({
    "event": "hardware",
    "gpu": props.name,
    "vram_gb": round(props.total_memory / 1024**3, 2),
    "cuda": torch.version.cuda,
    "python": platform.python_version(),
    "model": MODEL,
}, ensure_ascii=False))

# Current Unsloth guidance for Qwen3.5 recommends bf16 LoRA and discourages
# 4-bit QLoRA because of quantization differences.
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL,
    max_seq_length=MAX_SEQ,
    load_in_4bit=False,
    load_in_16bit=True,
    full_finetuning=False,
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
    max_seq_length=MAX_SEQ,
)

dataset = load_dataset("json", data_files=str(DATA), split="train")

def format_example(example):
    messages = example["messages"]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return {"text": text}

dataset = dataset.map(format_example, remove_columns=dataset.column_names)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=SFTConfig(
        max_seq_length=MAX_SEQ,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=2,
        max_steps=MAX_STEPS,
        logging_steps=1,
        output_dir=str(OUT),
        optim="adamw_8bit",
        seed=3407,
        dataset_num_proc=1,
        report_to="none",
    ),
)
result = trainer.train()
print(json.dumps({
    "event": "train_complete",
    "global_step": result.global_step,
    "training_loss": result.training_loss,
}, ensure_ascii=False))

adapter_dir = OUT / "adapter"
model.save_pretrained(str(adapter_dir))
tokenizer.save_pretrained(str(adapter_dir))
print(json.dumps({"event": "export_complete", "path": str(adapter_dir)}, ensure_ascii=False))
