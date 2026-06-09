/**
 * DLavie OS — Image Generation API
 * Uses HuggingFace Inference API for text-to-image generation.
 * Models: FLUX.1-schnell (primary), SDXL (fallback), SD 1.5 (last resort)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { HF_TOKEN, hfHeaders, isHFConfigured, HF_API_BASE } from "../huggingface";

const router: IRouter = Router();

const IMAGE_MODELS = [
  {
    id: "black-forest-labs/FLUX.1-schnell",
    name: "FLUX.1 Schnell",
    desc: "Fast, high-quality image generation",
    steps: 4,
  },
  {
    id: "stabilityai/stable-diffusion-xl-base-1.0",
    name: "Stable Diffusion XL",
    desc: "1024×1024 high detail",
    steps: 25,
  },
  {
    id: "runwayml/stable-diffusion-v1-5",
    name: "Stable Diffusion 1.5",
    desc: "512×512 fast & reliable",
    steps: 20,
  },
  {
    id: "stabilityai/stable-diffusion-2-1",
    name: "Stable Diffusion 2.1",
    desc: "768×768 improved quality",
    steps: 20,
  },
];

/** GET /api/image/models — available image models */
router.get("/image/models", (_req, res) => {
  res.json({
    models: IMAGE_MODELS,
    hfConfigured: isHFConfigured(),
  });
});

/** POST /api/image/generate — generate image from text prompt */
router.post("/image/generate", async (req: Request, res: Response) => {
  if (!isHFConfigured()) {
    res.status(503).json({
      error: "HF_TOKEN not configured",
      message: "Add HF_TOKEN secret to enable image generation",
    });
    return;
  }

  const {
    prompt,
    negativePrompt = "",
    model = IMAGE_MODELS[0].id,
    width = 512,
    height = 512,
    steps = 20,
    guidanceScale = 7.5,
    seed,
  } = req.body as {
    prompt?: string;
    negativePrompt?: string;
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
    guidanceScale?: number;
    seed?: number;
  };

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const modelId = IMAGE_MODELS.find((m) => m.id === model)?.id || IMAGE_MODELS[0].id;
  const isFlux = modelId.includes("FLUX");

  try {
    // FLUX uses different parameter shape
    const body = isFlux
      ? {
          inputs: prompt.trim(),
          parameters: {
            num_inference_steps: Math.min(steps, 4),
            ...(seed !== undefined ? { seed } : {}),
          },
        }
      : {
          inputs: prompt.trim(),
          parameters: {
            negative_prompt: negativePrompt || "ugly, blurry, low quality, watermark",
            num_inference_steps: Math.min(steps, 50),
            guidance_scale: guidanceScale,
            width: Math.min(width, 1024),
            height: Math.min(height, 1024),
            ...(seed !== undefined ? { seed } : {}),
          },
        };

    const response = await fetch(`${HF_API_BASE}/models/${modelId}`, {
      method: "POST",
      headers: {
        ...hfHeaders(),
        Accept: "image/png,image/*,*/*",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);

      // Model loading — tell client to retry
      if (response.status === 503) {
        let retryAfter = 20;
        try {
          const parsed = JSON.parse(errText) as { estimated_time?: number };
          if (parsed.estimated_time) retryAfter = Math.ceil(parsed.estimated_time);
        } catch { /* ignore */ }
        res.status(503).json({
          error: "Model loading",
          message: `Model is warming up. Retry in ${retryAfter}s`,
          retryAfter,
        });
        return;
      }

      res.status(response.status).json({
        error: `HF API error (${response.status})`,
        message: errText.slice(0, 300),
      });
      return;
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const imageBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString("base64");

    res.json({
      image: `data:${contentType};base64,${base64}`,
      model: modelId,
      prompt: prompt.trim(),
      width,
      height,
      steps,
      seed: seed ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      res.status(504).json({
        error: "Generation timeout",
        message: "Image generation took too long. Try a shorter prompt or fewer steps.",
      });
    } else {
      res.status(500).json({ error: "Generation failed", message: msg.slice(0, 300) });
    }
  }
});

/** GET /api/image/status — check if image generation is available */
router.get("/image/status", (_req, res) => {
  res.json({
    available: isHFConfigured(),
    models: IMAGE_MODELS.map((m) => m.id),
    provider: "HuggingFace Inference API",
    endpoint: `${HF_API_BASE}/models/<model-id>`,
  });
});

export default router;
