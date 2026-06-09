/**
 * DLavie OS Public API — v1
 *
 * Multi-platform AI API. Supports Ollama (local), Kimi K2 (MoonshotAI),
 * HuggingFace Inference, and cloud models via unified endpoints.
 *
 * Authentication
 * ─────────────────────────────────────────────────────────────────────────────
 *   X-API-Key: nxs_...
 *   X-DLavie-Key: nxs_...
 *   Authorization: Bearer nxs_...
 *
 * Rate Limit: 120 req/min per key (configurable via NEXUS_RATE_LIMIT env)
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  documentsTable,
  aiModelsTable,
} from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import {
  generateOllamaResponse,
  streamOllamaResponse,
  listOllamaModels,
  OllamaError,
} from "../ollama";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = parseInt(process.env.NEXUS_RATE_LIMIT || "120", 10);
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function getRateLimitKey(req: Request): string {
  const keyHeader =
    (req.headers["x-api-key"] as string) ||
    (req.headers["x-dlavie-key"] as string) ||
    (req.headers["x-nexus-key"] as string) ||
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
// requireAuth is imported from ../lib/auth — validates against DB or NEXUS_API_KEY master key
const requireApiKey = requireAuth("write");

// ─── Multi-model router ───────────────────────────────────────────────────────

type ModelProvider = "ollama" | "kimi" | "hf" | "unknown";

function detectProvider(model: string): ModelProvider {
  const m = model.toLowerCase();
  if (m.startsWith("kimi/") || m.startsWith("moonshotai/") || m === "kimi-k2") return "kimi";
  if (m.startsWith("hf/") || m.startsWith("huggingface/")) return "hf";
  if (!m || m === "auto") return "ollama";
  return "ollama";
}

async function generateUnified(
  message: string,
  model: string,
  ragContext?: string,
  systemPrompt?: string
): Promise<string> {
  const provider = detectProvider(model);

  if (provider === "kimi") {
    try {
      const { generateKimiResponse } = await import("../kimi");
      const kimiModel = model.replace(/^kimi\//i, "").replace(/^moonshotai\//i, "") || "kimi-k2-instruct";
      return await generateKimiResponse(message, kimiModel, ragContext);
    } catch (e) {
      console.warn("[v1] Kimi fallback to Ollama:", e);
      return generateOllamaResponse(message, "tinyllama", ragContext, systemPrompt);
    }
  }

  if (provider === "hf") {
    try {
      const { generateHFResponse, isHFConfigured } = await import("../huggingface");
      if (!isHFConfigured()) throw new Error("HF_TOKEN not configured");
      const hfModel = model.replace(/^hf\//i, "").replace(/^huggingface\//i, "");
      const prompt = ragContext ? `Context:\n${ragContext}\n\nUser: ${message}` : message;
      return await generateHFResponse(prompt, hfModel);
    } catch (e) {
      console.warn("[v1] HF fallback to Ollama:", e);
      return generateOllamaResponse(message, "tinyllama", ragContext, systemPrompt);
    }
  }

  return generateOllamaResponse(message, model || "tinyllama", ragContext, systemPrompt);
}

async function streamUnified(
  message: string,
  model: string,
  ragContext: string | undefined,
  res: Response
): Promise<void> {
  const provider = detectProvider(model);

  if (provider === "kimi") {
    try {
      const { streamKimiResponse } = await import("../kimi");
      const kimiModel = model.replace(/^kimi\//i, "").replace(/^moonshotai\//i, "") || "kimi-k2-instruct";
      await streamKimiResponse(message, kimiModel, ragContext, res);
      return;
    } catch (e) {
      console.warn("[v1] Kimi stream fallback:", e);
    }
  }

  await streamOllamaResponse(message, model || "tinyllama", ragContext, res);
}

// ─── RAG context helper ───────────────────────────────────────────────────────
async function retrieveRAGContext(query: string): Promise<string | undefined> {
  try {
    const docs = await db.select().from(documentsTable);
    if (!docs.length) return undefined;
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!queryWords.length) return undefined;
    const scored = docs.map((doc) => {
      const text = `${doc.title} ${doc.content || ""}`.toLowerCase();
      const matchCount = queryWords.filter((w) => text.includes(w)).length;
      return { doc, score: matchCount / queryWords.length };
    });
    const relevant = scored
      .filter((s) => s.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (!relevant.length) return undefined;
    return relevant
      .map((r) => {
        const snippet =
          r.doc.content && r.doc.content.length > 800
            ? r.doc.content.slice(0, 800) + "..."
            : r.doc.content || "";
        return `[${r.doc.title}]\n${snippet}`;
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
  const { isOllamaOnline } = await import("../ollama");
  const { isHFConfigured } = await import("../huggingface");
  const { isKimiConfigured } = await import("../kimi");
  const ollamaOnline = await isOllamaOnline();
  res.json({
    status: "online",
    version: "1.0.0",
    system: "DLavie OS",
    engine: ollamaOnline ? "Ollama (local)" : isHFConfigured() ? "HuggingFace (fallback)" : "rule-based",
    ollama: ollamaOnline,
    ollamaHost: "127.0.0.1:11434",
    huggingface: isHFConfigured(),
    kimi: isKimiConfigured(),
    rateLimit: { windowMs: RATE_WINDOW_MS, maxRequests: RATE_MAX },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
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
  const { isHFConfigured } = await import("../huggingface");
  const { isKimiConfigured } = await import("../kimi");
  const ollamaModels = await listOllamaModels();

  const cloudModels = [
    // Kimi K2
    {
      id: "kimi/kimi-k2-instruct",
      name: "Kimi K2 Instruct",
      provider: "kimi",
      backend: "HuggingFace Router",
      parameters: "1T MoE",
      ready: isKimiConfigured(),
      requiresKey: "HF_TOKEN",
      description: "MoonshotAI Kimi K2 — 1 trillion parameter MoE via HuggingFace Router",
      useIn: "model field as 'kimi/kimi-k2-instruct'",
    },
    {
      id: "kimi/kimi-k2-0711-preview",
      name: "Kimi K2 Preview",
      provider: "kimi",
      backend: "Moonshot API",
      parameters: "1T MoE",
      ready: !!process.env.MOONSHOT_API_KEY,
      requiresKey: "MOONSHOT_API_KEY",
      description: "MoonshotAI Kimi K2 Preview — official Moonshot API",
      useIn: "model field as 'kimi/kimi-k2-0711-preview'",
    },
    // HuggingFace
    {
      id: "hf/meta-llama/Llama-3.1-8B-Instruct",
      name: "Llama 3.1 8B",
      provider: "hf",
      backend: "HuggingFace Inference",
      parameters: "8B",
      ready: isHFConfigured(),
      requiresKey: "HF_TOKEN",
      description: "Meta Llama 3.1 8B Instruct via HuggingFace Inference API",
      useIn: "model field as 'hf/meta-llama/Llama-3.1-8B-Instruct'",
    },
    {
      id: "hf/mistralai/Mistral-7B-Instruct-v0.3",
      name: "Mistral 7B Instruct",
      provider: "hf",
      backend: "HuggingFace Inference",
      parameters: "7B",
      ready: isHFConfigured(),
      requiresKey: "HF_TOKEN",
      description: "Mistral 7B Instruct via HuggingFace",
      useIn: "model field as 'hf/mistralai/Mistral-7B-Instruct-v0.3'",
    },
    {
      id: "hf/Qwen/Qwen2.5-72B-Instruct",
      name: "Qwen 2.5 72B",
      provider: "hf",
      backend: "HuggingFace Inference",
      parameters: "72B",
      ready: isHFConfigured(),
      requiresKey: "HF_TOKEN",
      description: "Qwen 2.5 72B Instruct via HuggingFace",
      useIn: "model field as 'hf/Qwen/Qwen2.5-72B-Instruct'",
    },
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
      headers: ["X-API-Key: nxs_...", "X-DLavie-Key: nxs_...", "Authorization: Bearer nxs_..."],
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
  const { question, model = "tinyllama", useRAG = true, context: extraContext } = req.body as {
    question?: string;
    model?: string;
    useRAG?: boolean;
    context?: string;
  };

  if (!question?.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const start = Date.now();
  let ragContext = useRAG ? await retrieveRAGContext(question) : undefined;
  if (extraContext) ragContext = extraContext + (ragContext ? "\n\n" + ragContext : "");

  try {
    const answer = await generateUnified(question, model, ragContext);
    res.json({
      answer,
      model,
      provider: detectProvider(model),
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
  const { questions, model = "tinyllama", useRAG = false } = req.body as {
    questions?: string[];
    model?: string;
    useRAG?: boolean;
  };

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
      const answer = await generateUnified(q, model, ragContext);
      return { index: i, question: q, answer, model, provider: detectProvider(model) };
    })
  );

  res.json({
    results: results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { index: i, question: questions[i], answer: null, error: r.reason?.message || "Failed" }
    ),
    count: questions.length,
    model,
    provider: detectProvider(model),
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

    // Fallback: simple hash-based pseudo-embedding (for compatibility)
    const pseudoEmbedding = Array.from({ length: 384 }, (_, i) => {
      let h = 0;
      for (let j = 0; j < text.length; j++) h = (h * 31 + text.charCodeAt(j) + i) & 0xffffffff;
      return (h / 0xffffffff) * 2 - 1;
    });
    res.json({
      embedding: pseudoEmbedding,
      dimensions: 384,
      model: "fallback-hash",
      note: "Ollama embedding model not available. Install nomic-embed-text for real embeddings.",
      text: text.slice(0, 100),
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
    const { isHFConfigured } = await import("../huggingface");
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
  const { message, model = "tinyllama", conversationId, useRAG = true, systemPrompt } = req.body as {
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
  let resolvedModel = model;

  if (convId) {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    resolvedModel = model || conv.model || "tinyllama";
  } else {
    const title = message.slice(0, 60) + (message.length > 60 ? "..." : "");
    const [newConv] = await db.insert(conversationsTable).values({ title, model: resolvedModel }).returning();
    convId = newConv.id;
  }

  await db.insert(messagesTable).values({ conversationId: convId, role: "user", content: message });

  let ragContext = useRAG ? await retrieveRAGContext(message) : undefined;
  const prompt = systemPrompt ? `${systemPrompt}\n\nUser: ${message}` : message;

  try {
    const reply = await generateUnified(prompt, resolvedModel, ragContext, systemPrompt);
    const [aiMsg] = await db.insert(messagesTable).values({
      conversationId: convId,
      role: "assistant",
      content: reply,
      tokens: Math.round(reply.length / 4),
    }).returning();
    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, convId));

    res.json({
      reply,
      model: resolvedModel,
      provider: detectProvider(resolvedModel),
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
  const { message, model = "tinyllama", conversationId, useRAG = true } = req.body as {
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
  let resolvedModel = model;

  if (convId) {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId));
    if (conv) resolvedModel = model || conv.model || "tinyllama";
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
  res.setHeader("X-Model-Provider", detectProvider(resolvedModel));

  await streamUnified(message, resolvedModel, ragContext, res);
});

// ─── POST /api/v1/rag/search ──────────────────────────────────────────────────
router.post("/rag/search", requireApiKey, rateLimit, async (req, res) => {
  const { query, topK = 5, searchType = "hybrid" } = req.body as {
    query?: string;
    topK?: number;
    searchType?: string;
  };

  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const docs = await db.select().from(documentsTable);
  const q = query.toLowerCase();
  const queryWords = q.split(/\s+/);

  const scored = docs.map((doc) => {
    const title = doc.title?.toLowerCase() || "";
    const content = doc.content?.toLowerCase() || "";
    let score = 0;

    if (searchType === "keyword" || searchType === "hybrid") {
      if (title.includes(q)) score += 0.5;
      const occ = (content.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      score += Math.min(occ * 0.1, 0.4);
    }
    if (searchType === "semantic" || searchType === "hybrid") {
      const docWords = (title + " " + content).split(/\s+/);
      const overlap = queryWords.filter((w) => docWords.includes(w)).length;
      score += overlap * 0.05;
    }

    return {
      documentId: doc.id,
      title: doc.title,
      snippet: content.length > 300 ? content.slice(0, 300) + "..." : content,
      score,
      rank: 0,
    };
  });

  const results = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s, i) => ({ ...s, rank: i + 1, score: Math.min(s.score, 1.0) }));

  res.json(results);
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
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  const messages = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);
  res.json({ ...conv, messages });
});

router.delete("/conversations/:id", requireApiKey, rateLimit, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
  const [conv] = await db.delete(conversationsTable).where(eq(conversationsTable.id, id)).returning();
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.status(204).send();
});

// ─── GET /api/v1/stats ────────────────────────────────────────────────────────
router.get("/stats", requireApiKey, rateLimit, async (_req, res) => {
  const { isOllamaOnline } = await import("../ollama");
  const { isHFConfigured } = await import("../huggingface");
  const { isKimiConfigured } = await import("../kimi");
  const { getAutoTrainingStatus } = await import("../autotraining");
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
      ollama: { online: ollamaOnline, models: ollamaModels.length },
      huggingface: { connected: isHFConfigured() },
      kimi: { connected: isKimiConfigured() },
    },
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
