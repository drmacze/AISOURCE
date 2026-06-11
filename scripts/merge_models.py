#!/usr/bin/env python3
"""
DLavie OS — Model Merging Script
Implements TIES (Task Interference via Sparsity) and SLERP merging of LoRA adapters.
"""

import argparse
import json
import sys
import os

def emit(data: dict):
    print(json.dumps(data), flush=True)

def slerp(t: float, v0, v1, dot_threshold=0.9995):
    """Spherical Linear Interpolation between two tensors."""
    import torch
    v0_copy = v0.clone().float()
    v1_copy = v1.clone().float()
    v0_norm = torch.nn.functional.normalize(v0_copy.view(-1), dim=0)
    v1_norm = torch.nn.functional.normalize(v1_copy.view(-1), dim=0)
    dot = torch.clamp(torch.dot(v0_norm, v1_norm), -1, 1)
    if abs(dot.item()) > dot_threshold:
        return ((1 - t) * v0 + t * v1).to(v0.dtype)
    theta = torch.acos(dot)
    sin_theta = torch.sin(theta)
    s0 = torch.sin((1 - t) * theta) / sin_theta
    s1 = torch.sin(t * theta) / sin_theta
    result = (s0 * v0_copy.view(-1) + s1 * v1_copy.view(-1)).view(v0.shape)
    return result.to(v0.dtype)

def merge_ties(tensors: list, weights: list, density: float = 0.2):
    """TIES merging: trim, elect sign, merge."""
    import torch
    merged = torch.zeros_like(tensors[0])
    sign_votes = torch.zeros_like(tensors[0])
    for t, w in zip(tensors, weights):
        threshold = torch.quantile(torch.abs(t.float()), 1.0 - density)
        trimmed = torch.where(torch.abs(t) >= threshold, t, torch.zeros_like(t))
        sign_votes += w * torch.sign(trimmed)
        merged += w * trimmed
    elected_sign = torch.sign(sign_votes)
    merged = torch.where(elected_sign == 0, merged, torch.abs(merged) * elected_sign)
    total_weight = sum(weights)
    return merged / max(total_weight, 1e-8)

def main():
    parser = argparse.ArgumentParser(description="Model Merging")
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--model-paths", type=str, required=True, help="Comma-separated paths to LoRA adapters")
    parser.add_argument("--weights", type=str, default="", help="Comma-separated weights, e.g. 0.6,0.4")
    parser.add_argument("--method", type=str, default="slerp", choices=["slerp", "ties", "linear"])
    parser.add_argument("--output-dir", type=str, required=True)
    parser.add_argument("--base-model", type=str, default="TinyLlama/TinyLlama-1.1B-Chat-v1.0")
    parser.add_argument("--hf-token", type=str, default="")
    parser.add_argument("--density", type=float, default=0.2, help="TIES density threshold")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    model_paths = [p.strip() for p in args.model_paths.split(",") if p.strip()]
    if not model_paths:
        emit({"type": "error", "message": "No model paths provided"})
        sys.exit(1)

    raw_weights = [float(w) for w in args.weights.split(",") if w.strip()] if args.weights else []
    if len(raw_weights) != len(model_paths):
        raw_weights = [1.0 / len(model_paths)] * len(model_paths)
    total_w = sum(raw_weights)
    weights = [w / total_w for w in raw_weights]

    emit({"type": "init", "message": f"Merging {len(model_paths)} models via {args.method.upper()}"})

    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM
        from peft import PeftModel

        emit({"type": "progress", "progress": 0.1, "epoch": 0, "step": 0, "loss": None, "message": "Loading base model..."})

        if args.hf_token:
            os.environ["HF_TOKEN"] = args.hf_token

        # Verify all adapter paths exist
        existing_paths = []
        for p in model_paths:
            if os.path.exists(p):
                existing_paths.append(p)
                emit({"type": "status", "message": f"Found adapter: {p}"})
            else:
                emit({"type": "status", "message": f"Warning: adapter not found at {p}, skipping"})

        if not existing_paths:
            emit({"type": "error", "message": "No valid adapter paths found. Complete at least one training job first."})
            sys.exit(1)

        weights_used = weights[:len(existing_paths)]
        total = sum(weights_used)
        weights_used = [w / total for w in weights_used]

        tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True, token=args.hf_token or None)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        base_model = AutoModelForCausalLM.from_pretrained(
            args.base_model, torch_dtype=torch.float32, device_map="cpu",
            trust_remote_code=True, token=args.hf_token or None,
        )

        emit({"type": "progress", "progress": 0.25, "epoch": 0, "step": 0, "loss": None, "message": "Loading adapters..."})

        # Load all adapters and extract weights
        adapter_state_dicts = []
        for i, adapter_path in enumerate(existing_paths):
            emit({"type": "status", "message": f"Loading adapter {i+1}/{len(existing_paths)}: {adapter_path}"})
            peft_model = PeftModel.from_pretrained(base_model, adapter_path)
            state_dict = {}
            for name, param in peft_model.named_parameters():
                if "lora_" in name:
                    state_dict[name] = param.data.clone().cpu()
            adapter_state_dicts.append(state_dict)
            del peft_model

        emit({"type": "progress", "progress": 0.55, "epoch": 0, "step": 0, "loss": None, "message": f"Merging via {args.method.upper()}..."})

        # Get all unique lora keys
        all_keys = set()
        for sd in adapter_state_dicts:
            all_keys.update(sd.keys())

        merged_state = {}
        for key in all_keys:
            tensors = [sd.get(key) for sd in adapter_state_dicts if key in sd]
            w = [weights_used[i] for i, sd in enumerate(adapter_state_dicts) if key in sd]

            if len(tensors) == 1:
                merged_state[key] = tensors[0]
            elif args.method == "slerp" and len(tensors) == 2:
                merged_state[key] = slerp(w[1], tensors[0], tensors[1])
            elif args.method == "ties":
                merged_state[key] = merge_ties(tensors, w, args.density)
            else:
                merged_state[key] = sum(t * wt for t, wt in zip(tensors, w))

        emit({"type": "progress", "progress": 0.80, "epoch": 0, "step": 0, "loss": None, "message": "Saving merged model..."})

        # Apply merged adapter to base model
        merged_model = PeftModel.from_pretrained(base_model, existing_paths[0])
        for name, param in merged_model.named_parameters():
            if name in merged_state:
                param.data.copy_(merged_state[name])

        merged_model.save_pretrained(args.output_dir)
        tokenizer.save_pretrained(args.output_dir)

        emit({
            "type": "done",
            "output_dir": args.output_dir,
            "method": args.method,
            "models_merged": len(existing_paths),
            "message": f"Model merge complete via {args.method.upper()}. {len(existing_paths)} adapters merged.",
        })

    except ImportError as e:
        emit({"type": "error", "message": f"Missing dependency: {e}. Run: pip install transformers peft torch"})
        sys.exit(1)
    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()
