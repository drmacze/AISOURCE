/**
 * DLavie OS — HuggingFace Hub API Routes
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  listHFModels,
  isHFConfigured,
  HF_STATUS,
  generateHFResponse,
  streamHFResponse,
  HF_CHAT_MODELS,
} from "../huggingface.js";

const router: IRouter = Router();

/** GET /api/hf/status — HuggingFace connection status */
router.get("/hf/status", (_req, res) => {
  res.json({
    connected: isHFConfigured(),
    tokenPrefix: HF_STATUS.tokenPrefix(),
    chatModels: HF_CHAT_MODELS,
  });
});

/** GET /api/hf/models — Browse HuggingFace model hub */
router.get("/hf/models", async (req: Request, res: Response) => {
  const { task = "text-generation", limit = "20", search } = req.query as {
    task?: string;
    limit?: string;
    search?: string;
  };

  const models = await listHFModels({ task, limit: Number(limit), search });
  res.json({ models, count: models.length, hfConfigured: isHFConfigured() });
});

/** POST /api/hf/generate — Generate text via HuggingFace */
router.post("/hf/generate", async (req: Request, res: Response) => {
  if (!isHFConfigured()) {
    res.status(503).json({ error: "HF_TOKEN not configured" });
    return;
  }

  const { prompt, model = HF_CHAT_MODELS[0], maxTokens = 256, temperature = 0.7 } = req.body as {
    prompt?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };

  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  try {
    const start = Date.now();
    const text = await generateHFResponse(prompt, model, { maxTokens, temperature });
    res.json({ text, model, latencyMs: Date.now() - start });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/hf/stream — Stream text via HuggingFace SSE */
router.post("/hf/stream", async (req: Request, res: Response) => {
  if (!isHFConfigured()) {
    res.status(503).json({ error: "HF_TOKEN not configured" });
    return;
  }

  const { prompt, model = HF_CHAT_MODELS[0], maxTokens = 512 } = req.body as {
    prompt?: string;
    model?: string;
    maxTokens?: number;
  };

  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    let fullText = "";
    for await (const token of streamHFResponse(prompt, model, { maxTokens })) {
      fullText += token;
      res.write(`data: ${JSON.stringify({ token, done: false })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ token: "", done: true, fullText })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
  }
  res.end();
});

export default router;
