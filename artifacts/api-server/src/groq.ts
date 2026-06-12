/**
 * DLavie OS — Groq Integration
 *
 * Provides ultra-fast inference via Groq's LPU hardware.
 * API is fully OpenAI-compatible.
 *
 * Free models (no cost, rate-limited):
 *  - llama-3.3-70b-versatile   — best quality, 70B
 *  - llama-3.1-8b-instant      — fastest, 8B
 *  - mixtral-8x7b-32768        — long context, MoE
 *  - gemma2-9b-it              — Google Gemma 2
 *  - deepseek-r1-distill-llama-70b — reasoning model
 *
 * Get your free key at: https://console.groq.com
 */

import type { Response } from "express";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile",                  label: "Llama 3.3 70B",              context: 128000, free: true  },
  { id: "llama-3.1-8b-instant",                     label: "Llama 3.1 8B (Fast)",        context: 131072, free: true  },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct",label: "Llama 4 Scout 17B",          context: 131072, free: true  },
  { id: "qwen/qwen3-32b",                            label: "Qwen3 32B",                  context: 32768,  free: true  },
  { id: "openai/gpt-oss-120b",                       label: "OpenAI OSS 120B",            context: 131072, free: true  },
  { id: "openai/gpt-oss-20b",                        label: "OpenAI OSS 20B (Fast)",      context: 131072, free: true  },
  { id: "groq/compound",                             label: "Groq Compound",              context: 131072, free: true  },
  { id: "groq/compound-mini",                        label: "Groq Compound Mini (Fast)",  context: 131072, free: true  },
];

export function getGroqKey(): string {
  return process.env.GROQ_API_KEY || "";
}

export function isGroqConfigured(): boolean {
  return !!getGroqKey();
}

/** Strip the "groq:" prefix from a model name if present */
export function resolveGroqModel(model: string): string {
  return model.startsWith("groq:") ? model.slice(5) : model;
}

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function groqHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${getGroqKey()}`,
  };
}

/**
 * Non-streaming Groq completion.
 */
export async function generateGroqResponse(
  messages: GroqMessage[],
  model = "llama-3.3-70b-versatile",
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const { maxTokens = 1024, temperature = 0.7 } = opts;

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: groqHeaders(),
    body: JSON.stringify({
      model: resolveGroqModel(model),
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Groq API error (${response.status}): ${err}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming Groq completion — yields string tokens.
 */
export async function* streamGroqTokens(
  messages: GroqMessage[],
  model = "llama-3.3-70b-versatile",
  opts: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string> {
  const { maxTokens = 1024, temperature = 0.7 } = opts;

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: groqHeaders(),
    body: JSON.stringify({
      model: resolveGroqModel(model),
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok || !response.body) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Groq API error (${response.status}): ${err}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const raw = trimmed.slice(5).trim();
      if (raw === "[DONE]") return;
      try {
        const parsed = JSON.parse(raw) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // skip malformed line
      }
    }
  }
}

/**
 * Stream Groq response to an Express Response object (SSE format).
 * Signature matches streamOllamaResponse / streamKimiResponse.
 */
export async function streamGroqResponse(
  message: string,
  model = "llama-3.3-70b-versatile",
  ragContext?: string,
  res?: Response
): Promise<void> {
  if (!res) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const content = ragContext
    ? `You have access to the following context from the knowledge base:\n\n${ragContext}\n\nUser question: ${message}`
    : message;

  const messages: GroqMessage[] = [
    {
      role: "system",
      content:
        "You are DLavie OS, a powerful AI assistant. Be accurate, concise, and helpful. Respond in the same language the user uses.",
    },
    { role: "user", content },
  ];

  let fullText = "";

  try {
    for await (const token of streamGroqTokens(messages, model)) {
      fullText += token;
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ token, done: false, source: "groq" })}\n\n`);
      }
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ token: "", done: true, fullText, source: "groq" })}\n\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: msg, done: true, fullText, source: "groq" })}\n\n`);
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
