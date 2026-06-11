#!/usr/bin/env python3
"""
DLavie OS — Knowledge Distillation Script
Uses a teacher model (via HuggingFace API or Ollama) to generate high-quality responses,
then trains a smaller student model on those teacher-generated responses (SFT distillation).
"""

import argparse
import json
import sys
import os
import time
import urllib.request
import urllib.error

def emit(data: dict):
    print(json.dumps(data), flush=True)

def call_ollama(prompt: str, model: str, host: str = "http://127.0.0.1:11434") -> str:
    """Get teacher response from Ollama."""
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 512},
    }).encode()
    req = urllib.request.Request(
        f"{host}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            return data.get("response", "").strip()
    except Exception as e:
        return f"[Error: {e}]"

def call_hf_api(prompt: str, model: str, hf_token: str) -> str:
    """Get teacher response from HuggingFace Inference API."""
    payload = json.dumps({
        "inputs": prompt,
        "parameters": {"max_new_tokens": 512, "temperature": 0.3, "return_full_text": False},
    }).encode()
    req = urllib.request.Request(
        f"https://api-inference.huggingface.co/models/{model}",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {hf_token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read())
            if isinstance(data, list) and data:
                return data[0].get("generated_text", "").strip()
            return str(data)
    except Exception as e:
        return f"[Error: {e}]"

def main():
    parser = argparse.ArgumentParser(description="Knowledge Distillation")
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--dataset-path", type=str, required=True)
    parser.add_argument("--output-dir", type=str, required=True)
    parser.add_argument("--teacher-model", type=str, default="llama3.2")
    parser.add_argument("--student-model", type=str, default="TinyLlama/TinyLlama-1.1B-Chat-v1.0")
    parser.add_argument("--teacher-source", type=str, default="ollama", choices=["ollama", "hf"])
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--lora-rank", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--hf-token", type=str, default="")
    parser.add_argument("--ollama-host", type=str, default="http://127.0.0.1:11434")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    emit({"type": "init", "message": f"Knowledge Distillation: teacher={args.teacher_model} → student={args.student_model}"})

    try:
        # Load source samples (just inputs - teacher will generate outputs)
        with open(args.dataset_path, "r") as f:
            records = [json.loads(line) for line in f if line.strip()]

        emit({"type": "status", "message": f"Loaded {len(records)} samples for distillation"})

        # Phase 1: Teacher generates responses
        emit({"type": "progress", "progress": 0.05, "epoch": 0, "step": 0, "loss": None, "message": "Teacher generating responses..."})

        distilled_samples = []
        total = len(records)
        for i, rec in enumerate(records):
            inp = rec.get("input", "")
            if not inp:
                continue

            if args.teacher_source == "ollama":
                teacher_out = call_ollama(inp, args.teacher_model, args.ollama_host)
            else:
                teacher_out = call_hf_api(inp, args.teacher_model, args.hf_token)

            if not teacher_out.startswith("[Error"):
                distilled_samples.append({"input": inp, "output": teacher_out, "source": f"distilled_{args.teacher_model}"})

            progress = 0.05 + (i / max(total, 1)) * 0.40
            emit({
                "type": "progress",
                "progress": progress,
                "epoch": 0,
                "step": i + 1,
                "loss": None,
                "message": f"Teacher inference {i+1}/{total}",
            })

            # Rate limiting for HF API
            if args.teacher_source == "hf" and i % 5 == 0:
                time.sleep(1)

        emit({"type": "status", "message": f"Teacher generated {len(distilled_samples)} responses. Starting student training..."})

        if len(distilled_samples) < 3:
            emit({"type": "error", "message": "Teacher failed to generate enough responses. Check teacher model availability."})
            sys.exit(1)

        # Save distilled dataset
        distilled_path = os.path.join(args.output_dir, "distilled_dataset.jsonl")
        with open(distilled_path, "w") as f:
            for s in distilled_samples:
                f.write(json.dumps(s) + "\n")

        # Phase 2: Train student on teacher responses
        import torch
        from datasets import Dataset
        from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments, Trainer, DataCollatorForLanguageModeling
        from peft import LoraConfig, get_peft_model

        emit({"type": "progress", "progress": 0.50, "epoch": 0, "step": 0, "loss": None, "message": "Loading student model..."})

        if args.hf_token:
            os.environ["HF_TOKEN"] = args.hf_token

        tokenizer = AutoTokenizer.from_pretrained(args.student_model, trust_remote_code=True, token=args.hf_token or None)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            args.student_model, torch_dtype=torch.float32, device_map="cpu",
            trust_remote_code=True, token=args.hf_token or None,
        )

        lora_config = LoraConfig(
            r=args.lora_rank, lora_alpha=args.lora_rank * 2,
            target_modules="all-linear", lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora_config)

        def tokenize(sample):
            text = f"### Instruction:\n{sample['input']}\n\n### Response:\n{sample['output']}"
            return tokenizer(text, truncation=True, max_length=512, padding="max_length")

        hf_dataset = Dataset.from_list(distilled_samples).map(tokenize, remove_columns=["input", "output", "source"])
        hf_dataset = hf_dataset.map(lambda x: {"labels": x["input_ids"]})

        training_args = TrainingArguments(
            output_dir=args.output_dir,
            num_train_epochs=args.epochs,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=4,
            learning_rate=args.learning_rate,
            logging_steps=1,
            save_strategy="epoch",
            fp16=False, bf16=False,
            report_to="none",
        )

        step_counter = [0]
        total_steps = len(distilled_samples) * args.epochs

        from transformers import TrainerCallback
        class DistillCallback(TrainerCallback):
            def on_log(self, a, state, control, logs=None, **kw):
                if logs:
                    step_counter[0] += 1
                    loss_val = logs.get("loss", None)
                    progress = min(0.55 + (step_counter[0] / max(total_steps, 1)) * 0.40, 0.95)
                    emit({"type": "progress", "progress": progress, "epoch": int(state.epoch or 0) + 1,
                          "step": step_counter[0], "loss": loss_val, "message": f"Student step {step_counter[0]}"})

        trainer = Trainer(
            model=model, args=training_args, train_dataset=hf_dataset,
            data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
        )
        trainer.add_callback(DistillCallback())
        trainer.train()

        model.save_pretrained(args.output_dir)
        tokenizer.save_pretrained(args.output_dir)

        emit({
            "type": "done",
            "output_dir": args.output_dir,
            "distilled_count": len(distilled_samples),
            "message": f"Distillation complete. {len(distilled_samples)} samples, {args.epochs} epochs.",
        })

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()
