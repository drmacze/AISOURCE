#!/usr/bin/env python3
"""
DLavie OS — Direct Preference Optimization (DPO) Training Script
Uses TRL DPOTrainer to train from human preference data (chosen vs rejected responses).
"""

import argparse
import json
import sys
import os

def emit(data: dict):
    print(json.dumps(data), flush=True)

def main():
    parser = argparse.ArgumentParser(description="DPO Training Script")
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--dataset-path", type=str, required=True)
    parser.add_argument("--output-dir", type=str, required=True)
    parser.add_argument("--base-model", type=str, default="TinyLlama/TinyLlama-1.1B-Chat-v1.0")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--lora-rank", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--beta", type=float, default=0.1)
    parser.add_argument("--hf-token", type=str, default="")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    emit({"type": "init", "message": f"DPO Training started — model: {args.base_model}, epochs: {args.epochs}"})

    try:
        import torch
        from datasets import Dataset
        from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments
        from peft import LoraConfig, get_peft_model
        from trl import DPOTrainer, DPOConfig

        emit({"type": "status", "message": "Libraries loaded successfully"})

        # Load preference data
        with open(args.dataset_path, "r") as f:
            records = [json.loads(line) for line in f if line.strip()]

        emit({"type": "status", "message": f"Loaded {len(records)} preference pairs"})

        if len(records) < 5:
            emit({"type": "error", "message": f"Need at least 5 preference pairs, got {len(records)}. Add more RLHF annotations."})
            sys.exit(1)

        # Build HF dataset
        def build_row(r):
            prompt = r.get("input", "")
            chosen = r.get("chosen_response", "")
            rejected = r.get("rejected_response", chosen + " (suboptimal)")
            return {
                "prompt": f"<|user|>\n{prompt}\n<|assistant|>\n",
                "chosen": chosen,
                "rejected": rejected,
            }

        hf_dataset = Dataset.from_list([build_row(r) for r in records])
        emit({"type": "status", "message": "Dataset formatted for DPO"})

        emit({"type": "progress", "progress": 0.05, "epoch": 0, "step": 0, "loss": None, "message": "Loading tokenizer..."})

        # Load tokenizer
        if args.hf_token:
            os.environ["HF_TOKEN"] = args.hf_token
            os.environ["HUGGING_FACE_HUB_TOKEN"] = args.hf_token

        tokenizer = AutoTokenizer.from_pretrained(
            args.base_model,
            trust_remote_code=True,
            token=args.hf_token or None,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        emit({"type": "progress", "progress": 0.15, "epoch": 0, "step": 0, "loss": None, "message": "Loading model..."})

        model = AutoModelForCausalLM.from_pretrained(
            args.base_model,
            torch_dtype=torch.float32,
            device_map="cpu",
            trust_remote_code=True,
            token=args.hf_token or None,
        )

        emit({"type": "progress", "progress": 0.25, "epoch": 0, "step": 0, "loss": None, "message": "Applying LoRA..."})

        lora_config = LoraConfig(
            r=args.lora_rank,
            lora_alpha=args.lora_rank * 2,
            target_modules="all-linear",
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora_config)

        training_args = DPOConfig(
            output_dir=args.output_dir,
            num_train_epochs=args.epochs,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=4,
            learning_rate=args.learning_rate,
            beta=args.beta,
            logging_steps=1,
            save_strategy="epoch",
            fp16=False,
            bf16=False,
            report_to="none",
            remove_unused_columns=False,
        )

        emit({"type": "progress", "progress": 0.35, "epoch": 0, "step": 0, "loss": None, "message": "Starting DPO training..."})

        total_steps = max(len(records) // 1, 1) * args.epochs
        step_counter = [0]

        original_log = DPOTrainer.log if hasattr(DPOTrainer, "log") else None

        trainer = DPOTrainer(
            model=model,
            args=training_args,
            train_dataset=hf_dataset,
            tokenizer=tokenizer,
        )

        class ProgressCallback:
            def on_log(self, args_cb, state, control, logs=None, **kwargs):
                if logs:
                    step_counter[0] += 1
                    loss_val = logs.get("loss", logs.get("train_loss", None))
                    epoch_val = int(state.epoch) if state.epoch else 0
                    progress = min(0.35 + (step_counter[0] / max(total_steps, 1)) * 0.6, 0.95)
                    emit({
                        "type": "progress",
                        "progress": progress,
                        "epoch": epoch_val + 1,
                        "step": step_counter[0],
                        "loss": loss_val,
                        "message": f"DPO step {step_counter[0]} | loss: {loss_val:.4f}" if loss_val else f"DPO step {step_counter[0]}",
                    })

        from transformers import TrainerCallback
        class DPOProgressCallback(TrainerCallback):
            def on_log(self, args_cb, state, control, logs=None, **kwargs):
                if logs:
                    step_counter[0] += 1
                    loss_val = logs.get("loss", logs.get("train_loss", None))
                    epoch_val = int(state.epoch) if state.epoch else 0
                    progress = min(0.35 + (step_counter[0] / max(total_steps, 1)) * 0.6, 0.95)
                    emit({
                        "type": "progress",
                        "progress": progress,
                        "epoch": epoch_val + 1,
                        "step": step_counter[0],
                        "loss": loss_val,
                        "message": f"DPO step {step_counter[0]}",
                    })

        trainer.add_callback(DPOProgressCallback())
        trainer.train()

        emit({"type": "progress", "progress": 0.95, "epoch": args.epochs, "step": total_steps, "loss": None, "message": "Saving DPO model..."})

        model.save_pretrained(args.output_dir)
        tokenizer.save_pretrained(args.output_dir)

        emit({
            "type": "done",
            "output_dir": args.output_dir,
            "message": f"DPO training complete. {len(records)} preference pairs, {args.epochs} epochs.",
        })

    except ImportError as e:
        emit({"type": "error", "message": f"Missing dependency: {e}. Run: pip install trl transformers peft datasets"})
        sys.exit(1)
    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()
