/**
 * DLavie OS — Multi-Provider Fallback Chain
 *
 * Tries providers in order. On rate-limit (429) or error, automatically
 * moves to the next provider. Zero downtime — always returns a response.
 *
 * Default order (configurable via PROVIDER_CHAIN env):
 *   1. Groq         — fastest, LPU hardware, free
 *   2. OpenRouter   — 50+ models, free tier
 *   3. HuggingFace  — serverless GPU, Qwen2.5-32B
 *   4. Ollama       — local, always available (offline fallback)
 *
 * Usage:
 *   const { text, provider, model } = await generateWithFallback(message, ragContext);
 *   await streamWithFallback(message, ragContext, res);
 */

import type { Response } from "express";
import {
  generateGroqResponse,
  streamGroqResponse,
  isGroqConfigured,
  type GroqMessage,
} from "../groq";
import {
  generateOpenRouterResponse,
  streamOpenRouterResponse,
  isOpenRouterConfigured,
  type OpenRouterMessage,
} from "../openrouter";
import {
  generateOllamaResponse,
  streamOllamaResponse,
  isOllamaOnline,
} from "../ollama";
import { isHFConfigured } from "../huggingface";

// ─── Provider definitions ─────────────────────────────────────────────────────

export type ProviderName = "groq" | "openrouter" | "hf" | "ollama";

interface ProviderSlot {
  name: ProviderName;
  model: string;
  isAvailable: () => boolean | Promise<boolean>;
}

const GROQ_DEFAULT_MODEL      = "llama-3.3-70b-versatile";
const OPENROUTER_DEFAULT_MODEL = "openrouter/free";
const HF_DEFAULT_MODEL        = "Qwen/Qwen2.5-Coder-32B-Instruct";
const OLLAMA_DEFAULT_MODEL    = "tinyllama";

function buildChain(): ProviderSlot[] {
  return [
    {
      name: "groq",
      model: process.env.GROQ_DEFAULT_MODEL || GROQ_DEFAULT_MODEL,
      isAvailable: () => isGroqConfigured(),
    },
    {
      name: "openrouter",
      model: process.env.OPENROUTER_DEFAULT_MODEL || OPENROUTER_DEFAULT_MODEL,
      isAvailable: () => isOpenRouterConfigured(),
    },
    {
      name: "hf",
      model: process.env.HF_DEFAULT_MODEL || HF_DEFAULT_MODEL,
      isAvailable: () => isHFConfigured(),
    },
    {
      name: "ollama",
      model: process.env.OLLAMA_DEFAULT_MODEL || OLLAMA_DEFAULT_MODEL,
      // Ollama is always tried as last resort — let the actual generation fail if it's truly down.
      // Skipping it here means the bot goes completely silent when cloud providers have no API keys.
      isAvailable: () => true,
    },
  ];
}

/** Returns true if an error looks like a rate limit */
function isRateLimit(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes("429") || msg.includes("rate") || msg.includes("quota") || msg.includes("limit");
}

/** Returns true if an error looks like the model is unavailable/deprecated */
function isModelError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("404") ||
    msg.includes("decommissioned") ||
    msg.includes("unavailable") ||
    msg.includes("not found") ||
    msg.includes("does not exist")
  );
}

/** Should we try the next provider? */
function shouldFallback(err: unknown): boolean {
  return isRateLimit(err) || isModelError(err);
}

// ─── Non-streaming fallback ───────────────────────────────────────────────────

export interface FallbackResult {
  text: string;
  provider: ProviderName;
  model: string;
  attempts: number;
  errors: Array<{ provider: ProviderName; error: string }>;
}

export async function generateWithFallback(
  message: string,
  ragContext?: string,
  systemPrompt?: string,
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<FallbackResult> {
  const chain = buildChain();
  const errors: Array<{ provider: ProviderName; error: string }> = [];
  let attempts = 0;

  const content = ragContext
    ? `${systemPrompt ? systemPrompt + "\n\n" : ""}Context from knowledge base:\n${ragContext}\n\nUser: ${message}`
    : message;

  const systemMsg = systemPrompt || "You are DLavie OS, a helpful AI assistant. Respond in the same language the user uses.";

  for (const slot of chain) {
    attempts++;
    const available = await slot.isAvailable();
    if (!available) continue;

    try {
      if (slot.name === "groq") {
        const msgs: GroqMessage[] = [
          { role: "system", content: systemMsg },
          { role: "user",   content },
        ];
        const text = await generateGroqResponse(msgs, slot.model, opts);
        return { text, provider: "groq", model: slot.model, attempts, errors };
      }

      if (slot.name === "openrouter") {
        const msgs: OpenRouterMessage[] = [
          { role: "system", content: systemMsg },
          { role: "user",   content },
        ];
        const text = await generateOpenRouterResponse(msgs, slot.model, opts);
        return { text, provider: "openrouter", model: slot.model, attempts, errors };
      }

      if (slot.name === "hf") {
        const { generateHFResponse } = await import("../huggingface");
        const prompt = ragContext
          ? `${systemMsg}\n\nContext:\n${ragContext}\n\nUser: ${message}\nAssistant:`
          : `${systemMsg}\n\nUser: ${message}\nAssistant:`;
        const text = await generateHFResponse(prompt, slot.model);
        return { text, provider: "hf", model: slot.model, attempts, errors };
      }

      if (slot.name === "ollama") {
        const text = await generateOllamaResponse(message, slot.model, ragContext, systemPrompt);
        return { text, provider: "ollama", model: slot.model, attempts, errors };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ provider: slot.name, error: errMsg });
      console.warn(`[ProviderChain] ${slot.name} failed (attempt ${attempts}): ${errMsg.slice(0, 120)}`);

      if (!shouldFallback(err)) {
        // Hard error (not rate limit / model issue) — try next anyway but log it
        console.warn(`[ProviderChain] Hard error from ${slot.name}, trying next provider`);
      }
      continue;
    }
  }

  // All providers failed — return error message rather than crashing
  const errSummary = errors.map((e) => `${e.provider}: ${e.error.slice(0, 80)}`).join("; ");
  console.error(`[ProviderChain] All ${attempts} providers failed: ${errSummary}`);
  throw new Error(`All AI providers failed after ${attempts} attempts. Errors: ${errSummary}`);
}

// ─── Streaming fallback ───────────────────────────────────────────────────────

export async function streamWithFallback(
  message: string,
  ragContext: string | undefined,
  res: Response,
  systemPrompt?: string
): Promise<{ provider: ProviderName; model: string }> {
  const chain = buildChain();
  const errors: string[] = [];

  for (const slot of chain) {
    const available = await slot.isAvailable();
    if (!available) continue;

    try {
      // Test availability with a quick non-streaming call first for groq/openrouter
      // to detect rate limits before we start the SSE stream
      if (slot.name === "groq" || slot.name === "openrouter") {
        // Use streaming directly — errors will be caught and we'll fall through
        if (slot.name === "groq") {
          await streamGroqResponse(message, slot.model, ragContext, res);
          return { provider: "groq", model: slot.model };
        }
        if (slot.name === "openrouter") {
          await streamOpenRouterResponse(message, slot.model, ragContext, res);
          return { provider: "openrouter", model: slot.model };
        }
      }

      if (slot.name === "hf") {
        const { streamHFResponse, isHFConfigured: hfOk } = await import("../huggingface");
        if (!hfOk()) continue;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const prompt = ragContext
          ? `Context:\n${ragContext}\n\nUser: ${message}\nAssistant:`
          : `User: ${message}\nAssistant:`;

        let fullText = "";
        for await (const token of streamHFResponse(prompt, slot.model)) {
          fullText += token;
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ token, done: false, source: "hf" })}\n\n`);
          }
        }
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ token: "", done: true, fullText, source: "hf" })}\n\n`);
          res.end();
        }
        return { provider: "hf", model: slot.model };
      }

      if (slot.name === "ollama") {
        await streamOllamaResponse(message, slot.model, ragContext, res);
        return { provider: "ollama", model: slot.model };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${slot.name}: ${msg.slice(0, 80)}`);
      console.warn(`[ProviderChain/stream] ${slot.name} failed: ${msg.slice(0, 120)}`);

      // If headers already sent, we can't switch providers
      if (res.headersSent) {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: msg, done: true })}\n\n`);
          res.end();
        }
        return { provider: slot.name, model: slot.model };
      }
      continue;
    }
  }

  // All failed — send error SSE
  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
  }
  if (!res.writableEnded) {
    const errMsg = `All AI providers unavailable. Tried: ${errors.join("; ")}`;
    res.write(`data: ${JSON.stringify({ error: errMsg, done: true })}\n\n`);
    res.end();
  }
  return { provider: "ollama", model: "unavailable" };
}
