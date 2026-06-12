/**
 * DLavie OS — OpenAI-Compatible Endpoint
 *
 * Exposes DLavie OS's full provider chain as an OpenAI-compatible API.
 * OpenClaw and any other OpenAI-compatible client can use this.
 *
 * POST /api/openai/v1/chat/completions
 * GET  /api/openai/v1/models
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { generateWithFallback, streamWithFallback } from "../lib/provider-chain.js";

const router: IRouter = Router();

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

// POST /api/openai/v1/chat/completions
router.post("/openai/v1/chat/completions", async (req: Request, res: Response) => {
  const body = req.body as CompletionRequest;
  const { messages, stream = false, max_tokens, temperature } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { message: "messages array is required", type: "invalid_request_error" } });
    return;
  }

  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const userMsgs  = messages.filter((m) => m.role !== "system");
  const lastUser  = userMsgs.at(-1);
  if (!lastUser) {
    res.status(400).json({ error: { message: "No user message found", type: "invalid_request_error" } });
    return;
  }

  const userContent = lastUser.content;

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      const { provider, model } = await streamWithFallback(userContent, undefined, res, systemMsg);
      if (!res.writableEnded) {
        res.write(`data: [DONE]\n\n`);
        res.end();
      }
      console.log(`[OpenAI-Compat] stream done via ${provider}/${model}`);
    } catch (e) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: String(e) })}\n\n`);
        res.end();
      }
    }
    return;
  }

  try {
    const { text, provider, model } = await generateWithFallback(
      userContent,
      undefined,
      systemMsg,
      { maxTokens: max_tokens, temperature }
    );

    const id = `dlavie-${Date.now()}`;
    res.json({
      id,
      object:  "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model:   `dlavie-${provider}/${model}`,
      choices: [
        {
          index:         0,
          message:       { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens:     Math.ceil(userContent.length / 4),
        completion_tokens: Math.ceil(text.length / 4),
        total_tokens:      Math.ceil((userContent.length + text.length) / 4),
      },
    });
  } catch (e) {
    res.status(503).json({
      error: {
        message: String(e),
        type:    "server_error",
        code:    "provider_chain_failed",
      },
    });
  }
});

// GET /api/openai/v1/models
router.get("/openai/v1/models", (_req, res: Response) => {
  res.json({
    object: "list",
    data: [
      { id: "dlavie-chain",     object: "model", created: 1700000000, owned_by: "dlavie-os" },
      { id: "dlavie-groq",      object: "model", created: 1700000000, owned_by: "dlavie-os" },
      { id: "dlavie-openrouter",object: "model", created: 1700000000, owned_by: "dlavie-os" },
      { id: "dlavie-ollama",    object: "model", created: 1700000000, owned_by: "dlavie-os" },
    ],
  });
});

export default router;
