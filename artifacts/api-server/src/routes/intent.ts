/**
 * BLOK E — Smart Model Routing (Intent-Based)
 *
 * Routes:
 *  POST /api/intent/detect     — detect intent and get recommended model
 *  GET  /api/intent/routes     — get full routing table
 *  POST /api/intent/chat       — intent-routed chat (non-streaming)
 */

import { Router } from "express";
import { detectIntent, resolveRoute, getRouteTable } from "../lib/intent-router.js";
import { generateWithFallback } from "../lib/provider-chain.js";

const router = Router();

// ── POST /api/intent/detect ────────────────────────────────────────────────────

router.post("/intent/detect", (req, res) => {
  const { message } = req.body as { message: string };
  if (!message) return res.status(400).json({ error: "message required" });

  const decision = resolveRoute(message);
  res.json(decision);
});

// ── GET /api/intent/routes ─────────────────────────────────────────────────────

router.get("/intent/routes", (_req, res) => {
  res.json(getRouteTable());
});

// ── POST /api/intent/chat ──────────────────────────────────────────────────────
// Auto-route based on detected intent

router.post("/intent/chat", async (req, res) => {
  try {
    const { message, systemPrompt } = req.body as { message: string; systemPrompt?: string };
    if (!message) return res.status(400).json({ error: "message required" });

    const decision = resolveRoute(message);

    const { text, provider, model } = await generateWithFallback(
      message, undefined, systemPrompt, { maxTokens: 1000 }
    );

    res.json({
      text,
      provider,
      model,
      intent: decision.intent,
      routedTo: decision.routedTo,
      description: decision.description,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
