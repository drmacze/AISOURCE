/**
 * DLavie OS — OpenRouter Integration
 *
 * Aggregates 50+ open-source models through a single API.
 * OpenAI-compatible. Models marked ":free" have no cost.
 *
 * Top free models:
 *  - meta-llama/llama-3.1-8b-instruct:free
 *  - meta-llama/llama-3.2-3b-instruct:free
 *  - microsoft/phi-3-mini-128k-instruct:free
 *  - google/gemma-2-9b-it:free
 *  - mistralai/mistral-7b-instruct:free
 *  - deepseek/deepseek-r1-distill-qwen-1.5b:free
 *  - qwen/qwen3-8b:free
 *
 * Get your free key at: https://openrouter.ai
 */

import type { Response } from "express";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const OPENROUTER_FREE_MODELS = [
  { id: "qwen/qwen3-coder:free",                           label: "Qwen3 Coder 480B (Free)", context: 1048576 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free",          label: "NVIDIA Nemotron Ultra",   context: 1000000 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free",          label: "NVIDIA Nemotron Super",   context: 1000000 },
  { id: "meta-llama/llama-3.3-70b-instruct:free",          label: "Llama 3.3 70B",           context: 131072  },
  { id: "google/gemma-4-31b-it:free",                      label: "Gemma 4 31B",             context: 262144  },
  { id: "google/gemma-4-26b-a4b-it:free",                  label: "Gemma 4 26B",             context: 262144  },
  { id: "nousresearch/hermes-3-llama-3.1-405b:free",       label: "Hermes 3 405B",           context: 131072  },
  { id: "openai/gpt-oss-120b:free",                        label: "OpenAI OSS 120B",         context: 131072  },
  { id: "openai/gpt-oss-20b:free",                         label: "OpenAI OSS 20B",          context: 131072  },
  { id: "meta-llama/llama-3.2-3b-instruct:free",           label: "Llama 3.2 3B (Fast)",     context: 131072  },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free",           label: "Qwen3 Next 80B",          context: 262144  },
  { id: "openrouter/free",                                  label: "OpenRouter Auto (Free)",  context: 200000  },
];

export function getOpenRouterKey(): string {
  return process.env.OPENROUTER_API_KEY || "";
}

export function isOpenRouterConfigured(): boolean {
  return !!getOpenRouterKey();
}

/** Strip "openrouter:" prefix if present */
export function resolveOpenRouterModel(model: string): string {
  return model.startsWith("openrouter:") ? model.slice(11) : model;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function openRouterHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${getOpenRouterKey()}`,
    "HTTP-Referer": "https://dlavie-os.replit.app",
    "X-Title": "DLavie OS",
  };
}

/**
 * Non-streaming OpenRouter completion.
 */
export async function generateOpenRouterResponse(
  messages: OpenRouterMessage[],
  model = "meta-llama/llama-3.1-8b-instruct:free",
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const { maxTokens = 1024, temperature = 0.7 } = opts;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: resolveOpenRouterModel(model),
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`OpenRouter API error (${response.status}): ${err}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming OpenRouter completion — yields string tokens.
 */
export async function* streamOpenRouterTokens(
  messages: OpenRouterMessage[],
  model = "meta-llama/llama-3.1-8b-instruct:free",
  opts: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string> {
  const { maxTokens = 1024, temperature = 0.7 } = opts;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: resolveOpenRouterModel(model),
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok || !response.body) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`OpenRouter API error (${response.status}): ${err}`);
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
          error?: { message?: string };
        };
        if (parsed.error) throw new Error(parsed.error.message);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
        // skip malformed line
      }
    }
  }
}

/**
 * Stream OpenRouter response to an Express Response object (SSE format).
 * Signature matches streamOllamaResponse / streamKimiResponse / streamGroqResponse.
 */
export async function streamOpenRouterResponse(
  message: string,
  model = "meta-llama/llama-3.1-8b-instruct:free",
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

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content:
        "You are DLavie OS, a powerful AI assistant. Be accurate, concise, and helpful. Respond in the same language the user uses.",
    },
    { role: "user", content },
  ];

  let fullText = "";

  try {
    for await (const token of streamOpenRouterTokens(messages, model)) {
      fullText += token;
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ token, done: false, source: "openrouter" })}\n\n`);
      }
    }
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({ token: "", done: true, fullText, source: "openrouter" })}\n\n`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({ error: msg, done: true, fullText, source: "openrouter" })}\n\n`
      );
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
