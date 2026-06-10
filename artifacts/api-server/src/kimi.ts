/**
 * DLavie OS — Kimi K2 Integration
 *
 * Integrates MoonshotAI Kimi K2 (1T param MoE) via:
 *  1. HuggingFace Router API  → moonshotai/Kimi-K2-Instruct  (uses existing HF_TOKEN)
 *  2. Moonshot official API   → kimi-k2-0711-preview          (uses MOONSHOT_API_KEY if set)
 *
 * Kimi K2 repo: https://github.com/MoonshotAI/Kimi-K2
 */

import type { Response } from "express";
import { getHFToken, hfHeaders, isHFConfigured } from "./huggingface.js";

export const KIMI_HF_MODEL      = "moonshotai/Kimi-K2-Instruct";
export const KIMI_HF_ROUTER     = "https://router.huggingface.co/v1/chat/completions";
export const KIMI_MOONSHOT_BASE = "https://api.moonshot.cn/v1";
export const MOONSHOT_API_KEY   = process.env.MOONSHOT_API_KEY || "";

export interface KimiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Check if Kimi K2 is available (HF Router or Moonshot) */
export function isKimiConfigured(): boolean {
  return !!MOONSHOT_API_KEY || isHFConfigured();
}

/** Detailed config info */
export function getKimiConfig(): { ok: boolean; via: "hf" | "moonshot" | "none"; model: string; reason?: string } {
  if (MOONSHOT_API_KEY) return { ok: true, via: "moonshot", model: "kimi-k2-0711-preview" };
  if (isHFConfigured())  return { ok: true, via: "hf", model: KIMI_HF_MODEL };
  return { ok: false, via: "none", model: "", reason: "Set HF_TOKEN or MOONSHOT_API_KEY to use Kimi K2" };
}

/**
 * Stream Kimi K2 response via HuggingFace Router (OpenAI-compatible SSE).
 */
export async function* streamKimiResponseHF(
  messages: KimiMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string> {
  if (!isHFConfigured()) throw new Error("HF_TOKEN not configured — cannot reach Kimi K2 via HF Router");

  const { maxTokens = 2048, temperature = 0.7 } = options;

  const headers = hfHeaders();
  headers["X-Wait-For-Model"] = "true";

  const response = await fetch(KIMI_HF_ROUTER, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: KIMI_HF_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Kimi K2 HF error (${response.status}): ${errText}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((l) => l.startsWith("data:"));

    for (const line of lines) {
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") return;
      try {
        const parsed = JSON.parse(raw) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
        };
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
        if (parsed.choices?.[0]?.finish_reason === "stop") return;
      } catch {
        // skip malformed
      }
    }
  }
}

/**
 * Stream Kimi K2 response via official Moonshot API (OpenAI-compatible SSE).
 */
export async function* streamKimiResponseMoonshot(
  messages: KimiMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string> {
  if (!MOONSHOT_API_KEY) throw new Error("MOONSHOT_API_KEY not configured");

  const { maxTokens = 2048, temperature = 0.7 } = options;

  const response = await fetch(`${KIMI_MOONSHOT_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${MOONSHOT_API_KEY}`,
    },
    body: JSON.stringify({
      model: "kimi-k2-0711-preview",
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Moonshot API error (${response.status}): ${errText}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((l) => l.startsWith("data:"));

    for (const line of lines) {
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") return;
      try {
        const parsed = JSON.parse(raw) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
        };
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
        if (parsed.choices?.[0]?.finish_reason === "stop") return;
      } catch {
        // skip malformed
      }
    }
  }
}

/**
 * Auto-select best available backend (Moonshot > HF Router) and yield tokens.
 */
export async function* streamKimi(
  messages: KimiMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string> {
  const cfg = getKimiConfig();
  if (!cfg.ok) throw new Error(cfg.reason ?? "Kimi K2 not configured");
  if (cfg.via === "moonshot") {
    yield* streamKimiResponseMoonshot(messages, options);
  } else {
    yield* streamKimiResponseHF(messages, options);
  }
}

/**
 * Generate a blocking (non-streaming) Kimi K2 response.
 * Collects all tokens and returns a string.
 */
export async function generateKimiResponse(
  message: string,
  _model?: string,
  ragContext?: string
): Promise<string> {
  const content = ragContext
    ? `You have access to the following context from the knowledge base:\n\n${ragContext}\n\nUser question: ${message}`
    : message;

  const messages: KimiMessage[] = [
    { role: "system", content: "You are DLavie OS AI — a powerful, helpful AI assistant. Answer accurately and thoroughly." },
    { role: "user", content },
  ];

  let output = "";
  for await (const token of streamKimi(messages)) {
    output += token;
  }
  return output;
}

/**
 * Stream Kimi K2 response to an Express Response object (SSE format).
 * Compatible with how streamOllamaResponse works.
 */
export async function streamKimiResponse(
  message: string,
  _model?: string,
  ragContext?: string,
  res?: Response
): Promise<void> {
  if (!res) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const content = ragContext
    ? `You have access to the following context from the knowledge base:\n\n${ragContext}\n\nUser question: ${message}`
    : message;

  const messages: KimiMessage[] = [
    { role: "system", content: "You are DLavie OS AI — a powerful, helpful AI assistant. Answer accurately and thoroughly." },
    { role: "user", content },
  ];

  let fullText = "";

  try {
    for await (const token of streamKimi(messages)) {
      fullText += token;
      res.write(`data: ${JSON.stringify({ token, done: false })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ token: "", done: true, fullText })}\n\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: msg, done: true, fullText })}\n\n`);
  }

  res.end();
}
