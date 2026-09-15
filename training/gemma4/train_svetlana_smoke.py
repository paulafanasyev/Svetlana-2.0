"""Svetlana Google Gemma 4 E2B capability training on a real CUDA GPU."""
import json
import os
import platform
from pathlib import Path

import torch
import unsloth
from datasets import load_dataset, concatenate_datasets
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig
from training.training_evidence import write_evidence
from training.validate_training import validate_manifest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = validate_manifest(ROOT / "datasets" / "manifest_v2.json", ROOT.parent)
if MANIFEST["training_mode"] != "text_smoke" or MANIFEST["trainer"] != "training/gemma4/train_svetlana_smoke.py":
    raise RuntimeError("text smoke trainer is not authorized by the active manifest")
DATA_FILES = [
    ROOT / "datasets" / "svetlana_seed.jsonl",
    ROOT / "datasets" / "svetlana_capability_seed.jsonl",
    ROOT / "datasets" / "svetlana_capability_training_v2.jsonl",
]
OUT = ROOT / "outputs" / "svetlana_gemma4_e2b_smoke"
MAX_SEQ = int(os.getenv("SVETLANA_MAX_SEQ_LENGTH", "1536"))
MAX_STEPS = int(os.getenv("SVETLANA_MAX_STEPS", "200"))
MODEL = os.getenv("SVETLANA_BASE_MODEL", "google/gemma-4-E2B-it")

if not torch.cuda.is_available():
    raise RuntimeError("No CUDA GPU detected. Do not label this as a GPU training run.")

props = torch.cuda.get_device_properties(0)
print(json.dumps({"event":"hardware","gpu":props.name,"vram_gb":round(props.total_memory/1024**3,2),"cuda":torch.version.cuda,"python":platform.python_version(),"model":MODEL,"unsloth":unsloth.__version__}, ensure_ascii=False))

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
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
    max_seq_length=MAX_SEQ,
)

seed_datasets = []
for data_file in DATA_FILES:
    if not data_file.exists():
        raise FileNotFoundError(f"Required training dataset is missing: {data_file}")
    current = load_dataset("json", data_files=str(data_file), split="train")
    print(json.dumps({"event":"dataset_source","path":str(data_file.relative_to(ROOT)),"examples":len(current)}, ensure_ascii=False))
    seed_datasets.append(current)
dataset = concatenate_datasets(seed_datasets)
print(json.dumps({"event":"dataset","train_examples":len(dataset)}, ensure_ascii=False))

def format_example(example):
    messages = example.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("Each training example must contain a non-empty 'messages' list.")
    if not all(isinstance(message, dict) for message in messages):
        raise ValueError("Each message must be a role/content dictionary.")
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Gemma chat template produced empty/non-string training text.")
    return {"text": text}

formatted_dataset = dataset.map(
    format_example,
    remove_columns=dataset.column_names,
    desc="Formatting Gemma chat dataset",
)
print(json.dumps({"event":"formatted_dataset","train_examples":len(formatted_dataset),"columns":formatted_dataset.column_names,"sample_chars":len(formatted_dataset[0]["text"])}, ensure_ascii=False))

trainer = SFTTrainer(
    model=model,
    processing_class=tokenizer,
    train_dataset=formatted_dataset,
    dataset_text_field="text",
    args=SFTConfig(
        max_length=MAX_SEQ,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        max_steps=MAX_STEPS,
        learning_rate=5e-5,
        logging_steps=5,
        output_dir=str(OUT),
        optim="adamw_8bit",
        seed=3407,
        dataset_num_proc=1,
        report_to="none",
        assistant_only_loss=False,
        save_strategy="steps",
        save_steps=max(50, MAX_STEPS // 2),
        save_total_limit=2,
    ),
)
result = trainer.train()
print(json.dumps({"event":"train_complete","global_step":result.global_step,"training_loss":result.training_loss}, ensure_ascii=False))
adapter_dir = OUT / "adapter"
model.save_pretrained(str(adapter_dir))
tokenizer.save_pretrained(str(adapter_dir))
print(json.dumps({"event":"export_complete","path":str(adapter_dir)}, ensure_ascii=False))
evidence = write_evidence(
    OUT / "training_evidence.json",
    root=ROOT.parent,
    adapter_dir=adapter_dir,
    dataset_paths=DATA_FILES,
    config={"max_seq_length": MAX_SEQ, "max_steps": MAX_STEPS, "seed": 3407, "learning_rate": 5e-5, "lora_r": 16},
    hardware={"gpu": props.name, "vram_gb": round(props.total_memory / 1024**3, 2), "cuda": torch.version.cuda},
    model=MODEL,
)
print(json.dumps({"event":"evidence_complete","path":str(OUT / "training_evidence.json"),"adapter_sha256":evidence["adapter_sha256"],"dataset_sha256":evidence["dataset_sha256"]}, ensure_ascii=False))
