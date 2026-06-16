/**
 * DLavie OS Public API — v1
 *
 * Multi-platform AI API. Supports Ollama (local), Kimi K2 (MoonshotAI),
 * HuggingFace Inference, and cloud models via unified endpoints.
 *
 * Authentication
 * ─────────────────────────────────────────────────────────────────────────────
 *   X-API-Key: dlv_...
 *   X-DLavie-Key: dlv_...
 *   Authorization: Bearer dlv_...
 *
 * Rate Limit: 120 req/min per key (configurable via DLAVIE_RATE_LIMIT env)
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  documentsTable,
  aiModelsTable,
} from "@workspace/db";
import { eq, desc, count, sql } from "drizzle-orm";
import {
  generateOllamaResponse,
  streamOllamaResponse,
  listOllamaModels,
  OllamaError,
} from "../ollama.js";
import {
  generateGroqResponse,
  streamGroqTokens,
  isGroqConfigured,
  resolveGroqModel,
  GROQ_MODELS,
  type GroqMessage,
} from "../groq.js";
import {
  generateOpenRouterResponse,
  streamOpenRouterTokens,
  isOpenRouterConfigured,
  resolveOpenRouterModel,
  OPENROUTER_FREE_MODELS,
  type OpenRouterMessage,
} from "../openrouter.js";
import { generateWithFallback, streamWithFallback } from "../lib/provider-chain.js";
import { requireAuth } from "../lib/auth.js";

const router: IRouter = Router();

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = parseInt(process.env.DLAVIE_RATE_LIMIT || "120", 10);
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function getRateLimitKey(req: Request): string {
  const keyHeader =
    (req.headers["x-api-key"] as string) ||
    (req.headers["x-dlavie-key"] as string) ||
    (req.headers["x-dlavie-key"] as string) ||
    (req.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "") ||
    "anon";
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  return `${keyHeader.slice(0, 16)}:${ip}`;
}

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimits.set(key, entry);
  }
  entry.count++;
  const allowed = entry.count <= RATE_MAX;
  return { allowed, remaining: Math.max(0, RATE_MAX - entry.count), resetAt: entry.resetAt };
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = getRateLimitKey(req);
  const { allowed, remaining, resetAt } = checkRateLimit(key);
  res.setHeader("X-RateLimit-Limit", RATE_MAX);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));
  if (!allowed) {
    res.status(429).json({
      error: "RateLimitExceeded",
      message: `Too many requests. Limit is ${RATE_MAX} requests/minute per key.`,
      retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
    });
    return;
  }
  next();
}

// Cleanup old rate limit entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits.entries()) {
    if (now >= v.resetAt) rateLimits.delete(k);
  }
}, 5 * 60_000).unref();

// ─── API Key Auth (DB-backed) ─────────────────────────────────────────────────
// requireAuth is imported from ../lib/auth — validates against DB or DLAVIE_API_KEY master key
const requireApiKey = requireAuth("write");

// ─── Multi-model router ───────────────────────────────────────────────────────

type ModelProvider = "ollama" | "kimi" | "hf" | "groq" | "openrouter" | "auto";

function detectProvider(model: string): ModelProvider {
  const m = (model || "").toLowerCase();
  if (!m || m === "auto") return "auto";
  if (m.startsWith("groq:")) return "groq";
  if (m.startsWith("openrouter:")) return "openrouter";
  if (m.startsWith("kimi/") || m.startsWith("moonshotai/") || m === "kimi-k2") return "kimi";
  if (m.startsWith("hf/") || m.startsWith("huggingface/")) return "hf";
  return "ollama";
}

async function generateUnified(
  message: string,
  model: string,
  ragContext?: string,
  systemPrompt?: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ text: string; provider: ModelProvider; modelUsed: string }> {
  const provider = detectProvider(model);
  const sysMsg = systemPrompt || "You are DLavie OS, a helpful AI assistant. Respond in the same language the user uses.";

  // Build message history for chat providers
  function buildMessages<T extends { role: "system" | "user" | "assistant"; content: string }>(
    extraContent: string
  ): T[] {
    const msgs: T[] = [{ role: "system", content: sysMsg } as T];
    if (conversationHistory) {
      for (const h of conversationHistory.slice(-8)) {
        msgs.push({ role: h.role, content: h.content } as T);
      }
    }
    msgs.push({ role: "user", content: extraContent } as T);
    return msgs;
  }

  const userContent = ragContext
    ? `Context from knowledge base:\n${ragContext}\n\nUser: ${message}`
    : message;

  // ── Explicit provider selection — wrap each in try/catch to allow fallback ───
  if (provider === "groq") {
    try {
      const groqModel = model.slice(5); // strip "groq:"
      const msgs = buildMessages<GroqMessage>(userContent);
      const text = await generateGroqResponse(msgs, groqModel);
      return { text, provider: "groq", modelUsed: groqModel };
    } catch (e) {
      console.warn("[v1] Groq explicit failed, falling back to chain:", String(e).slice(0, 120));
    }
  }

  if (provider === "openrouter") {
    try {
      const orModel = model.slice(11); // strip "openrouter:"
      const msgs = buildMessages<OpenRouterMessage>(userContent);
      const text = await generateOpenRouterResponse(msgs, orModel);
      return { text, provider: "openrouter", modelUsed: orModel };
    } catch (e) {
      console.warn("[v1] OpenRouter explicit failed, falling back to chain:", String(e).slice(0, 120));
    }
  }

  if (provider === "kimi") {
    try {
      const { generateKimiResponse } = await import("../kimi.js");
      const kimiModel = model.replace(/^kimi\//i, "").replace(/^moonshotai\//i, "") || "kimi-k2-instruct";
      const text = await generateKimiResponse(message, kimiModel, ragContext);
      return { text, provider: "kimi", modelUsed: kimiModel };
    } catch (e) {
      console.warn("[v1] Kimi failed, falling back to chain:", e);
    }
  }

  if (provider === "hf") {
    try {
      const { generateHFResponse, isHFConfigured } = await import("../huggingface.js");
      if (!isHFConfigured()) throw new Error("HF_TOKEN not configured");
      const hfModel = model.replace(/^hf\//i, "").replace(/^huggingface\//i, "");
      const prompt = ragContext ? `Context:\n${ragContext}\n\nUser: ${message}` : message;
      const text = await generateHFResponse(prompt, hfModel);
      return { text, provider: "hf", modelUsed: hfModel };
    } catch (e) {
      console.warn("[v1] HF failed, falling back to chain:", e);
    }
  }

  if (provider === "ollama") {
    try {
      const text = await generateOllamaResponse(message, model || "tinyllama", ragContext, systemPrompt);
      return { text, provider: "ollama", modelUsed: model || "tinyllama" };
    } catch (e) {
      console.warn("[v1] Ollama failed, falling back to chain:", e);
    }
  }

  // ── "auto" or any fallback: use multi-provider chain ─────────────────────────
  const result = await generateWithFallback(message, ragContext, systemPrompt);
  return { text: result.text, provider: result.provider as ModelProvider, modelUsed: result.model };
}

async function streamUnified(
  message: string,
  model: string,
  ragContext: string | undefined,
  res: Response,
  systemPrompt?: string
): Promise<{ provider: ModelProvider; modelUsed: string }> {
  const provider = detectProvider(model);
  const sysMsg = systemPrompt || "You are DLavie OS, a helpful AI assistant. Respond in the same language the user uses.";
  const userContent = ragContext
    ? `Context from knowledge base:\n${ragContext}\n\nUser: ${message}`
    : message;

  function setupSSE() {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
    }
  }

  async function streamTokens(
    tokens: AsyncGenerator<string>,
    source: string,
    modelName: string
  ): Promise<{ provider: ModelProvider; modelUsed: string }> {
    setupSSE();
    let fullText = "";
    for await (const token of tokens) {
      fullText += token;
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ token, done: false, source })}\n\n`);
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ token: "", done: true, fullText, source })}\n\n`);
      res.end();
    }
    return { provider: source as ModelProvider, modelUsed: modelName };
  }

  if (provider === "groq") {
    const groqModel = model.slice(5);
    const msgs: GroqMessage[] = [
      { role: "system", content: sysMsg },
      { role: "user", content: userContent },
    ];
    return streamTokens(streamGroqTokens(msgs, groqModel), "groq", groqModel);
  }

  if (provider === "openrouter") {
    const orModel = model.slice(11);
    const msgs: OpenRouterMessage[] = [
      { role: "system", content: sysMsg },
      { role: "user", content: userContent },
    ];
    return streamTokens(streamOpenRouterTokens(msgs, orModel), "openrouter", orModel);
  }

  if (provider === "kimi") {
    try {
      const { streamKimiResponse } = await import("../kimi.js");
      const kimiModel = model.replace(/^kimi\//i, "").replace(/^moonshotai\//i, "") || "kimi-k2-instruct";
      await streamKimiResponse(message, kimiModel, ragContext, res);
      return { provider: "kimi", modelUsed: kimiModel };
    } catch (e) {
      console.warn("[v1/stream] Kimi failed, falling back:", e);
    }
  }

  if (provider === "hf") {
    try {
      const { streamHFResponse, isHFConfigured } = await import("../huggingface.js");
      if (isHFConfigured()) {
        const hfModel = model.replace(/^hf\//i, "").replace(/^huggingface\//i, "");
        const prompt = ragContext ? `Context:\n${ragContext}\n\nUser: ${message}\nAssistant:` : `User: ${message}\nAssistant:`;
        setupSSE();
        let fullText = "";
        for await (const token of streamHFResponse(prompt, hfModel)) {
          fullText += token;
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ token, done: false, source: "hf" })}\n\n`);
        }
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ token: "", done: true, fullText, source: "hf" })}\n\n`);
          res.end();
        }
        return { provider: "hf", modelUsed: hfModel };
      }
    } catch (e) {
      console.warn("[v1/stream] HF failed, falling back:", e);
    }
  }

  if (provider === "ollama") {
    await streamOllamaResponse(message, model || "tinyllama", ragContext, res);
    return { provider: "ollama", modelUsed: model || "tinyllama" };
  }

  // "auto" or all explicit fallbacks failed — use provider chain
  const chainResult = await streamWithFallback(message, ragContext, res, systemPrompt);
  return { provider: chainResult.provider as ModelProvider, modelUsed: chainResult.model };
}

// ─── RAG context helper — pgvector cosine similarity → BM25 fallback ─────────
const EMBED_DIMS_V1 = 384;
function pgVectorV1(vec: number[]): string { return "[" + vec.join(",") + "]"; }

async function retrieveRAGContext(query: string): Promise<string | undefined> {
  try {
    // 1. Try real vector search via HuggingFace embeddings + pgvector
    const { generateEmbedding } = await import("./documents.js");
    const queryVec = await generateEmbedding(query);
    if (queryVec && queryVec.length === EMBED_DIMS_V1) {
      try {
        const rows = await db.execute(sql`
          SELECT id, title, content,
                 CAST(1 - (embedding <=> ${pgVectorV1(queryVec)}::vector) AS FLOAT8) AS score
          FROM documents
          WHERE embedding IS NOT NULL
            AND (1 - (embedding <=> ${pgVectorV1(queryVec)}::vector)) > 0.2
          ORDER BY embedding <=> ${pgVectorV1(queryVec)}::vector
          LIMIT 3
        `) as unknown as Array<{ id: number; title: string; content: string; score: number }>;

        if (rows.length > 0) {
          return rows
            .map((r) => {
              const snippet = r.content?.length > 1000 ? r.content.slice(0, 1000) + "…" : r.content || "";
              return `[Knowledge: ${r.title}]\n${snippet}`;
            })
            .join("\n\n");
        }
      } catch {
        // pgvector query failed — fall through to BM25
      }
    }

    // 2. BM25 keyword fallback
    const docs = await db.select().from(documentsTable);
    if (!docs.length) return undefined;
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!queryWords.length) return undefined;
    const N = docs.length;
    const df: Record<string, number> = {};
    const docData = docs.map((doc) => {
      const tokens = `${doc.title} ${doc.content || ""}`.toLowerCase().split(/\s+/);
      for (const t of new Set(tokens)) df[t] = (df[t] || 0) + 1;
      return { doc, tokens };
    });
    const avgDL = docData.reduce((s, d) => s + d.tokens.length, 0) / Math.max(N, 1);
    const scored = docData.map(({ doc, tokens }) => {
      const tf: Record<string, number> = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      let score = 0;
      for (const q of queryWords) {
        const idf = Math.log((N - (df[q] || 0) + 0.5) / ((df[q] || 0) + 0.5) + 1);
        const f = tf[q] || 0;
        const k1 = 1.5, b = 0.75;
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * tokens.length / avgDL));
      }
      return { doc, score };
    });
    const relevant = scored.filter((s) => s.score > 0.1).sort((a, b) => b.score - a.score).slice(0, 3);
    if (!relevant.length) return undefined;
    return relevant
      .map((r) => {
        const snippet = r.doc.content && r.doc.content.length > 1000 ? r.doc.content.slice(0, 1000) + "…" : r.doc.content || "";
        return `[Knowledge: ${r.doc.title}]\n${snippet}`;
      })
      .join("\n\n");
  } catch {
    return undefined;
  }
}

// ─── OpenAPI Spec ─────────────────────────────────────────────────────────────
const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "DLavie OS API",
    version: "1.0.0",
    description: "Multi-platform AI API. Supports Ollama local models, Kimi K2 (MoonshotAI 1T MoE), HuggingFace models, and more.",
    contact: { name: "DLavie OS", url: "https://dlavie.ai" },
  },
  servers: [{ url: "/api/v1", description: "DLavie OS API v1" }],
  security: [{ ApiKeyHeader: [] }, { ApiKeyBearer: [] }],
  components: {
    securitySchemes: {
      ApiKeyHeader: { type: "apiKey" as const, in: "header" as const, name: "X-API-Key" },
      ApiKeyBearer: { type: "http" as const, scheme: "bearer" as const },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
          hint: { type: "string" },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", description: "User message" },
          model: {
            type: "string",
            description: "Model name. Supports: Ollama models (tinyllama, qwen2.5:1.5b), Kimi (kimi/kimi-k2-instruct), HuggingFace (hf/MODEL_NAME)",
            default: "tinyllama",
          },
          conversationId: { type: "integer", description: "Continue existing conversation" },
          useRAG: { type: "boolean", default: true, description: "Inject knowledge base context" },
          systemPrompt: { type: "string", description: "Override system prompt" },
        },
      },
      ChatResponse: {
        type: "object",
        properties: {
          reply: { type: "string" },
          model: { type: "string" },
          provider: { type: "string", enum: ["ollama", "kimi", "hf"] },
          conversationId: { type: "integer" },
          messageId: { type: "integer" },
          tokens: { type: "integer" },
          ragContext: { type: "boolean" },
          latencyMs: { type: "integer" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "System health check",
        operationId: "getHealth",
        security: [],
        responses: {
          "200": {
            description: "System status",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/models": {
      get: {
        summary: "List installed local AI models",
        operationId: "listModels",
        security: [],
        responses: { "200": { description: "Model list" } },
      },
    },
    "/models/catalogue": {
      get: {
        summary: "Full model catalogue (local + cloud)",
        operationId: "getModelCatalogue",
        security: [],
        responses: { "200": { description: "All available models" } },
      },
    },
    "/chat": {
      post: {
        summary: "Chat with AI (blocking)",
        operationId: "chat",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ChatRequest" } } },
        },
        responses: {
          "200": { description: "AI response" },
          "401": { description: "Unauthorized" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },
    "/chat/stream": {
      post: {
        summary: "Chat with AI (streaming SSE)",
        operationId: "chatStream",
        description: "Returns a Server-Sent Events stream. Each event: `data: {token, done, fullText?}`",
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/ask": {
      post: {
        summary: "Stateless question answering",
        operationId: "ask",
        description: "No conversation stored — instant answer",
        responses: { "200": { description: "Answer" } },
      },
    },
    "/batch": {
      post: {
        summary: "Batch questions — up to 10 in one request",
        operationId: "batch",
        responses: { "200": { description: "Array of answers" } },
      },
    },
    "/embed": {
      post: {
        summary: "Generate text embeddings",
        operationId: "embed",
        responses: { "200": { description: "Embedding vector" } },
      },
    },
    "/generate/image": {
      post: {
        summary: "Generate an image from a text prompt",
        operationId: "generateImage",
        responses: { "200": { description: "Image URL" } },
      },
    },
    "/rag/search": {
      post: {
        summary: "Search knowledge base",
        operationId: "ragSearch",
        responses: { "200": { description: "Search results" } },
      },
    },
    "/conversations": {
      get: { summary: "List conversations", operationId: "listConversations" },
      post: { summary: "Create conversation", operationId: "createConversation" },
    },
    "/conversations/{id}": {
      get: { summary: "Get conversation with messages", operationId: "getConversation" },
      delete: { summary: "Delete conversation", operationId: "deleteConversation" },
    },
    "/stats": {
      get: { summary: "System statistics", operationId: "getStats" },
    },
  },
};

// ─── GET /api/v1/openapi.json ─────────────────────────────────────────────────
router.get("/openapi.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(OPENAPI_SPEC);
});

// ─── GET /api/v1/health ───────────────────────────────────────────────────────
router.get("/health", async (_req, res) => {
  const { isOllamaOnline } = await import("../ollama.js");
  const { isHFConfigured } = await import("../huggingface.js");
  const { isKimiConfigured } = await import("../kimi.js");
  const { freemem, totalmem } = await import("os");
  const ollamaOnline = await isOllamaOnline();
  const groqOk = isGroqConfigured();
  const orOk = isOpenRouterConfigured();
  const primaryEngine =
    groqOk ? "Groq (cloud)" :
    orOk   ? "OpenRouter (cloud)" :
    ollamaOnline ? "Ollama (local)" :
    isHFConfigured() ? "HuggingFace (cloud)" : "unavailable";
  const hfOk = isHFConfigured();
  res.json({
    status: "online",
    version: "1.0.0",
    system: "DLavie OS",
    engine: primaryEngine,
    // Top-level booleans read directly by the frontend Models page
    ollama: ollamaOnline,
    huggingface: hfOk,
    ollamaHost: process.env.OLLAMA_HOST || "127.0.0.1:11434",
    providers: {
      groq:         { connected: groqOk,      priority: 1, type: "cloud-fast" },
      openrouter:   { connected: orOk,        priority: 2, type: "cloud-free" },
      huggingface:  { connected: hfOk,        priority: 3, type: "cloud-gpu" },
      kimi:         { connected: isKimiConfigured(), priority: 4, type: "cloud" },
      ollama:       { connected: ollamaOnline, priority: 5, type: "local" },
    },
    fallbackChain: ["groq", "openrouter", "hf", "ollama"],
    rateLimit: { windowMs: RATE_WINDOW_MS, maxRequests: RATE_MAX },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: {
      freeGB: parseFloat((freemem() / 1e9).toFixed(2)),
      totalGB: parseFloat((totalmem() / 1e9).toFixed(2)),
    },
  });
});

// ─── GET /api/v1/models ───────────────────────────────────────────────────────
router.get("/models", async (_req, res) => {
  const models = await listOllamaModels();
  res.json({
    models: models.map((m) => ({
      name: m.name,
      parameterSize: m.parameterSize,
      quantization: m.quantization,
      family: m.family,
      sizeMB: Math.round(m.size / (1024 * 1024)),
      provider: "ollama",
      ready: true,
    })),
    count: models.length,
  });
});

// ─── GET /api/v1/models/catalogue ────────────────────────────────────────────
router.get("/models/catalogue", async (_req, res) => {
  const { isHFConfigured } = await import("../huggingface.js");
  const { isKimiConfigured } = await import("../kimi.js");
  const ollamaModels = await listOllamaModels();

  const cloudModels = [
    // ── AUTO mode ─────────────────────────────────────────────────────────────
    { id: "auto", name: "Auto (Best Available)", provider: "auto", backend: "Smart Router", parameters: "varies", ready: true, requiresKey: "", description: "Automatically routes to the best available model: Groq → OpenRouter → HuggingFace → Ollama. Always works, always the best quality.", useIn: "auto", recommended: true },
    // ── Groq — fastest LPU inference ─────────────────────────────────────────
    { id: "groq:openai/gpt-oss-120b",                            name: "OpenAI OSS 120B",         provider: "groq", backend: "Groq LPU", parameters: "120B",   ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "OpenAI open-source 120B via Groq LPU — highest quality", useIn: "groq:openai/gpt-oss-120b" },
    { id: "groq:llama-3.3-70b-versatile",                        name: "Llama 3.3 70B",           provider: "groq", backend: "Groq LPU", parameters: "70B",    ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Meta Llama 3.3 70B — fastest 70B, excellent quality",     useIn: "groq:llama-3.3-70b-versatile" },
    { id: "groq:meta-llama/llama-4-scout-17b-16e-instruct",      name: "Llama 4 Scout 17B",       provider: "groq", backend: "Groq LPU", parameters: "17Bx16E",ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Meta Llama 4 Scout — MoE, very fast, multimodal-ready",   useIn: "groq:meta-llama/llama-4-scout-17b-16e-instruct" },
    { id: "groq:qwen/qwen3-32b",                                 name: "Qwen3 32B",               provider: "groq", backend: "Groq LPU", parameters: "32B",    ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Alibaba Qwen3 32B — great for coding & multilingual",     useIn: "groq:qwen/qwen3-32b" },
    { id: "groq:groq/compound",                                  name: "Groq Compound",           provider: "groq", backend: "Groq LPU", parameters: "large",  ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Groq Compound model — optimised for complex reasoning",   useIn: "groq:groq/compound" },
    { id: "groq:groq/compound-mini",                             name: "Groq Compound Mini",      provider: "groq", backend: "Groq LPU", parameters: "medium", ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Groq Compound Mini — fast, great for chatbots",           useIn: "groq:groq/compound-mini" },
    { id: "groq:openai/gpt-oss-20b",                             name: "OpenAI OSS 20B (Fast)",   provider: "groq", backend: "Groq LPU", parameters: "20B",    ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "OpenAI open-source 20B via Groq — fast & balanced",       useIn: "groq:openai/gpt-oss-20b" },
    { id: "groq:llama-3.1-8b-instant",                           name: "Llama 3.1 8B Instant",    provider: "groq", backend: "Groq LPU", parameters: "8B",     ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Meta Llama 3.1 8B — ultra-low latency, great for bots",   useIn: "groq:llama-3.1-8b-instant" },
    { id: "groq:gemma2-9b-it",                                   name: "Gemma 2 9B",              provider: "groq", backend: "Groq LPU", parameters: "9B",     ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Google Gemma 2 9B Instruct via Groq",                     useIn: "groq:gemma2-9b-it" },
    { id: "groq:mixtral-8x7b-32768",                             name: "Mixtral 8x7B",            provider: "groq", backend: "Groq LPU", parameters: "8x7B",   ready: isGroqConfigured(), requiresKey: "GROQ_API_KEY", description: "Mistral Mixtral 8x7B MoE — long context 32K",             useIn: "groq:mixtral-8x7b-32768" },
    // ── Kimi K2 — MoonshotAI 1T MoE ─────────────────────────────────────────
    { id: "kimi/kimi-k2-instruct",    name: "Kimi K2 Instruct",  provider: "kimi",       backend: "HuggingFace Router",    parameters: "1T MoE", ready: isKimiConfigured(),             requiresKey: "HF_TOKEN",           description: "MoonshotAI Kimi K2 — 1T parameter MoE, top-tier quality", useIn: "kimi/kimi-k2-instruct" },
    { id: "kimi/kimi-k2-0711-preview",name: "Kimi K2 Preview",   provider: "kimi",       backend: "Moonshot API",           parameters: "1T MoE", ready: !!process.env.MOONSHOT_API_KEY, requiresKey: "MOONSHOT_API_KEY",   description: "MoonshotAI Kimi K2 Preview — official Moonshot API",      useIn: "kimi/kimi-k2-0711-preview" },
    // ── OpenRouter — 50+ free & paid models ──────────────────────────────────
    { id: "openrouter:microsoft/phi-4",                         name: "Phi-4",              provider: "openrouter", backend: "OpenRouter", parameters: "14B",  ready: isOpenRouterConfigured(), requiresKey: "OPENROUTER_API_KEY", description: "Microsoft Phi-4 14B — free tier, efficient",        useIn: "openrouter:microsoft/phi-4" },
    { id: "openrouter:qwen/qwen3-14b:free",                     name: "Qwen3 14B",          provider: "openrouter", backend: "OpenRouter", parameters: "14B",  ready: isOpenRouterConfigured(), requiresKey: "OPENROUTER_API_KEY", description: "Alibaba Qwen3 14B free via OpenRouter",             useIn: "openrouter:qwen/qwen3-14b:free" },
    { id: "openrouter:deepseek/deepseek-r1:free",               name: "DeepSeek R1",        provider: "openrouter", backend: "OpenRouter", parameters: "671B", ready: isOpenRouterConfigured(), requiresKey: "OPENROUTER_API_KEY", description: "DeepSeek R1 reasoning model (free) — 671B MoE",     useIn: "openrouter:deepseek/deepseek-r1:free" },
    { id: "openrouter:meta-llama/llama-3.2-3b-instruct:free",  name: "Llama 3.2 3B",       provider: "openrouter", backend: "OpenRouter", parameters: "3B",   ready: isOpenRouterConfigured(), requiresKey: "OPENROUTER_API_KEY", description: "Meta Llama 3.2 3B (free) — lightweight",            useIn: "openrouter:meta-llama/llama-3.2-3b-instruct:free" },
    { id: "openrouter:google/gemma-3-12b-it:free",              name: "Gemma 3 12B",        provider: "openrouter", backend: "OpenRouter", parameters: "12B",  ready: isOpenRouterConfigured(), requiresKey: "OPENROUTER_API_KEY", description: "Google Gemma 3 12B Instruct (free) via OpenRouter", useIn: "openrouter:google/gemma-3-12b-it:free" },
    // ── HuggingFace — serverless GPU ─────────────────────────────────────────
    { id: "hf/Qwen/Qwen2.5-72B-Instruct",         name: "Qwen 2.5 72B",    provider: "hf", backend: "HuggingFace Inference", parameters: "72B", ready: isHFConfigured(), requiresKey: "HF_TOKEN", description: "Qwen 2.5 72B — strong multilingual model",      useIn: "hf/Qwen/Qwen2.5-72B-Instruct" },
    { id: "hf/meta-llama/Llama-3.1-8B-Instruct",  name: "Llama 3.1 8B",    provider: "hf", backend: "HuggingFace Inference", parameters: "8B",  ready: isHFConfigured(), requiresKey: "HF_TOKEN", description: "Meta Llama 3.1 8B Instruct via HuggingFace",    useIn: "hf/meta-llama/Llama-3.1-8B-Instruct" },
    { id: "hf/mistralai/Mistral-7B-Instruct-v0.3",name: "Mistral 7B",       provider: "hf", backend: "HuggingFace Inference", parameters: "7B",  ready: isHFConfigured(), requiresKey: "HF_TOKEN", description: "Mistral 7B Instruct via HuggingFace",           useIn: "hf/mistralai/Mistral-7B-Instruct-v0.3" },
  ];

  res.json({
    local: ollamaModels.map((m) => ({
      id: m.name,
      name: m.name,
      provider: "ollama",
      parameters: m.parameterSize,
      ready: true,
      sizeMB: Math.round(m.size / (1024 * 1024)),
      description: `Local model — ${m.family} family, ${m.quantization} quantization`,
      useIn: `model field as '${m.name}'`,
    })),
    cloud: cloudModels,
    totalLocal: ollamaModels.length,
    totalCloud: cloudModels.length,
    note: "Use 'id' value in the 'model' field when calling /api/v1/chat",
  });
});

// ─── GET /api/v1/docs ────────────────────────────────────────────────────────
router.get("/docs", (_req, res) => {
  res.json({
    name: "DLavie OS API",
    version: "v1",
    description: "Multi-platform AI API — chat, streaming, RAG, image generation, knowledge base, and more.",
    baseUrl: "/api/v1",
    openapi: "/api/v1/openapi.json",
    authentication: {
      type: "API Key",
      headers: ["X-API-Key: dlv_...", "X-DLavie-Key: dlv_...", "Authorization: Bearer dlv_..."],
    },
    rateLimit: { requests: RATE_MAX, windowSeconds: 60, headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"] },
    supportedProviders: ["ollama (local)", "kimi/kimi-k2-instruct (MoonshotAI 1T MoE)", "hf/* (HuggingFace Inference)"],
    endpoints: [
      { method: "GET",    path: "/api/v1/health",            auth: false, description: "System health + status" },
      { method: "GET",    path: "/api/v1/openapi.json",       auth: false, description: "OpenAPI 3.0 spec" },
      { method: "GET",    path: "/api/v1/models",             auth: false, description: "Installed local Ollama models" },
      { method: "GET",    path: "/api/v1/models/catalogue",   auth: false, description: "All models — local + cloud" },
      { method: "POST",   path: "/api/v1/chat",               auth: true,  description: "Chat (blocking) — any model" },
      { method: "POST",   path: "/api/v1/chat/stream",        auth: true,  description: "Chat (SSE stream) — any model" },
      { method: "POST",   path: "/api/v1/ask",                auth: true,  description: "Stateless Q&A — no DB storage" },
      { method: "POST",   path: "/api/v1/batch",              auth: true,  description: "Batch up to 10 questions at once" },
      { method: "POST",   path: "/api/v1/embed",              auth: true,  description: "Text embedding vector" },
      { method: "POST",   path: "/api/v1/generate/image",     auth: true,  description: "Image generation from prompt" },
      { method: "POST",   path: "/api/v1/rag/search",         auth: true,  description: "Knowledge base search" },
      { method: "GET",    path: "/api/v1/conversations",      auth: true,  description: "List conversations" },
      { method: "POST",   path: "/api/v1/conversations",      auth: true,  description: "Create conversation" },
      { method: "GET",    path: "/api/v1/conversations/:id",  auth: true,  description: "Get conversation + messages" },
      { method: "DELETE", path: "/api/v1/conversations/:id",  auth: true,  description: "Delete conversation" },
      { method: "GET",    path: "/api/v1/stats",              auth: true,  description: "System statistics" },
    ],
    usageExamples: {
      curl: {
        chat: `curl -X POST https://YOUR-DOMAIN.replit.app/api/v1/chat \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_KEY" \\
  -d '{"message":"Hello!","model":"tinyllama"}'`,
        kimiK2: `curl -X POST https://YOUR-DOMAIN.replit.app/api/v1/chat \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_KEY" \\
  -d '{"message":"Explain transformers","model":"kimi/kimi-k2-instruct"}'`,
        stream: `curl -N -X POST https://YOUR-DOMAIN.replit.app/api/v1/chat/stream \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_KEY" \\
  -d '{"message":"Write a poem","model":"qwen2.5:1.5b"}'`,
      },
      javascript: `// Universal AI chat — works on any platform
const response = await fetch('https://YOUR-DOMAIN.replit.app/api/v1/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': 'YOUR_KEY' },
  body: JSON.stringify({
    message: 'Hello, what can you do?',
    model: 'tinyllama',   // or 'kimi/kimi-k2-instruct' for 1T model
    useRAG: true,
  })
});
const { reply, model, latencyMs } = await response.json();`,
      python: `import httpx

client = httpx.Client(base_url='https://YOUR-DOMAIN.replit.app/api/v1',
                      headers={'X-API-Key': 'YOUR_KEY'})

resp = client.post('/chat', json={
    'message': 'Explain RAG in AI',
    'model': 'kimi/kimi-k2-instruct',
    'useRAG': True,
})
print(resp.json()['reply'])`,
      streaming: `// Streaming with EventSource-compatible fetch
const res = await fetch('https://YOUR-DOMAIN.replit.app/api/v1/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': 'YOUR_KEY' },
  body: JSON.stringify({ message: 'Explain ML', model: 'qwen2.5:1.5b' }),
});
const reader = res.body.getReader();
const dec = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  for (const line of dec.decode(value).split('\\n')) {
    if (!line.startsWith('data: ')) continue;
    const d = JSON.parse(line.slice(6));
    if (d.token) process.stdout.write(d.token);
    if (d.done) break;
  }
}`,
      whatsappBot: `// WhatsApp AI Bot with DLavie OS
const { reply } = await fetch('https://YOUR-DOMAIN/api/v1/ask', {
  method: 'POST',
  headers: { 'X-API-Key': 'YOUR_KEY', 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: incomingMessage, model: 'tinyllama', useRAG: true }),
}).then(r => r.json());
await sendWhatsAppMessage(reply);`,
    },
  });
});

// ─── POST /api/v1/ask ─────────────────────────────────────────────────────────
router.post("/ask", requireApiKey, rateLimit, async (req, res) => {
  const { question, model, useRAG = true, context: extraContext } = req.body as {
    question?: string;
    model?: string;
    useRAG?: boolean;
    context?: string;
  };
  const resolvedModel = model || req.apiKey?.defaultModel || "tinyllama";

  if (!question?.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const start = Date.now();
  let ragContext = useRAG ? await retrieveRAGContext(question) : undefined;
  if (extraContext) ragContext = extraContext + (ragContext ? "\n\n" + ragContext : "");

  try {
    const { text: answer, provider, modelUsed } = await generateUnified(question, resolvedModel, ragContext);
    res.json({
      answer,
      model: modelUsed,
      provider,
      ragUsed: !!ragContext,
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    if (error instanceof OllamaError) {
      res.status(502).json(error.toJSON());
    } else {
      res.status(500).json({ error: "InferenceError", message: error instanceof Error ? error.message : "Unknown error" });
    }
  }
});

// ─── POST /api/v1/batch ───────────────────────────────────────────────────────
router.post("/batch", requireApiKey, rateLimit, async (req, res) => {
  const { questions, model, useRAG = false } = req.body as {
    questions?: string[];
    model?: string;
    useRAG?: boolean;
  };
  const resolvedModel = model || req.apiKey?.defaultModel || "tinyllama";

  if (!Array.isArray(questions) || questions.length === 0) {
    res.status(400).json({ error: "questions array is required" });
    return;
  }
  if (questions.length > 10) {
    res.status(400).json({ error: "Maximum 10 questions per batch request" });
    return;
  }

  const start = Date.now();
  const results = await Promise.allSettled(
    questions.map(async (q, i) => {
      const ragContext = useRAG ? await retrieveRAGContext(q) : undefined;
      const { text: answer, provider, modelUsed } = await generateUnified(q, resolvedModel, ragContext);
      return { index: i, question: q, answer, model: modelUsed, provider };
    })
  );

  res.json({
    results: results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { index: i, question: questions[i], answer: null, error: r.reason?.message || "Failed" }
    ),
    count: questions.length,
    latencyMs: Date.now() - start,
  });
});

// ─── POST /api/v1/embed ───────────────────────────────────────────────────────
router.post("/embed", requireApiKey, rateLimit, async (req, res) => {
  const { text, model } = req.body as { text?: string; model?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    // Use Ollama embeddings if available
    const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
    const embeddingModel = model || "nomic-embed-text";
    const r = await fetch(`${ollamaHost}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embeddingModel, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });

    if (r.ok) {
      const data = await r.json() as { embedding: number[] };
      res.json({
        embedding: data.embedding,
        dimensions: data.embedding.length,
        model: embeddingModel,
        text: text.slice(0, 100) + (text.length > 100 ? "..." : ""),
      });
      return;
    }

    // Fallback: HuggingFace real embeddings
    const { generateEmbedding, } = await import("./documents.js");
    const hfVec = await generateEmbedding(text);
    if (hfVec) {
      res.json({
        embedding: hfVec,
        dimensions: hfVec.length,
        model: "sentence-transformers/all-MiniLM-L6-v2",
        provider: "huggingface",
        text: text.slice(0, 100) + (text.length > 100 ? "..." : ""),
      });
      return;
    }
    res.status(503).json({
      error: "EmbeddingUnavailable",
      message: "No embedding model available. Install nomic-embed-text via Ollama, or set HF_TOKEN for HuggingFace embeddings.",
    });
  } catch (error) {
    res.status(500).json({ error: "EmbeddingError", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

// ─── POST /api/v1/generate/image ─────────────────────────────────────────────
router.post("/generate/image", requireApiKey, rateLimit, async (req, res) => {
  const { prompt, model = "flux", width = 512, height = 512, steps = 4 } = req.body as {
    prompt?: string;
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  try {
    const { isHFConfigured } = await import("../huggingface.js");
    if (!isHFConfigured()) {
      res.status(503).json({
        error: "ImageGenerationUnavailable",
        message: "HF_TOKEN required for image generation. Set it in environment variables.",
        hint: "Add HF_TOKEN to Replit Secrets",
      });
      return;
    }

    const hfToken = process.env.HF_TOKEN || "";
    const modelId = model === "flux" ? "black-forest-labs/FLUX.1-schnell" :
                    model === "sdxl" ? "stabilityai/stable-diffusion-xl-base-1.0" :
                    model;

    const r = await fetch(`https://router.huggingface.co/hf-inference/models/${modelId}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${hfToken}`,
        "Content-Type": "application/json",
        "x-use-cache": "false",
      },
      body: JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: Math.min(steps, 8), width, height } }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!r.ok) {
      const errText = await r.text();
      res.status(502).json({ error: "ImageGenerationFailed", message: errText.slice(0, 200) });
      return;
    }

    const imageBuffer = await r.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString("base64");
    res.json({
      image: `data:image/png;base64,${base64}`,
      model: modelId,
      prompt,
      width,
      height,
      steps,
    });
  } catch (error) {
    res.status(500).json({ error: "ImageGenerationError", message: error instanceof Error ? error.message : "Unknown" });
  }
});

// ─── POST /api/v1/chat ────────────────────────────────────────────────────────
router.post("/chat", requireApiKey, rateLimit, async (req, res) => {
  const { message, model, conversationId, useRAG = true, systemPrompt } = req.body as {
    message?: string;
    model?: string;
    conversationId?: number;
    useRAG?: boolean;
    systemPrompt?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const start = Date.now();
  let convId = conversationId;
  let resolvedModel = model || req.apiKey?.defaultModel || "tinyllama";
  // Key-level persona: key's systemPrompt overrides default, request body overrides both
  const resolvedSystemPrompt = systemPrompt || req.apiKey?.systemPrompt || undefined;

  if (convId) {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    resolvedModel = model || conv.model || req.apiKey?.defaultModel || "tinyllama";
  } else {
    const title = message.slice(0, 60) + (message.length > 60 ? "..." : "");
    const [newConv] = await db.insert(conversationsTable).values({ title, model: resolvedModel }).returning();
    convId = newConv.id;
  }

  await db.insert(messagesTable).values({ conversationId: convId, role: "user", content: message });

  // Load conversation history for multi-turn context (last 8 exchanges)
  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, convId!))
    .orderBy(messagesTable.createdAt);
  const conversationHistory = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-16)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const ragContext = useRAG ? await retrieveRAGContext(message) : undefined;

  try {
    const { text: reply, provider, modelUsed } = await generateUnified(
      message, resolvedModel, ragContext, resolvedSystemPrompt, conversationHistory
    );
    const [aiMsg] = await db.insert(messagesTable).values({
      conversationId: convId,
      role: "assistant",
      content: reply,
      tokens: Math.round(reply.length / 4),
    }).returning();
    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, convId));

    res.json({
      reply,
      model: modelUsed,
      provider,
      conversationId: convId,
      messageId: aiMsg.id,
      tokens: aiMsg.tokens,
      ragContext: !!ragContext,
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    if (error instanceof OllamaError) {
      res.status(502).json(error.toJSON());
    } else {
      res.status(500).json({ error: "InferenceError", message: error instanceof Error ? error.message : "Unknown" });
    }
  }
});

// ─── POST /api/v1/chat/stream ─────────────────────────────────────────────────
router.post("/chat/stream", requireApiKey, rateLimit, async (req: Request, res: Response) => {
  const { message, model, conversationId, useRAG = true } = req.body as {
    message?: string;
    model?: string;
    conversationId?: number;
    useRAG?: boolean;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  let convId = conversationId;
  let resolvedModel = model || req.apiKey?.defaultModel || "tinyllama";

  if (convId) {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId));
    if (conv) resolvedModel = model || conv.model || req.apiKey?.defaultModel || "tinyllama";
  } else {
    const title = message.slice(0, 60) + (message.length > 60 ? "..." : "");
    const [newConv] = await db.insert(conversationsTable).values({ title, model: resolvedModel }).returning();
    convId = newConv.id;
  }

  await db.insert(messagesTable).values({ conversationId: convId, role: "user", content: message });

  const ragContext = useRAG ? await retrieveRAGContext(message) : undefined;

  // Intercept stream to persist AI message to DB
  let fullText = "";
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.write = function (chunk: unknown, ...args: unknown[]) {
    const text = typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk.toString() : String(chunk);
    try {
      const line = text.trim().replace(/^data:\s*/, "");
      if (line) {
        const parsed = JSON.parse(line) as { token?: string; done?: boolean; fullText?: string };
        if (parsed.token) fullText += parsed.token;
        if (parsed.fullText) fullText = parsed.fullText;
      }
    } catch { /* continue */ }
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  } as typeof res.write;

  res.end = function (...args: unknown[]) {
    if (fullText && convId) {
      db.insert(messagesTable)
        .values({ conversationId: convId as number, role: "assistant", content: fullText, tokens: Math.round(fullText.length / 4) })
        .then(() => db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, convId as number)))
        .catch((e) => console.error("[v1] Stream DB save error:", e));
    }
    return (origEnd as (...a: unknown[]) => typeof res)(...args);
  } as typeof res.end;

  res.setHeader("X-Conversation-Id", String(convId));

  const { provider: streamProvider, modelUsed: streamModel } = await streamUnified(message, resolvedModel, ragContext, res);
  res.setHeader("X-Model-Provider", streamProvider);
  res.setHeader("X-Model-Used", streamModel);
});

// ─── POST /api/v1/rag/search — real pgvector + BM25 hybrid ────────────────────
router.post("/rag/search", requireApiKey, rateLimit, async (req, res) => {
  const { query, topK = 5, searchType = "hybrid" } = req.body as {
    query?: string;
    topK?: number;
    searchType?: string;
  };

  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  try {
    const { generateEmbedding } = await import("./documents.js");
    let results: Array<{ documentId: number; title: string; snippet: string; score: number; rank: number; searchMethod: string }> = [];

    // Vector search
    if (searchType !== "keyword") {
      const queryVec = await generateEmbedding(query);
      if (queryVec && queryVec.length === EMBED_DIMS_V1) {
        try {
          const rows = await db.execute(sql`
            SELECT id, title, content,
                   CAST(1 - (embedding <=> ${pgVectorV1(queryVec)}::vector) AS FLOAT8) AS score
            FROM documents
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> ${pgVectorV1(queryVec)}::vector
            LIMIT ${topK}
          `) as unknown as Array<{ id: number; title: string; content: string; score: number }>;

          results = rows.map((r, i) => ({
            documentId: r.id,
            title: r.title,
            snippet: r.content?.slice(0, 400) + (r.content?.length > 400 ? "…" : "") || "",
            score: typeof r.score === "number" ? Math.round(r.score * 1000) / 1000 : 0,
            rank: i + 1,
            searchMethod: "vector",
          }));
        } catch { /* fall through */ }
      }
    }

    // BM25 keyword search (fallback or hybrid supplement)
    if (results.length === 0 || searchType === "hybrid") {
      const docs = await db.select().from(documentsTable);
      const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const N = docs.length;
      const df: Record<string, number> = {};
      const docData = docs.map((doc) => {
        const tokens = `${doc.title} ${doc.content || ""}`.toLowerCase().split(/\s+/);
        for (const t of new Set(tokens)) df[t] = (df[t] || 0) + 1;
        return { doc, tokens };
      });
      const avgDL = docData.reduce((s, d) => s + d.tokens.length, 0) / Math.max(N, 1);
      const bm25Results = docData.map(({ doc, tokens }) => {
        const tf: Record<string, number> = {};
        for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
        let score = 0;
        for (const q of queryWords) {
          const idf = Math.log((N - (df[q] || 0) + 0.5) / ((df[q] || 0) + 0.5) + 1);
          const f = tf[q] || 0;
          score += idf * (f * 2.5) / (f + 1.5 * (1 - 0.75 + 0.75 * tokens.length / avgDL));
        }
        return {
          documentId: doc.id,
          title: doc.title,
          snippet: (doc.content || "").slice(0, 400) + ((doc.content || "").length > 400 ? "…" : ""),
          score: Math.round(score * 1000) / 1000,
          searchMethod: "bm25",
        };
      }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);

      if (searchType === "hybrid") {
        const seenIds = new Set(results.map((r) => r.documentId));
        for (const r of bm25Results) {
          if (!seenIds.has(r.documentId)) {
            results.push({ ...r, rank: 0 });
            seenIds.add(r.documentId);
          }
        }
      } else {
        results = bm25Results.map((r) => ({ ...r, rank: 0 }));
      }
    }

    res.json(results.slice(0, topK).map((r, i) => ({ ...r, rank: i + 1 })));
  } catch (err) {
    res.status(500).json({ error: "SearchError", message: String(err) });
  }
});

// ─── Session API (WhatsApp / bot clients) ────────────────────────────────────
// Sessions map an external ID (phone number, user ID, etc.) to a DB conversation.
// Title format: "session:<sessionId>" — looked up on every request.

async function getOrCreateSession(
  sessionId: string,
  model: string
): Promise<{ conversationId: number; isNew: boolean }> {
  const title = `session:${sessionId}`;
  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.title, title))
    .limit(1);

  if (existing) return { conversationId: existing.id, isNew: false };

  const [created] = await db
    .insert(conversationsTable)
    .values({ title, model })
    .returning();
  return { conversationId: created.id, isNew: true };
}

/**
 * POST /api/v1/sessions/:sessionId/message
 * Send a message in a named session — auto-creates if new.
 * Perfect for WhatsApp bots: sessionId = phone number.
 */
router.post("/sessions/:sessionId/message", requireApiKey, rateLimit, async (req, res) => {
  const sessionId = String((req.params['sessionId'] as string));
  const { message, model, systemPrompt, useRAG = true } = req.body as {
    message?: string;
    model?: string;
    systemPrompt?: string;
    useRAG?: boolean;
  };

  if (!sessionId?.trim()) { res.status(400).json({ error: "sessionId is required" }); return; }
  if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }

  const resolvedModel = model || req.apiKey?.defaultModel || "groq:llama-3.3-70b-versatile";
  // Key-level persona overrides request-level systemPrompt if request doesn't supply one
  const resolvedSystemPrompt = systemPrompt || req.apiKey?.systemPrompt || undefined;
  const start = Date.now();

  const { conversationId, isNew } = await getOrCreateSession(sessionId, resolvedModel);

  await db.insert(messagesTable).values({ conversationId, role: "user", content: message });

  // Load real conversation history (last 16 messages for multi-turn memory)
  const historyRows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(messagesTable.createdAt);
  const conversationHistory = historyRows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-16)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const ragContext = useRAG ? await retrieveRAGContext(message) : undefined;

  try {
    const { text: reply, provider, modelUsed } = await generateUnified(
      message, resolvedModel, ragContext, resolvedSystemPrompt, conversationHistory
    );

    const [aiMsg] = await db.insert(messagesTable).values({
      conversationId,
      role: "assistant",
      content: reply,
      tokens: Math.round(reply.length / 4),
    }).returning();

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));

    const responsePayload = {
      reply,
      sessionId,
      conversationId,
      messageId: aiMsg.id,
      model: modelUsed,
      provider,
      isNewSession: isNew,
      ragContext: !!ragContext,
      historyLength: conversationHistory.length,
      latencyMs: Date.now() - start,
    };

    // ── Async webhook dispatch — fire and forget ──────────────────────────────
    const webhookUrl = req.apiKey?.webhookUrl;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DLavie-Event": "session.message.reply" },
        body: JSON.stringify({ ...responsePayload, timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(15_000),
      }).catch((e: unknown) => console.warn("[webhook] dispatch failed for", webhookUrl, String(e)));
    }

    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({
      error: "InferenceError",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/v1/sessions/:sessionId
 * Get session info and recent message count.
 */
router.get("/sessions/:sessionId", requireApiKey, rateLimit, async (req, res) => {
  const sessionId = String((req.params['sessionId'] as string));
  const title = `session:${sessionId}`;

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.title, title))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "SessionNotFound", message: `No session for '${sessionId}'` });
    return;
  }

  const [cnt] = await db.select({ c: count() }).from(messagesTable).where(eq(messagesTable.conversationId, conv.id));
  const lastMsg = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conv.id))
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);

  res.json({
    sessionId,
    conversationId: conv.id,
    model: conv.model,
    messageCount: cnt.c,
    lastMessage: lastMsg[0]
      ? { role: lastMsg[0].role, content: lastMsg[0].content.slice(0, 200), createdAt: lastMsg[0].createdAt }
      : null,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  });
});

/**
 * GET /api/v1/sessions/:sessionId/history
 * Get full conversation history for a session.
 */
router.get("/sessions/:sessionId/history", requireApiKey, rateLimit, async (req, res) => {
  const sessionId = String((req.params['sessionId'] as string));
  const limit = Math.min(parseInt(String(req.query.limit || "50"), 10), 200);
  const title = `session:${sessionId}`;

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.title, title))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "SessionNotFound", message: `No session for '${sessionId}'` });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conv.id))
    .orderBy(messagesTable.createdAt);

  res.json({
    sessionId,
    conversationId: conv.id,
    messages: messages.slice(-limit),
    total: messages.length,
  });
});

/**
 * DELETE /api/v1/sessions/:sessionId
 * Reset (delete) a session — clears all history.
 */
router.delete("/sessions/:sessionId", requireApiKey, rateLimit, async (req, res) => {
  const sessionId = String((req.params['sessionId'] as string));
  const title = `session:${sessionId}`;

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.title, title))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "SessionNotFound", message: `No session for '${sessionId}'` });
    return;
  }

  await db.delete(messagesTable).where(eq(messagesTable.conversationId, conv.id));
  await db.delete(conversationsTable).where(eq(conversationsTable.id, conv.id));

  res.json({ success: true, sessionId, deletedConversationId: conv.id });
});

/**
 * GET /api/v1/sessions
 * List all active sessions.
 */
router.get("/sessions", requireApiKey, rateLimit, async (_req, res) => {
  const sessions = await db
    .select()
    .from(conversationsTable)
    .orderBy(desc(conversationsTable.updatedAt));

  const filtered = sessions.filter((s) => s.title.startsWith("session:"));

  const withCounts = await Promise.all(
    filtered.map(async (s) => {
      const [cnt] = await db.select({ c: count() }).from(messagesTable).where(eq(messagesTable.conversationId, s.id));
      return {
        sessionId: s.title.replace(/^session:/, ""),
        conversationId: s.id,
        model: s.model,
        messageCount: cnt.c,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    })
  );

  res.json({ sessions: withCounts, total: withCounts.length });
});

// ─── Conversation endpoints ───────────────────────────────────────────────────
router.get("/conversations", requireApiKey, rateLimit, async (_req, res) => {
  const rows = await db.select().from(conversationsTable).orderBy(desc(conversationsTable.updatedAt));
  const results = await Promise.all(
    rows.map(async (conv) => {
      const [cnt] = await db.select({ c: count() }).from(messagesTable).where(eq(messagesTable.conversationId, conv.id));
      return { ...conv, messageCount: cnt.c };
    })
  );
  res.json(results);
});

router.post("/conversations", requireApiKey, rateLimit, async (req, res) => {
  const { title, model } = req.body as { title?: string; model?: string };
  const [row] = await db.insert(conversationsTable).values({
    title: title || "New Conversation",
    model: model || "tinyllama",
  }).returning();
  res.status(201).json({ ...row, messageCount: 0 });
});

router.get("/conversations/:id", requireApiKey, rateLimit, async (req, res) => {
  const id = parseInt((req.params['id'] as string), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  const messages = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);
  res.json({ ...conv, messages });
});

router.delete("/conversations/:id", requireApiKey, rateLimit, async (req, res) => {
  const id = parseInt((req.params['id'] as string), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
  const [conv] = await db.delete(conversationsTable).where(eq(conversationsTable.id, id)).returning();
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.status(204).send();
});

// ─── POST /api/v1/benchmark ───────────────────────────────────────────────────
// Test all active providers with the same prompt, return a comparison table.
router.post("/benchmark", requireApiKey, rateLimit, async (req, res) => {
  const { message = "Respond with exactly: BENCHMARK_OK", providers: reqProviders } = req.body as {
    message?: string;
    providers?: string[];
  };

  const activeProviders: Array<{ id: string; model: string; enabled: boolean }> = [
    { id: "groq",        model: "groq:llama-3.1-8b-instant",   enabled: isGroqConfigured() },
    { id: "openrouter",  model: "openrouter:microsoft/phi-4",   enabled: isOpenRouterConfigured() },
    { id: "ollama",      model: "tinyllama",                    enabled: true },
  ].filter((p) => {
    if (reqProviders && reqProviders.length > 0) return reqProviders.includes(p.id);
    return p.enabled;
  });

  const results = await Promise.allSettled(
    activeProviders.map(async (p) => {
      const t0 = Date.now();
      try {
        const { text, modelUsed } = await generateUnified(message, p.model, undefined, undefined, undefined);
        return { provider: p.id, model: modelUsed, ok: true, latencyMs: Date.now() - t0, reply: text.slice(0, 200) };
      } catch (e) {
        return { provider: p.id, model: p.model, ok: false, latencyMs: Date.now() - t0, error: String(e) };
      }
    })
  );

  const rows = results.map((r) =>
    r.status === "fulfilled" ? r.value : { provider: "?", model: "?", ok: false, latencyMs: 0, error: String(r.reason) }
  );

  rows.sort((a, b) => (a.ok && !b.ok ? -1 : !a.ok && b.ok ? 1 : (a as { latencyMs: number }).latencyMs - (b as { latencyMs: number }).latencyMs));

  res.json({
    prompt: message,
    results: rows,
    fastest: rows.find((r) => r.ok)?.provider ?? null,
    testedAt: new Date().toISOString(),
  });
});

// ─── GET /api/v1/stats ────────────────────────────────────────────────────────
router.get("/stats", requireApiKey, rateLimit, async (_req, res) => {
  const { isOllamaOnline } = await import("../ollama.js");
  const { isHFConfigured } = await import("../huggingface.js");
  const { isKimiConfigured } = await import("../kimi.js");
  const { getAutoTrainingStatus } = await import("../autotraining.js");
  const [convs] = await db.select({ c: count() }).from(conversationsTable);
  const [msgs] = await db.select({ c: count() }).from(messagesTable);
  const [docs] = await db.select({ c: count() }).from(documentsTable);
  const [mods] = await db.select({ c: count() }).from(aiModelsTable);
  const ollamaModels = await listOllamaModels();
  const at = getAutoTrainingStatus();
  const ollamaOnline = await isOllamaOnline();

  res.json({
    system: "DLavie OS",
    version: "1.0.0",
    conversations: convs.c,
    messages: msgs.c,
    documents: docs.c,
    registeredModels: mods.c,
    ollamaModels: ollamaModels.length,
    installedModels: ollamaModels.map((m) => m.name),
    providers: {
      groq:        { connected: isGroqConfigured(),        priority: 1 },
      openrouter:  { connected: isOpenRouterConfigured(),  priority: 2 },
      huggingface: { connected: isHFConfigured(),          priority: 3 },
      kimi:        { connected: isKimiConfigured(),        priority: 4 },
      ollama:      { online: ollamaOnline, models: ollamaModels.length, priority: 5 },
    },
    fallbackChain: ["groq", "openrouter", "hf", "ollama"],
    autoTraining: {
      running: at.running,
      cyclesCompleted: at.totalCyclesCompleted,
      samplesAdded: at.totalSamplesAdded,
      lastCycleAt: at.lastCycleAt,
      nextCycleAt: at.nextCycleAt,
      sources: ["wikipedia", "hackernews", "reddit", "arxiv", "rss", "huggingface"],
    },
    rateLimit: { windowMs: RATE_WINDOW_MS, maxRequests: RATE_MAX },
    systemStatus: "online",
    timestamp: new Date().toISOString(),
  });
});

export default router;
