/**
 * DLavie OS — ChatGPT Actions Integration
 *
 * Exposes DLavie OS data to ChatGPT via OpenAI's "Actions" system.
 * ChatGPT can read, write, and edit conversations, documents, training data, and more.
 *
 * Routes (all under /api/chatgpt/*):
 *   GET  /chatgpt/status            — public system status
 *   GET  /chatgpt/conversations      — list conversations
 *   GET  /chatgpt/conversations/:id  — get conversation + messages
 *   POST /chatgpt/conversations      — create conversation
 *   POST /chatgpt/conversations/:id/messages — send message
 *   DELETE /chatgpt/conversations/:id — delete conversation
 *   GET  /chatgpt/documents          — list documents
 *   POST /chatgpt/documents          — create document
 *   PATCH /chatgpt/documents/:id     — edit document
 *   DELETE /chatgpt/documents/:id    — delete document
 *   GET  /chatgpt/search             — search knowledge base
 *   GET  /chatgpt/training           — list training samples
 *   POST /chatgpt/training           — add training sample
 *   POST /chatgpt/kaggle/sync        — trigger dataset sync
 *   POST /chatgpt/kaggle/train       — trigger GPU training
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
import { eq, desc, like, or, ilike } from "drizzle-orm";

const router: IRouter = Router();

// ── Auth middleware (optional Bearer token) ───────────────────────────────────
// ChatGPT sends the API key as "Bearer <key>" in Authorization header.
// If DLAVIE_API_KEY is set, enforce it. Otherwise allow open access.
function chatgptAuth(req: Request, res: Response, next: () => void) {
  const envKey = process.env.DLAVIE_API_KEY || "";
  if (!envKey) return next();
  const auth = req.headers["authorization"] || req.headers["x-dlavie-key"] || "";
  const token = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (token === envKey) return next();
  res.status(401).json({ error: "Unauthorized", message: "Valid API key required. Set Authorization: Bearer <DLAVIE_API_KEY>" });
}

// ── Public: system status ─────────────────────────────────────────────────────
router.get("/chatgpt/status", async (_req: Request, res: Response) => {
  try {
    const [convCount] = await db.select({ count: db.$count(conversationsTable) }).from(conversationsTable);
    const [docCount]  = await db.select({ count: db.$count(documentsTable) }).from(documentsTable);
    const [sampleCount] = await db.select({ count: db.$count(trainingSamplesTable) }).from(trainingSamplesTable);
    res.json({
      status: "online",
      version: "2.0",
      name: "DLavie OS AI Command Center",
      capabilities: ["chat", "rag", "training", "kaggle"],
      stats: {
        conversations: Number(convCount?.count ?? 0),
        documents:     Number(docCount?.count ?? 0),
        trainingSamples: Number(sampleCount?.count ?? 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.json({ status: "online", version: "2.0", name: "DLavie OS AI Command Center", timestamp: new Date().toISOString() });
  }
});

// ── Conversations ──────────────────────────────────────────────────────────────
// GET /api/chatgpt/conversations
router.get("/chatgpt/conversations", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const convs = await db
      .select()
      .from(conversationsTable)
      .orderBy(desc(conversationsTable.updatedAt))
      .limit(50);
    res.json({ conversations: convs });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET /api/chatgpt/conversations/:id
router.get("/chatgpt/conversations/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(messagesTable.createdAt);
    res.json({ conversation: conv, messages: msgs });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/chatgpt/conversations — create conversation
router.post("/chatgpt/conversations", chatgptAuth, async (req: Request, res: Response) => {
  const { title } = req.body as { title?: string };
  try {
    const [conv] = await db
      .insert(conversationsTable)
      .values({ title: title || "ChatGPT Conversation", createdAt: new Date(), updatedAt: new Date() })
      .returning();
    res.status(201).json({ conversation: conv });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/chatgpt/conversations/:id/messages — add message
router.post("/chatgpt/conversations/:id/messages", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { role, content } = req.body as { role?: string; content?: string };
  if (!content) { res.status(400).json({ error: "content is required" }); return; }
  try {
    const [msg] = await db
      .insert(messagesTable)
      .values({ conversationId: id, role: (role || "user") as "user" | "assistant", content, createdAt: new Date() })
      .returning();
    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, id));
    res.status(201).json({ message: msg });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// DELETE /api/chatgpt/conversations/:id
router.delete("/chatgpt/conversations/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
    res.json({ ok: true, deleted: id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Documents ──────────────────────────────────────────────────────────────────
// GET /api/chatgpt/documents
router.get("/chatgpt/documents", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const docs = await db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt)).limit(100);
    res.json({ documents: docs });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/chatgpt/documents — create/upload document
router.post("/chatgpt/documents", chatgptAuth, async (req: Request, res: Response) => {
  const { title, content, type } = req.body as { title?: string; content?: string; type?: string };
  if (!title || !content) { res.status(400).json({ error: "title and content are required" }); return; }
  try {
    const [doc] = await db
      .insert(documentsTable)
      .values({ title, content, fileType: type || "text" })
      .returning();
    res.status(201).json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// PATCH /api/chatgpt/documents/:id — edit document
router.patch("/chatgpt/documents/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { title, content } = req.body as { title?: string; content?: string };
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title)   updates.title   = title;
    if (content) updates.content = content;
    const [doc] = await db.update(documentsTable).set(updates).where(eq(documentsTable.id, id)).returning();
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    res.json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// DELETE /api/chatgpt/documents/:id
router.delete("/chatgpt/documents/:id", chatgptAuth, async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.delete(documentsTable).where(eq(documentsTable.id, id));
    res.json({ ok: true, deleted: id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Search knowledge base ──────────────────────────────────────────────────────
// GET /api/chatgpt/search?q=...
router.get("/chatgpt/search", chatgptAuth, async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (!q) { res.status(400).json({ error: "q query param is required" }); return; }
  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(or(ilike(documentsTable.title, `%${q}%`), ilike(documentsTable.content, `%${q}%`)))
      .limit(10);
    res.json({ query: q, results: docs, count: docs.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Training samples ───────────────────────────────────────────────────────────
// GET /api/chatgpt/training
router.get("/chatgpt/training", chatgptAuth, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const offset = Number(req.query.offset || 0);
  try {
    const samples = await db.select().from(trainingSamplesTable).limit(limit).offset(offset);
    const [total] = await db.select({ count: db.$count(trainingSamplesTable) }).from(trainingSamplesTable);
    res.json({ samples, total: Number(total?.count ?? 0), limit, offset });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/chatgpt/training — add training sample
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
      const [ds] = await db.insert(trainingDatasetsTable).values({ name: "ChatGPT Samples", description: "Added via ChatGPT Actions", taskType: "chat" }).returning();
      dsId = ds!.id;
    }
    const [sample] = await db
      .insert(trainingSamplesTable)
      .values({ datasetId: dsId as number, input: input as string, output: output as string })
      .returning();
    res.status(201).json({ sample });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Kaggle actions ─────────────────────────────────────────────────────────────
// POST /api/chatgpt/kaggle/sync — trigger dataset sync
router.post("/chatgpt/kaggle/sync", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/kaggle/dataset/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetId: 1 }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await r.json() as Record<string, unknown>;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/chatgpt/kaggle/train — trigger GPU training
router.post("/chatgpt/kaggle/train", chatgptAuth, async (_req: Request, res: Response) => {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/kaggle/kernels/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kernelSlug: "dlavie-os-lora-finetuning" }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await r.json() as Record<string, unknown>;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
