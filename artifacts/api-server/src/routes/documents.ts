import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── BM25 constants ────────────────────────────────────────────────────────────
const BM25_K1 = 1.5;
const BM25_B  = 0.75;

type DocRow = typeof documentsTable.$inferSelect;

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

function extractSnippet(content: string, queryTokens: string[], len = 300): string {
  const lower = content.toLowerCase();
  let best = 0;
  for (const t of queryTokens) {
    const idx = lower.indexOf(t);
    if (idx !== -1) { best = idx; break; }
  }
  const start = Math.max(0, best - 80);
  const end   = Math.min(content.length, start + len);
  let snippet = content.slice(start, end);
  if (start > 0) snippet = "…" + snippet.trimStart();
  if (end < content.length) snippet += "…";
  return snippet;
}

function bm25Score(docs: DocRow[], query: string, topK: number) {
  const qt = tokenize(query);
  if (!qt.length || !docs.length) return [];
  const N = docs.length;
  const df: Record<string, number> = {};
  const docTokensList: string[][] = [];
  const docLengths: number[] = [];
  for (const doc of docs) {
    const tokens = tokenize(`${doc.title || ""} ${doc.content || ""}`);
    docTokensList.push(tokens);
    docLengths.push(tokens.length);
    for (const t of new Set(tokens)) df[t] = (df[t] || 0) + 1;
  }
  const avgDL = docLengths.reduce((a, b) => a + b, 0) / Math.max(N, 1);
  return docs
    .map((doc, i) => {
      const tokens = docTokensList[i];
      const dl = docLengths[i];
      const tf: Record<string, number> = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      let score = 0;
      for (const q of qt) {
        const idf = Math.log((N - (df[q] || 0) + 0.5) / ((df[q] || 0) + 0.5) + 1);
        const f = tf[q] || 0;
        const tfNorm = (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / Math.max(avgDL, 1)));
        score += idf * tfNorm;
      }
      const titleMatches = qt.filter((q) => tokenize(doc.title || "").includes(q)).length;
      score += titleMatches * 3;
      return { doc, score };
    })
    .filter((s) => s.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function chunkText(text: string, size = 500, overlap = 80): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, Math.min(start + size, text.length)));
    start += size - overlap;
  }
  return chunks;
}

const router: IRouter = Router();

router.get("/documents", async (_req, res) => {
  const rows = await db.select().from(documentsTable);
  res.json(rows);
});

router.post("/documents", async (req: Request, res: Response) => {
  const { title, content = "", fileType = "text" } = req.body as {
    title?: string; content?: string; fileType?: string;
  };
  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const chunks = chunkText(content, 500, 80);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  const [row] = await db
    .insert(documentsTable)
    .values({
      title: title.trim(),
      content,
      fileType,
      size: content.length,
      indexed: true,
      chunkCount: chunks.length,
    })
    .returning();
  res.status(201).json({ ...row, wordCount, chunkCount: chunks.length });
});

/** POST /documents/import-url — Fetch + strip HTML + index a URL */
router.post("/documents/import-url", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url?.trim()) { res.status(400).json({ error: "url is required" }); return; }
  try {
    const r = await fetch(url.trim(), {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "DLavie-OS-RAG/1.0" },
    });
    if (!r.ok) { res.status(400).json({ error: `Fetch failed: HTTP ${r.status}` }); return; }
    const html = await r.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 50_000);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;
    const chunks = chunkText(text, 500, 80);
    const [row] = await db
      .insert(documentsTable)
      .values({ title, content: text, fileType: "url", size: text.length, indexed: true, chunkCount: chunks.length })
      .returning();
    res.status(201).json({ ...row, sourceUrl: url, chunkCount: chunks.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/documents/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const [row] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Document not found" }); return; }
  res.json(row);
});

router.delete("/documents/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const [row] = await db.delete(documentsTable).where(eq(documentsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Document not found" }); return; }
  res.status(204).send();
});

/** POST /documents/search — BM25 + keyword + snippet extraction */
router.post("/documents/search", async (req: Request, res: Response) => {
  const { query = "", topK = 5, searchType = "hybrid" } = req.body as {
    query?: string; topK?: number; searchType?: string;
  };
  if (!query.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const docs = await db.select().from(documentsTable);
  if (!docs.length) { res.json([]); return; }

  const qt = tokenize(query);
  let results: Array<{ doc: DocRow; score: number }>;

  if (searchType === "keyword") {
    const q = query.toLowerCase();
    results = docs.map((doc) => {
      const text = `${doc.title} ${doc.content || ""}`.toLowerCase();
      const count = (text.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      return { doc, score: Math.min(count * 0.2, 1) };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
  } else {
    results = bm25Score(docs, query, topK);
  }

  res.json(results.map((r, i) => ({
    documentId: r.doc.id,
    title: r.doc.title,
    content: r.doc.content || "",
    snippet: extractSnippet(r.doc.content || r.doc.title, qt),
    score: Math.round(r.score * 1000) / 1000,
    rank: i + 1,
    chunkCount: r.doc.chunkCount,
    fileType: r.doc.fileType,
  })));
});

export default router;
