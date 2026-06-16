/**
 * DLavie OS — Kimi K2 Routes
 *
 * POST /api/kimi/chat/stream   — SSE streaming chat (same format as Ollama stream)
 * POST /api/kimi/chat          — Non-streaming chat (returns full response)
 * GET  /api/kimi/status        — Check availability + active backend
 */

import { Router, type Request, type Response } from "express";
import {
  streamKimi,
  getKimiConfig,
  getMoonshotKey,
  KIMI_HF_MODEL,
  type KimiMessage,
} from "../kimi.js";
import { db } from "@workspace/db";
import { messagesTable, conversationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

/** GET /api/kimi/status */
router.get("/kimi/status", (_req: Request, res: Response) => {
  const cfg = getKimiConfig();
  res.json({
    configured: cfg.ok,
    via: cfg.via,
    model: cfg.via === "moonshot" ? "kimi-k2-0711-preview (official)" : KIMI_HF_MODEL,
    moonshot: !!getMoonshotKey(),
    reason: cfg.reason,
  });
});

/** POST /api/kimi/chat/stream — SSE streaming for a conversation */
router.post("/kimi/chat/stream", async (req: Request, res: Response) => {
  const { conversationId, content } = req.body as {
    conversationId?: string | number;
    content?: string;
  };

  if (!content?.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const cfg = getKimiConfig();
  if (!cfg.ok) {
    res.status(503).json({
      error: "Kimi K2 not available",
      reason: cfg.reason,
      hint: "Add HF_TOKEN (uses HuggingFace Router) or MOONSHOT_API_KEY (uses official Moonshot API).",
    });
    return;
  }

  const convIdNum = conversationId ? parseInt(String(conversationId), 10) : NaN;

  // Build conversation history for context
  const history: KimiMessage[] = [
    {
      role: "system",
      content:
        "You are Kimi K2, a state-of-the-art AI assistant by MoonshotAI. " +
        "You are helpful, harmless, and honest. " +
        "You excel at coding, reasoning, and agentic tasks.",
    },
  ];

  if (!isNaN(convIdNum)) {
    try {
      const prior = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, convIdNum))
        .orderBy(messagesTable.createdAt)
        .limit(20);

      for (const m of prior) {
        history.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }
    } catch {
      // continue without history
    }
  }

  history.push({ role: "user", content: content.trim() });

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let fullText = "";

  try {
    for await (const token of streamKimi(history)) {
      fullText += token;
      res.write(`data: ${JSON.stringify({ token, done: false })}\n\n`);
    }

    // Save user + AI messages to DB
    if (!isNaN(convIdNum) && fullText) {
      try {
        const now = new Date();
        await db.insert(messagesTable).values([
          {
            conversationId: convIdNum,
            role: "user",
            content: content.trim(),
          },
          {
            conversationId: convIdNum,
            role: "assistant",
            content: fullText,
          },
        ]);
        await db
          .update(conversationsTable)
          .set({ updatedAt: now })
          .where(eq(conversationsTable.id, convIdNum));
      } catch {
        // non-fatal — DB save errors don't break the stream
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: msg, done: true })}\n\n`);
  } finally {
    if (!res.writableEnded) res.end();
  }
});

/** POST /api/kimi/chat — non-streaming, returns full text at once */
router.post("/kimi/chat", async (req: Request, res: Response) => {
  const { messages: msgs, content } = req.body as {
    messages?: KimiMessage[];
    content?: string;
  };

  const cfg = getKimiConfig();
  if (!cfg.ok) {
    res.status(503).json({ error: "Kimi K2 not available", reason: cfg.reason });
    return;
  }

  const history: KimiMessage[] = msgs || [
    { role: "system", content: "You are Kimi K2, an AI assistant by MoonshotAI." },
    { role: "user",   content: content?.trim() || "" },
  ];

  if (!history.find((m) => m.role === "user")) {
    res.status(400).json({ error: "At least one user message is required" });
    return;
  }

  try {
    let fullText = "";
    for await (const token of streamKimi(history)) {
      fullText += token;
    }
    res.json({ content: fullText, model: cfg.via === "moonshot" ? "kimi-k2-0711-preview" : KIMI_HF_MODEL });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
