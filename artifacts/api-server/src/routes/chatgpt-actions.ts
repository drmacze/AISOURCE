/**
 * DLavie OS — ChatGPT Actions Integration v3
 *
 * Full CRUD + AI inference endpoints for ChatGPT to manage DLavie OS.
 * CORS is fully open so ChatGPT's servers can reach these endpoints.
 *
 * Routes (all under /api/chatgpt/*):
 *   GET  /chatgpt/status                       — public system status
 *   POST /chatgpt/chat                         — AI inference (best provider)
 *   GET  /chatgpt/conversations                — list conversations
 *   GET  /chatgpt/conversations/:id            — conversation + messages
 *   POST /chatgpt/conversations                — create conversation
 *   POST /chatgpt/conversations/:id/messages   — add message
 *   DELETE /chatgpt/conversations/:id          — delete conversation
 *   GET  /chatgpt/documents                    — list knowledge base docs
 *   POST /chatgpt/documents                    — create document
 *   PATCH /chatgpt/documents/:id               — edit document
 *   DELETE /chatgpt/documents/:id              — delete document
 *   GET  /chatgpt/search?q=...                 — search knowledge base
 *   GET  /chatgpt/training                     — list training samples
 *   POST /chatgpt/training                     — add training sample
 *   GET  /chatgpt/settings                     — read settings/providers
 *   POST /chatgpt/settings                     — save API keys
 *   GET  /chatgpt/models                       — list AI models
 *   GET  /chatgpt/agents                       — agent system status
 *   GET  /chatgpt/providers                    — provider health check
 *   POST /chatgpt/kaggle/sync                  — trigger dataset sync
 *   POST /chatgpt/kaggle/train                 — trigger GPU training
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  documentsTable,
  trainingSamplesTable,
  trainingDatasetsTable,
} from "@workspace/db";
import { eq, desc, or, ilike } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const router: IRouter = Router();

// ─── CORS — allow ChatGPT servers (openai.com) to call these endpoints ────────
function corsHeaders(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DLavie-Key");
}

router.options("/chatgpt/{*path}", (req: Request, res: Response) => {
  corsHeaders(res);
  res.status(204).end();
});

// Apply CORS to every chatgpt response
router.use("/chatgpt", (_req: Request, res: Response, next: () => void) => {
  corsHeaders(res);
  next();
});

// ─── Auth middleware (optional Bearer token) ───────────────────────────────────
function chatgptAuth(req: Request, res: Response, next: () => void) {
  const envKey = process.env.DLAVIE_API_KEY || "";
  if (!envKey) return next();
  const auth = req.headers["authorization"] || req.headers["x-dlavie-key"] || "";
  const token = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (token === envKey) return next();
  res.status(401).json({
    error: "Unauthorized",
    message: "Set Authorization: Bearer <DLAVIE_API_KEY> or leave DLAVIE_API_KEY unset for open access.",
  });
}

// ─── Config file path ──────────────────────────────────────────────────────────
const CONFIG_PATH = join(
  process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace",
  ".dlavie-config.json",
);

function loadConfig(): Record<string, unknown> {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
  } catch { /* ignore */ }
  return {};
}

function saveConfig(data: Record<string, unknown>) {
  const current = loadConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...data }, null, 2), "utf8");
}

function maskKey(key: string | undefined): string {
  if (!key || key.length < 8) return key ? "***" : "(not set)";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

// ─── GET /chatgpt/status — public system status ───────────────────────────────
router.get("/chatgpt/status", async (_req: Request, res: Response) => {
  try {
    const [convCount]   = await db.select({ count: db.$count(conversationsTable) }).from(conversationsTable);
    const [docCount]    = await db.select({ count: db.$count(documentsTable) }).from(documentsTable);
    const [sampleCount] = await db.select({ count: db.$count(trainingSamplesTable) }).from(trainingSamplesTable);
    const ollamaOk = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok).catch(() => false);
    res.json({
      status: "online",
      version: "3.0",
      name: "DLavie OS AI Command Center",
      capabilities: ["chat", "rag", "training", "kaggle", "agents", "settings"],
      providers: {
        groq:        !!process.env.GROQ_API_KEY,
        openrouter:  !!process.env.OPENROUTER_API_KEY,
        huggingface: !!process.env.HF_TOKEN,
        ollama:      ollamaOk,
      },
      stats: {
        conversations:   Number(convCount?.count   ?? 0),
        documents:       Number(docCount?.count     ?? 0),
        trainingSamples: Number(sampleCount?.count  ?? 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.json({ status: "online", version: "3.0", name: "DLavie OS AI Command Center", timestamp: new Date().toISOString() });
  }
});

// ─── POST /chatgpt/chat — AI inference ────────────────────────────────────────
router.post("/chatgpt/chat", chatgptAuth, async (req: Request, res: Response) => {
  const { message, system, conversationId } = req.body as {
    message?: string;
    system?: string;
    conversationId?: number;
  };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const systemPrompt = system ||
    "Kamu adalah DLavie OS AI Assistant — asisten AI lokal yang membantu pengguna mengelola DLavie OS. " +
    "Jawab dalam bahasa yang sama dengan pertanyaan pengguna. Berikan jawaban yang helpful, konkret, dan ringkas.";

  try {
    // Build context from conversation history if conversationId given
    let ragContext = "";
    if (conversationId) {
      const msgs = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversationId))
        .orderBy(messagesTable.createdAt);
      if (msgs.length > 0) {
        ragContext = msgs.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n");
      }
    }

    const result = await generateWithFallback(message, ragContext || undefined, systemPrompt);
    const reply = typeof result === "string" ? result : result.text;
    const provider = typeof result === "object" ? result.provider : "unknown";
    const model    = typeof result === "object" ? result.modelUsed : "unknown";

    // Save to conversation if given
    if (conversationId) {
      await db.insert(messagesTable).values({
        conversationId,
        role: "user",
        content: message,
        createdAt: new Date(),
      });
      await db.insert(messagesTable).values({
        conversationId,
        role: "assistant",
        content: reply,
        createdAt: new Date(),
      });
      await db.update(conversationsTable)
        .set({ updatedAt: new Date() })
        .where(eq(conversationsTable.id, conversationId));
    }

    res.json({ reply, provider, model, conversationId: conversationId ?? null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Conversations ─────────────────────────────────────────────────────────────
router.get("/chatgpt/conversations", chatgptAuth, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  try {
    const convs = await db.select().from(conversationsTable)
      .orderBy(desc(conversationsTable.updatedAt)).limit(limit);
    res.json({ conversations: convs, count: convs.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/chatgpt/conversations/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    const msgs = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, id)).orderBy(messagesTable.createdAt);
    res.json({ conversation: conv, messages: msgs });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/chatgpt/conversations", chatgptAuth, async (req: Request, res: Response) => {
  const { title } = req.body as { title?: string };
  try {
    const [conv] = await db.insert(conversationsTable)
      .values({ title: title || "ChatGPT Session", createdAt: new Date(), updatedAt: new Date() })
      .returning();
    res.status(201).json({ conversation: conv });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/chatgpt/conversations/:id/messages", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { role, content } = req.body as { role?: string; content?: string };
  if (!content) { res.status(400).json({ error: "content is required" }); return; }
  try {
    const [msg] = await db.insert(messagesTable)
      .values({ conversationId: id, role: (role || "user") as "user" | "assistant", content, createdAt: new Date() })
      .returning();
    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, id));
    res.status(201).json({ message: msg });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.delete("/chatgpt/conversations/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
    res.json({ ok: true, deleted: id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Documents ─────────────────────────────────────────────────────────────────
router.get("/chatgpt/documents", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const docs = await db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt)).limit(100);
    res.json({ documents: docs, count: docs.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/chatgpt/documents", chatgptAuth, async (req: Request, res: Response) => {
  const { title, content, type } = req.body as { title?: string; content?: string; type?: string };
  if (!title || !content) { res.status(400).json({ error: "title and content are required" }); return; }
  try {
    const [doc] = await db.insert(documentsTable)
      .values({ title, content, fileType: type || "text" }).returning();
    res.status(201).json({ document: doc });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/chatgpt/documents/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { title, content } = req.body as { title?: string; content?: string };
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title)   updates.title   = title;
    if (content) updates.content = content;
    const [doc] = await db.update(documentsTable).set(updates).where(eq(documentsTable.id, id)).returning();
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    res.json({ document: doc });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.delete("/chatgpt/documents/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.delete(documentsTable).where(eq(documentsTable.id, id));
    res.json({ ok: true, deleted: id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Search ────────────────────────────────────────────────────────────────────
router.get("/chatgpt/search", chatgptAuth, async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (!q) { res.status(400).json({ error: "q query param is required" }); return; }
  try {
    const docs = await db.select().from(documentsTable)
      .where(or(ilike(documentsTable.title, `%${q}%`), ilike(documentsTable.content, `%${q}%`)))
      .limit(10);
    res.json({ query: q, results: docs, count: docs.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Training samples ──────────────────────────────────────────────────────────
router.get("/chatgpt/training", chatgptAuth, async (req: Request, res: Response) => {
  const limit  = Math.min(Number(req.query.limit  || 50), 200);
  const offset = Number(req.query.offset || 0);
  try {
    const samples = await db.select().from(trainingSamplesTable).limit(limit).offset(offset);
    const [total] = await db.select({ count: db.$count(trainingSamplesTable) }).from(trainingSamplesTable);
    res.json({ samples, total: Number(total?.count ?? 0), limit, offset });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/chatgpt/training", chatgptAuth, async (req: Request, res: Response) => {
  const { input, output, datasetId } = req.body as { input?: string; output?: string; datasetId?: number };
  if (!input || !output) { res.status(400).json({ error: "input and output are required" }); return; }
  try {
    let dsId = datasetId;
    if (!dsId) {
      const [ds] = await db.select().from(trainingDatasetsTable).limit(1);
      dsId = ds?.id;
    }
    if (!dsId) {
      const [ds] = await db.insert(trainingDatasetsTable)
        .values({ name: "ChatGPT Samples", description: "Added via ChatGPT Actions", taskType: "chat" })
        .returning();
      dsId = ds!.id;
    }
    const [sample] = await db.insert(trainingSamplesTable)
      .values({ datasetId: dsId as number, input: input as string, output: output as string })
      .returning();
    res.status(201).json({ sample });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Settings — read/write API keys & config ───────────────────────────────────
router.get("/chatgpt/settings", chatgptAuth, async (_req: Request, res: Response) => {
  const ollamaOk = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok).catch(() => false);
  res.json({
    providers: {
      groq:       { configured: !!process.env.GROQ_API_KEY,       key: maskKey(process.env.GROQ_API_KEY) },
      openrouter: { configured: !!process.env.OPENROUTER_API_KEY, key: maskKey(process.env.OPENROUTER_API_KEY) },
      huggingface: { configured: !!process.env.HF_TOKEN,          key: maskKey(process.env.HF_TOKEN) },
      ollama:     { running: ollamaOk, model: "tinyllama" },
    },
    dlavieApiKey:    maskKey(process.env.DLAVIE_API_KEY),
    githubToken:     maskKey(process.env.GITHUB_TOKEN),
    kaggleUsername:  process.env.KAGGLE_USERNAME || "(not set)",
    kaggleKey:       maskKey(process.env.KAGGLE_KEY),
    telegramToken:   maskKey(process.env.TELEGRAM_BOT_TOKEN),
  });
});

const ALLOWED_SETTINGS_KEYS = new Set([
  "GROQ_API_KEY", "OPENROUTER_API_KEY", "HF_TOKEN", "GITHUB_TOKEN",
  "DLAVIE_API_KEY", "KAGGLE_USERNAME", "KAGGLE_KEY", "TELEGRAM_BOT_TOKEN",
  "MOONSHOT_API_KEY", "ANTHROPIC_API_KEY",
]);

router.post("/chatgpt/settings", chatgptAuth, async (req: Request, res: Response) => {
  const body = req.body as Record<string, string>;
  const saved: string[] = [];
  const rejected: string[] = [];

  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_SETTINGS_KEYS.has(k)) { rejected.push(k); continue; }
    if (typeof v !== "string" || !v.trim()) continue;
    process.env[k] = v.trim();
    saved.push(k);
  }

  // Persist to config file
  if (saved.length > 0) {
    const cfg = loadConfig();
    const secrets = (cfg.secrets as Record<string, string>) || {};
    for (const k of saved) secrets[k] = process.env[k]!;
    saveConfig({ ...cfg, secrets });
  }

  res.json({
    ok: true,
    saved,
    rejected,
    message: saved.length > 0
      ? `Saved: ${saved.join(", ")}. Changes are live immediately.`
      : "No valid settings provided.",
  });
});

// ─── Models — list Ollama models + providers ───────────────────────────────────
router.get("/chatgpt/models", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const ollamaModels = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((d: { models?: Array<{ name: string; size: number; modified_at: string }> }) =>
        (d.models || []).map((m) => ({ name: m.name, size: m.size, modifiedAt: m.modified_at, source: "ollama" })))
      .catch(() => []);

    const registered = await db.select().from(
      (await import("@workspace/db")).modelsTable ?? documentsTable
    ).limit(50).catch(() => []);

    res.json({
      ollama: { running: ollamaModels.length >= 0, models: ollamaModels },
      providers: {
        groq:        { active: !!process.env.GROQ_API_KEY,       defaultModel: "llama-3.3-70b-versatile" },
        openrouter:  { active: !!process.env.OPENROUTER_API_KEY, defaultModel: "qwen/qwen3-235b-a22b:free" },
        huggingface: { active: !!process.env.HF_TOKEN,           defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
      },
      registered,
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Agents — status of all 24 agents ─────────────────────────────────────────
router.get("/chatgpt/agents", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/workers/status", { signal: AbortSignal.timeout(3000) });
    const data = await r.json() as Record<string, unknown>;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Provider health ───────────────────────────────────────────────────────────
router.get("/chatgpt/providers", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/providers/health", { signal: AbortSignal.timeout(8000) });
    const data = await r.json() as Record<string, unknown>;
    res.json(data);
  } catch (e) {
    // Quick local check fallback
    const ollamaOk = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok).catch(() => false);
    res.json({
      groq:        { available: !!process.env.GROQ_API_KEY,       note: process.env.GROQ_API_KEY ? "key configured" : "no key" },
      openrouter:  { available: !!process.env.OPENROUTER_API_KEY, note: process.env.OPENROUTER_API_KEY ? "key configured" : "no key" },
      huggingface: { available: !!process.env.HF_TOKEN,           note: process.env.HF_TOKEN ? "key configured" : "no key" },
      ollama:      { available: ollamaOk,                         note: ollamaOk ? "running" : "not running" },
      error: String(e),
    });
  }
});

// ─── Kaggle ────────────────────────────────────────────────────────────────────
router.post("/chatgpt/kaggle/sync", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/kaggle/dataset/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetId: 1 }),
      signal: AbortSignal.timeout(60_000),
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/chatgpt/kaggle/train", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/kaggle/kernels/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kernelSlug: "dlavie-os-lora-finetuning" }),
      signal: AbortSignal.timeout(60_000),
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
