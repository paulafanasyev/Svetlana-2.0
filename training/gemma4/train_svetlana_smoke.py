"""Svetlana Google Gemma 4 E2B smoke training.

Target: Google Gemma 4 E2B instruction-tuned model with 4-bit LoRA on a
free Tesla T4/Colab-class GPU. LiteRT-LM is the later edge runtime/export
target. This smoke run proves model loading, SFT/LoRA training and adapter
export; it does not prove production quality or LiteRT-LM conversion.
"""
import json
import os
import platform
from pathlib import Path

import torch
import unsloth
from datasets import load_dataset
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets" / "svetlana_seed.jsonl"
OUT = ROOT / "outputs" / "svetlana_gemma4_e2b_smoke"
MAX_SEQ = int(os.getenv("SVETLANA_MAX_SEQ_LENGTH", "1024"))
MAX_STEPS = int(os.getenv("SVETLANA_MAX_STEPS", "20"))
MODEL = os.getenv("SVETLANA_BASE_MODEL", "google/gemma-4-E2B-it")

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
    "unsloth": unsloth.__version__,
}, ensure_ascii=False))

# Gemma 4 E2B 4-bit LoRA is appropriate for a 16-GB-class T4.
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL,
    max_seq_length=MAX_SEQ,
    load_in_4bit=True,
    load_in_16bit=False,
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
print(json.dumps({"event": "dataset", "train_examples": len(dataset)}, ensure_ascii=False))


def formatting_func(example):
    """Convert each OpenAI-style messages record with Gemma's chat template."""
    messages = example.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("Each training example must contain a non-empty 'messages' list.")
    return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
    )

trainer = SFTTrainer(
    model=model,
    processing_class=tokenizer,
    train_dataset=dataset,
    formatting_func=formatting_func,
    args=SFTConfig(
        max_length=MAX_SEQ,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=2,
        max_steps=MAX_STEPS,
        learning_rate=1e-4,
        logging_steps=1,
        output_dir=str(OUT),
        optim="adamw_8bit",
        seed=3407,
        dataset_num_proc=1,
        report_to="none",
        assistant_only_loss=False,
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
