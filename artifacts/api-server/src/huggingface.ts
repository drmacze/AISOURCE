/**
 * DLavie OS — HuggingFace Integration
 *
 * Provides:
 *  1. Chat completions via HF Serverless Inference API (runs on HF GPUs — no local RAM needed)
 *  2. Text generation fallback when Ollama is offline
 *  3. Model hub browsing (trending models)
 *  4. Dataset access for auto-training
 *  5. Streaming inference support
 */

export const HF_API_BASE = "https://api-inference.huggingface.co";     // used for datasets/old endpoints
export const HF_ROUTER_BASE = "https://router.huggingface.co";          // serverless inference (works from Replit)
export const HF_HUB_BASE = "https://huggingface.co";

/** Always reads from process.env at call time — safe after runtime updates */
export function getHFToken(): string {
  return process.env.HF_TOKEN || "";
}

/**
 * Heavy AI-dev specialist models — run on HF GPU servers via router.huggingface.co.
 * Runs entirely on HF's GPUs — consumes ZERO local RAM.
 * Confirmed working from Replit: Qwen2.5-Coder-32B-Instruct → HTTP 200.
 */
export const HF_AGENT_MODELS = [
  "Qwen/Qwen2.5-Coder-32B-Instruct",        // 32B coding specialist — CONFIRMED WORKING
  "Qwen/Qwen2.5-72B-Instruct",              // 72B general (if Pro tier)
  "google/gemma-2-2b-it",                   // fast small fallback
];

/**
 * Default HF chat models — ordered by preference.
 * These are free-tier models that support chat completion.
 */
export const HF_CHAT_MODELS = [
  "Qwen/Qwen2.5-Coder-32B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "HuggingFaceH4/zephyr-7b-beta",
  "microsoft/Phi-3-mini-4k-instruct",
  "meta-llama/Meta-Llama-3-8B-Instruct",
  "google/gemma-2-2b-it",
  "Qwen/Qwen2.5-1.5B-Instruct",
];

export function hfHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getHFToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/** Check if HuggingFace token is configured */
export function isHFConfigured(): boolean {
  const token = getHFToken();
  return !!token && token.startsWith("hf_");
}

/**
 * Generate text via HuggingFace Inference API.
 * Used as a fallback when Ollama is unavailable.
 */
export async function generateHFResponse(
  prompt: string,
  model: string = "mistralai/Mistral-7B-Instruct-v0.3",
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  if (!isHFConfigured()) {
    throw new Error("HF_TOKEN not configured");
  }

  const { maxTokens = 512, temperature = 0.7 } = options;

  // Format as instruct prompt
  const formattedPrompt = `<s>[INST] ${prompt} [/INST]`;

  const response = await fetch(`${HF_API_BASE}/models/${model}`, {
    method: "POST",
    headers: hfHeaders(),
    body: JSON.stringify({
      inputs: formattedPrompt,
      parameters: {
        max_new_tokens: maxTokens,
        temperature,
        top_p: 0.9,
        do_sample: true,
        return_full_text: false,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`HF API error (${response.status}): ${err}`);
  }

  const data = await response.json() as Array<{ generated_text: string }> | { generated_text: string };
  if (Array.isArray(data)) {
    return data[0]?.generated_text?.trim() || "";
  }
  return (data as { generated_text: string }).generated_text?.trim() || "";
}

/**
 * Stream text via HuggingFace Inference API.
 * Yields text chunks as they arrive.
 */
export async function* streamHFResponse(
  prompt: string,
  model: string = "mistralai/Mistral-7B-Instruct-v0.3",
  options: { maxTokens?: number; temperature?: number } = {}
): AsyncGenerator<string> {
  if (!isHFConfigured()) {
    throw new Error("HF_TOKEN not configured");
  }

  const { maxTokens = 512, temperature = 0.7 } = options;
  const formattedPrompt = `<s>[INST] ${prompt} [/INST]`;

  const response = await fetch(`${HF_API_BASE}/models/${model}`, {
    method: "POST",
    headers: hfHeaders(),
    body: JSON.stringify({
      inputs: formattedPrompt,
      parameters: { max_new_tokens: maxTokens, temperature, top_p: 0.9, do_sample: true, return_full_text: false },
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok || !response.body) {
    // Fall back to non-streaming
    const text = await generateHFResponse(prompt, model, options);
    yield text;
    return;
  }

  const reader = response.body.getReader();
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
        const parsed = JSON.parse(raw) as { token?: { text?: string } };
        const text = parsed.token?.text;
        if (text && text !== "</s>" && text !== "<s>") yield text;
      } catch {
        // skip malformed
      }
    }
  }
}

/**
 * Fetch trending/curated models from HF Hub API
 */
export async function listHFModels(options: {
  task?: string;
  limit?: number;
  search?: string;
} = {}): Promise<Array<{
  id: string;
  author: string;
  modelId: string;
  downloads: number;
  likes: number;
  task: string;
  tags: string[];
}>> {
  const { task = "text-generation", limit = 20, search } = options;
  const params = new URLSearchParams({
    filter: task,
    sort: "downloads",
    direction: "-1",
    limit: String(limit),
    ...(search ? { search } : {}),
  });

  const response = await fetch(`https://huggingface.co/api/models?${params}`, {
    headers: hfHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return [];
  const data = await response.json() as Array<{
    id: string;
    author?: string;
    modelId?: string;
    downloads?: number;
    likes?: number;
    pipeline_tag?: string;
    tags?: string[];
  }>;

  return data.map((m) => ({
    id: m.id,
    author: m.author || m.id.split("/")[0] || "unknown",
    modelId: m.modelId || m.id,
    downloads: m.downloads || 0,
    likes: m.likes || 0,
    task: m.pipeline_tag || task,
    tags: m.tags || [],
  }));
}

/**
 * Fetch public dataset info from HF Hub for auto-training
 */
export async function fetchHFDataset(
  dataset: string,
  split: string = "train",
  limit: number = 50
): Promise<Array<Record<string, unknown>>> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=${split}&offset=0&length=${limit}`;

  const response = await fetch(url, {
    headers: hfHeaders(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) return [];
  const data = await response.json() as { rows?: Array<{ row: Record<string, unknown> }> };
  return (data.rows || []).map((r) => r.row);
}

/**
 * Fetch Wikipedia article content for auto-training knowledge
 */
export async function fetchWikipediaArticle(topic: string): Promise<{ title: string; extract: string } | null> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json() as { title: string; extract: string };
    return { title: data.title, extract: data.extract };
  } catch {
    return null;
  }
}

/**
 * Generate Q&A training samples from a piece of text using HF
 * (or rule-based extraction if HF is not available)
 */
export async function generateTrainingSamplesFromText(
  text: string,
  topic: string,
  count: number = 5
): Promise<Array<{ input: string; output: string }>> {
  // Rule-based extraction (always works, no HF needed)
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);

  const samples: Array<{ input: string; output: string }> = [];

  // Factoid Q&A pairs from sentences
  for (const sentence of sentences.slice(0, count)) {
    if (sentence.length < 50) continue;
    // Simple template questions
    const questions = [
      `What can you tell me about ${topic}?`,
      `Explain ${topic} in simple terms.`,
      `Summarize this: "${sentence.slice(0, 80)}..."`,
    ];
    const q = questions[Math.floor(Math.random() * questions.length)];
    samples.push({ input: q, output: sentence });
    if (samples.length >= count) break;
  }

  return samples;
}

export const HF_STATUS = {
  isConfigured: isHFConfigured,
  tokenPrefix: () => { const t = getHFToken(); return t ? t.slice(0, 12) + "..." : "not set"; },
};

// ─── Chat Completions API (OpenAI-compatible HF endpoint) ─────────────────────
// Runs on HF GPU servers — uses ZERO local RAM. Model size doesn't matter.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Call HuggingFace's serverless chat completions endpoint.
 * The model runs on HF's GPU infrastructure — not on local RAM.
 * Supports 7B, 32B, 70B, etc. with no local resource constraint.
 */
export async function chatCompletionHF(
  messages: ChatMessage[],
  model: string = HF_AGENT_MODELS[0],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  if (!isHFConfigured()) throw new Error("HF_TOKEN not configured");

  const { maxTokens = 2048, temperature = 0.3 } = options;
  // Use router.huggingface.co — confirmed working from Replit (api-inference is blocked)
  const url = `${HF_ROUTER_BASE}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: hfHeaders(),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: 0.9,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`HF chat API (${model}) error ${response.status}: ${err.slice(0, 300)}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Try each model in HF_AGENT_MODELS in order until one succeeds.
 * For each model, tries the chat completions endpoint first, then falls back
 * to the old text-generation endpoint (which is known to work on free tier).
 * Returns { text, model } so the caller knows which model was used.
 */
export async function chatCompletionHFWithFallback(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<{ text: string; model: string }> {
  if (!isHFConfigured()) throw new Error("HF_TOKEN not configured");

  const errors: string[] = [];

  for (const model of HF_AGENT_MODELS) {
    // Try 1: OpenAI-compatible chat completions endpoint
    try {
      const text = await chatCompletionHF(messages, model, options);
      if (text) {
        console.log(`[HF] Chat completions success — model: ${model}, len: ${text.length}`);
        return { text, model };
      }
    } catch (e) {
      const errMsg = String(e).slice(0, 200);
      console.warn(`[HF] Chat completions failed (${model}): ${errMsg}`);
      errors.push(`chat/${model}: ${errMsg}`);
    }

    // Try 2: Old text-generation endpoint (free tier, known to work)
    try {
      const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
      const userMsgs = messages.filter((m) => m.role !== "system");
      const prompt = [
        systemMsg ? `<s>[INST] <<SYS>>\n${systemMsg}\n<</SYS>>\n\n` : "<s>[INST] ",
        ...userMsgs.map((m) =>
          m.role === "user" ? m.content : `[/INST] ${m.content} </s><s>[INST] `
        ),
        " [/INST]",
      ].join("");

      const text = await generateHFResponse(prompt, model, options);
      if (text) {
        console.log(`[HF] Text-gen fallback success — model: ${model}, len: ${text.length}`);
        return { text, model: `${model} (text-gen)` };
      }
    } catch (e) {
      const errMsg = String(e).slice(0, 200);
      console.warn(`[HF] Text-gen fallback failed (${model}): ${errMsg}`);
      errors.push(`textgen/${model}: ${errMsg}`);
    }
  }

  throw new Error(`All HF models and endpoints failed:\n${errors.join("\n")}`);
}
