import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { conversationsTable, messagesTable, documentsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  CreateConversationBody,
  SendMessageBody,
  GetConversationParams,
  DeleteConversationParams,
  ListMessagesParams,
  SendMessageParams,
} from "@workspace/api-zod";
import { generateOllamaResponse, streamOllamaResponse, OllamaError } from "../ollama.js";
import { streamKimiResponse } from "../kimi.js";
import { streamGroqResponse, generateGroqResponse, isGroqConfigured } from "../groq.js";
import { streamOpenRouterResponse, generateOpenRouterResponse, isOpenRouterConfigured } from "../openrouter.js";
import { generateEmbedding } from "./documents.js";
import { ddgSearch } from "./search.js";

/**
 * Detect which provider to use based on model name prefix.
 *  groq:<model>        → Groq LPU
 *  openrouter:<model>  → OpenRouter
 *  kimi                → Kimi K2
 *  anything else       → Ollama (local)
 */
function detectProvider(model: string): "groq" | "openrouter" | "kimi" | "ollama" {
  if (model.startsWith("groq:"))        return "groq";
  if (model.startsWith("openrouter:"))  return "openrouter";
  if (model === "kimi" || model.startsWith("kimi:")) return "kimi";
  return "ollama";
}

async function streamToResponse(
  message: string,
  model: string,
  ragContext: string | undefined,
  res: Response
): Promise<void> {
  const provider = detectProvider(model);
  if (provider === "groq")       return streamGroqResponse(message, model, ragContext, res);
  if (provider === "openrouter") return streamOpenRouterResponse(message, model, ragContext, res);
  if (provider === "kimi")       return streamKimiResponse(message, model, ragContext, res);
  return streamOllamaResponse(message, model, ragContext, res);
}

async function generateToText(
  message: string,
  model: string,
  ragContext: string | undefined
): Promise<string> {
  const provider = detectProvider(model);
  const ctx = ragContext ? `Context:\n${ragContext}\n\nQuestion: ${message}` : message;
  const msgs = [
    { role: "system" as const, content: "You are DLavie OS, a helpful AI assistant." },
    { role: "user" as const, content: ctx },
  ];

  // Try explicit provider first
  try {
    if (provider === "groq" && isGroqConfigured())
      return await generateGroqResponse(msgs, model.replace(/^groq:/i, ""));
    if (provider === "openrouter" && isOpenRouterConfigured())
      return await generateOpenRouterResponse(msgs, model.replace(/^openrouter:/i, ""));
  } catch (e) {
    console.warn(`[conversations] ${provider} failed, trying provider chain:`, String(e).slice(0, 100));
  }

  // Try Ollama
  try {
    return await generateOllamaResponse(message, model, ragContext);
  } catch (ollamaErr) {
    const errMsg = ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr);
    // If Ollama fails (no models, not running), fall back to provider chain
    if (errMsg.includes("NO_MODELS") || errMsg.includes("ECONNREFUSED") || errMsg.includes("OFFLINE")) {
      console.warn("[conversations] Ollama unavailable, trying provider chain");
      try {
        const { generateWithFallback } = await import("../lib/provider-chain.js");
        const result = await generateWithFallback(message, ragContext, "You are DLavie OS, a helpful AI assistant.");
        return result.text;
      } catch (chainErr) {
        console.warn("[conversations] Provider chain also failed:", String(chainErr).slice(0, 100));
      }
    }
    throw ollamaErr;
  }
}

const router: IRouter = Router();

const EMBED_DIMS = 384;

function pgVector(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

// ─── Detect if query is a web-search-style question ───────────────────────────
const WEB_SEARCH_PATTERNS = [
  /\bsearch\s+for\b/i, /\blook\s+up\b/i, /\bwhat\s+is\s+the\s+(latest|current|recent|new)\b/i,
  /\btoday['']?s?\b/i, /\bcurrent(ly)?\b/i, /\blatest\b/i, /\b(news|headline)s?\b/i,
  /\bwho\s+(is|was|are)\b/i, /\bwhere\s+is\b/i, /\bwhen\s+(is|was|did)\b/i,
  /\bhow\s+(much|many|old)\b/i, /\bwhat\s+happened\b/i, /\bdefine\b/i,
];

function looksLikeWebQuery(text: string): boolean {
  return WEB_SEARCH_PATTERNS.some((p) => p.test(text));
}

// ─── RAG context: vector search → BM25 fallback ───────────────────────────────
async function retrieveRAGContext(query: string): Promise<string | undefined> {
  try {
    // 1. Try vector search first (if HF embeddings available)
    const queryVec = await generateEmbedding(query);
    if (queryVec && queryVec.length === EMBED_DIMS) {
      try {
        const rows = await db.execute(sql`
          SELECT id, title, content,
                 CAST(1 - (embedding <=> ${pgVector(queryVec)}::vector) AS FLOAT8) AS score
          FROM documents
          WHERE embedding IS NOT NULL
            AND (1 - (embedding <=> ${pgVector(queryVec)}::vector)) > 0.25
          ORDER BY embedding <=> ${pgVector(queryVec)}::vector
          LIMIT 3
        `) as unknown as Array<{ id: number; title: string; content: string; score: number }>;

        if (rows.length > 0) {
          return rows
            .map((r) => {
              const snippet = r.content && r.content.length > 800 ? r.content.slice(0, 800) + "..." : r.content || "";
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
        return `[Knowledge: ${r.doc.title}]\n${snippet}`;
      })
      .join("\n\n");
  } catch {
    return undefined;
  }
}

// ─── Web search context injection ─────────────────────────────────────────────
async function retrieveWebContext(query: string): Promise<string | undefined> {
  try {
    const results = await ddgSearch(query, 4);
    if (!results.length) return undefined;

    const snippets = results
      .filter((r) => r.snippet.trim().length > 20)
      .slice(0, 4)
      .map((r) => `[Web: ${r.title}]\n${r.snippet.slice(0, 400)}`);

    if (!snippets.length) return undefined;
    return snippets.join("\n\n");
  } catch {
    return undefined;
  }
}

// ─── Helper: extract rows from Drizzle/pg QueryResult ────────────────────────
function pgRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r.rows || [];
}

// ─── GET /conversations/search ────────────────────────────────────────────────
router.get("/conversations/search", async (req, res) => {
  const { q = "", limit = "20" } = req.query as Record<string, string>;
  if (!q.trim()) { res.status(400).json({ error: "q is required" }); return; }
  try {
    const results = pgRows(await db.execute(sql`
      SELECT DISTINCT ON (c.id)
        c.id, c.title, c.model, c.created_at, c.updated_at,
        m.content AS matching_message,
        m.role AS matching_role
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      WHERE c.title ILIKE ${`%${q}%`} OR m.content ILIKE ${`%${q}%`}
      ORDER BY c.id DESC, c.updated_at DESC
      LIMIT ${parseInt(limit, 10) || 20}
    `));
    res.json({ query: q, results });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── GET /conversations/stats ─────────────────────────────────────────────────
router.get("/conversations/stats", async (_req, res) => {
  try {
    const rows = pgRows(await db.execute(sql`
      SELECT
        COUNT(DISTINCT c.id)::int AS total_conversations,
        COUNT(m.id)::int AS total_messages,
        COALESCE(SUM(m.tokens), 0)::bigint AS total_tokens,
        COUNT(m.id) FILTER (WHERE m.role = 'user')::int AS user_messages,
        COUNT(m.id) FILTER (WHERE m.role = 'assistant')::int AS assistant_messages,
        AVG(m.tokens) FILTER (WHERE m.tokens IS NOT NULL)::float AS avg_tokens_per_message
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
    `));
    const row = rows[0] || {};
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/conversations", async (_req, res) => {
  const rows = await db
    .select()
    .from(conversationsTable)
    .orderBy(desc(conversationsTable.updatedAt));

  const results = await Promise.all(
    rows.map(async (conv) => {
      const msgs = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conv.id));
      return { ...conv, messageCount: msgs.length };
    })
  );

  res.json(results);
});

router.post("/conversations", async (req, res) => {
  const parsed = CreateConversationBody.parse(req.body);
  const [row] = await db
    .insert(conversationsTable)
    .values({
      title: parsed.title,
      model: parsed.model || "tinyllama",
    })
    .returning();

  res.status(201).json({ ...row, messageCount: 0 });
});

router.get("/conversations/:id", async (req, res) => {
  const { id } = GetConversationParams.parse(req.params);
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);

  res.json({ ...conv, messages: msgs });
});

router.delete("/conversations/:id", async (req, res) => {
  const { id } = DeleteConversationParams.parse(req.params);
  await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
  const [conv] = await db
    .delete(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .returning();

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.status(204).send();
});

// PATCH: update conversation model and/or title
router.patch("/conversations/:id", async (req, res) => {
  const { id } = GetConversationParams.parse(req.params);
  const { model, title } = req.body as { model?: string; title?: string };

  if (!model && !title) {
    res.status(400).json({ error: "model or title field required" });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (model) updateData.model = model;
  if (title) updateData.title = title;

  const [updated] = await db
    .update(conversationsTable)
    .set(updateData)
    .where(eq(conversationsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json(updated);
});

// DELETE all conversations (bulk)
router.delete("/conversations", async (_req, res) => {
  await db.delete(messagesTable);
  const deleted = await db.delete(conversationsTable).returning({ id: conversationsTable.id });
  res.json({ deleted: deleted.length });
});

router.get("/conversations/:id/messages", async (req, res) => {
  const { id } = ListMessagesParams.parse(req.params);
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);

  res.json(msgs);
});

// Save a user+assistant message pair directly (used by cloud/Puter AI path)
router.post("/conversations/:id/messages/pair", async (req: Request, res: Response) => {
  const idNum = parseInt((req.params['id'] as string), 10);
  if (isNaN(idNum)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const { userContent, assistantContent } = req.body as {
    userContent?: string;
    assistantContent?: string;
  };

  if (!userContent || !assistantContent) {
    res.status(400).json({ error: "userContent and assistantContent are required" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, idNum));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const [userMsg] = await db
    .insert(messagesTable)
    .values({ conversationId: idNum, role: "user", content: userContent })
    .returning();

  const [aiMsg] = await db
    .insert(messagesTable)
    .values({
      conversationId: idNum,
      role: "assistant",
      content: assistantContent,
      tokens: Math.round(assistantContent.length / 4),
    })
    .returning();

  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, idNum));

  res.status(201).json({ userMessage: userMsg, assistantMessage: aiMsg });
});

// Standard (non-streaming) message endpoint
router.post("/conversations/:id/messages", async (req, res) => {
  const { id } = SendMessageParams.parse(req.params);
  const parsed = SendMessageBody.parse(req.body);

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));

  const model = conv?.model || "tinyllama";

  const [userMsg] = await db
    .insert(messagesTable)
    .values({
      conversationId: id,
      role: "user",
      content: parsed.content,
    })
    .returning();

  // Retrieve RAG context from knowledge base
  const ragContext = await retrieveRAGContext(parsed.content);

  try {
    const response = await generateToText(parsed.content, model, ragContext);

    const [aiMsg] = await db
      .insert(messagesTable)
      .values({
        conversationId: id,
        role: "assistant",
        content: response,
        tokens: Math.round(response.length / 4),
      })
      .returning();

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, id));

    res.status(201).json(aiMsg);
  } catch (error) {
    if (error instanceof OllamaError) {
      res.status(502).json(error.toJSON());
    } else {
      res.status(500).json({ code: "UNKNOWN", message: error instanceof Error ? error.message : "Unexpected error", hint: "Check the server logs or try again." });
    }
  }
});

// STREAMING message endpoint — SSE real-time response
router.post("/conversations/:id/messages/stream", async (req: Request, res: Response) => {
  const idNum = parseInt((req.params['id'] as string), 10);
  if (isNaN(idNum)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const body = req.body as { content?: string };
  if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, idNum));

  const model = conv?.model || "tinyllama";

  // Save user message first
  await db.insert(messagesTable).values({
    conversationId: idNum,
    role: "user",
    content: body.content,
  });

  // ── Multi-turn memory: load last N messages as conversation history ─────────
  const historyRows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, idNum))
    .orderBy(desc(messagesTable.createdAt))
    .limit(20);

  // Reverse to chronological order, exclude the message we just inserted
  const historyMsgs = historyRows
    .reverse()
    .filter((m) => !(m.role === "user" && m.content === body.content));

  // Build history string for system context (last 10 exchanges = 20 msgs max)
  const historyContext = historyMsgs.length > 1
    ? historyMsgs
        .slice(-18) // keep last 18 to leave room for current message
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").slice(0, 600)}`)
        .join("\n")
    : "";

  // Run RAG + web search in parallel — both are independent, no need to wait sequentially
  const isWebQuery = looksLikeWebQuery(body.content);
  const [ragContext, webContext] = await Promise.all([
    retrieveRAGContext(body.content),
    isWebQuery ? retrieveWebContext(body.content) : Promise.resolve(undefined),
  ]);

  // Merge contexts: history + knowledge base + web search
  const contextParts: string[] = [];
  if (historyContext) contextParts.push(`Conversation history:\n${historyContext}`);
  if (ragContext)     contextParts.push(`Knowledge base:\n${ragContext}`);
  if (webContext)     contextParts.push(`Web search:\n${webContext}`);
  const combinedContext = contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : undefined;

  // Accumulate full text from SSE tokens + final fullText event; track any error
  let fullText = "";
  let streamError = "";

  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.write = function (chunk: unknown, ...args: unknown[]) {
    try {
      const raw = typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk.toString() : String(chunk);
      const dataLine = raw.trim().replace(/^data:\s*/, "");
      if (dataLine) {
        const parsed = JSON.parse(dataLine) as { token?: string; done?: boolean; fullText?: string; error?: string };
        if (parsed.token) fullText += parsed.token;
        if (parsed.fullText) fullText = parsed.fullText;
        if (parsed.error) streamError = parsed.error;
      }
    } catch {
      // malformed chunk — ignore, still forward
    }
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  } as typeof res.write;

  res.end = function (...args: unknown[]) {
    const saveContent = fullText || (streamError ? `⚠️ AI Error: ${streamError}` : "");
    if (saveContent) {
      db.insert(messagesTable)
        .values({
          conversationId: idNum,
          role: "assistant",
          content: saveContent,
          tokens: fullText ? Math.round(fullText.length / 4) : 0,
        })
        .then(() =>
          db
            .update(conversationsTable)
            .set({ updatedAt: new Date() })
            .where(eq(conversationsTable.id, idNum))
        )
        .catch((e) => console.error("Failed to save streamed message:", e));
    }
    return (origEnd as (...a: unknown[]) => typeof res)(...args);
  } as typeof res.end;

  await streamToResponse(body.content, model, combinedContext, res);
});


// ─── GET /conversations/:id/export ────────────────────────────────────────────
router.get("/conversations/:id/export", async (req, res) => {
  const id = parseInt((req.params['id'] as string), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const format = (req.query.format as string) || "json";

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const msgs = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt);

  if (format === "markdown" || format === "md") {
    const md = [
      `# ${conv.title}`,
      `**Model:** ${conv.model || "tinyllama"}  `,
      `**Created:** ${new Date(conv.createdAt).toISOString()}  `,
      `**Messages:** ${msgs.length}`,
      "",
      "---",
      "",
      ...msgs.map((m) => {
        const roleLabel = m.role === "user" ? "**You**" : `**${conv.model || "AI"}**`;
        return `${roleLabel}\n\n${m.content}\n`;
      }),
    ].join("\n");

    res.setHeader("Content-Type", "text/markdown");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${id}.md"`);
    res.send(md);
  } else if (format === "txt") {
    const txt = [
      `Conversation: ${conv.title}`,
      `Model: ${conv.model || "tinyllama"}`,
      `Date: ${new Date(conv.createdAt).toISOString()}`,
      "",
      "=" .repeat(60),
      "",
      ...msgs.map((m) => `[${m.role.toUpperCase()}]\n${m.content}\n`),
    ].join("\n");

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${id}.txt"`);
    res.send(txt);
  } else {
    res.json({
      id: conv.id,
      title: conv.title,
      model: conv.model,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: msgs.length,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokens: m.tokens,
        createdAt: m.createdAt,
      })),
    });
  }
});

// GET /conversations/:id/summary — AI-generated conversation summary
router.get("/conversations/:id/summary", async (req: Request, res: Response) => {
  const idNum = parseInt((req.params['id'] as string), 10);
  if (isNaN(idNum)) { res.status(400).json({ error: "Invalid id" }); return; }

  const msgs = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, idNum))
    .orderBy(messagesTable.createdAt);

  if (msgs.length === 0) { res.json({ summary: "Empty conversation." }); return; }

  // Build a readable transcript
  const transcript = msgs
    .slice(-20) // last 20 messages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${String(m.content || "").slice(0, 200)}`)
    .join("\n");

  try {
    const { generateOllamaResponse, isOllamaOnline } = await import("../ollama.js");
    const online = await isOllamaOnline().catch(() => false);
    if (!online) {
      res.json({ summary: `Conversation with ${msgs.length} messages.` });
      return;
    }
    const summary = await generateOllamaResponse(
      transcript,
      "You are a conversation summarizer. In 2-3 sentences, summarize what this conversation was about and its key outcomes. Be concise."
    );
    res.json({ summary, messageCount: msgs.length });
  } catch (e) {
    res.json({ summary: `Conversation with ${msgs.length} messages.`, error: String(e) });
  }
});

export default router;
