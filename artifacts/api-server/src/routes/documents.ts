import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import multer from "multer";
import { createReadStream, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { objectStorageClient } from "../replit_integrations/object_storage";
import { getHFToken } from "../huggingface";

// ─── Object Storage helpers ────────────────────────────────────────────────────
const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
const PRIVATE_DIR = (process.env.PRIVATE_OBJECT_DIR || "").replace(/^\//, ""); // strip leading /

/**
 * Upload a file buffer to Replit Object Storage.
 * Returns the public-ish object path (/documents/<id>/<filename>) or null on failure.
 */
async function uploadToObjectStorage(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  docId: number,
): Promise<{ objectPath: string; storageUrl: string } | null> {
  if (!BUCKET_ID || !PRIVATE_DIR) return null;
  try {
    // Extract bucket name from ID (format: replit-objstore-<uuid>)
    // The bucket is identified by DEFAULT_OBJECT_STORAGE_BUCKET_ID env var
    // which contains the bucket name set by Replit sidecar
    const bucketName = BUCKET_ID;
    const objectName = `${PRIVATE_DIR}/documents/${docId}/${originalName}`;
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(fileBuffer, { contentType: mimeType, resumable: false });
    const objectPath = `/objects/documents/${docId}/${originalName}`;
    const storageUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;
    return { objectPath, storageUrl };
  } catch (err) {
    console.warn("[ObjectStorage] Upload failed (non-fatal):", err);
    return null;
  }
}

// ─── BM25 constants ────────────────────────────────────────────────────────────
const BM25_K1 = 1.5;
const BM25_B  = 0.75;

// ─── HuggingFace embedding config ─────────────────────────────────────────────
const HF_EMBED_MODEL   = "sentence-transformers/all-MiniLM-L6-v2";
const HF_EMBED_URL     = `https://api-inference.huggingface.co/models/${HF_EMBED_MODEL}`;
const EMBED_DIMS       = 384;

/**
 * Generate a real 384-d embedding via HuggingFace Inference API.
 * Returns null if HF_TOKEN not set or API fails.
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  const hfToken = getHFToken();
  if (!hfToken) return null;
  try {
    const res = await fetch(HF_EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfToken}`,
        "Content-Type":  "application/json",
        "x-wait-for-model": "true",
      },
      body: JSON.stringify({ inputs: text.slice(0, 512) }), // model max 512 tokens
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as number[] | number[][];
    // API returns [[...]] for batches or [...] for single
    if (Array.isArray(data[0])) return (data as number[][])[0];
    return data as number[];
  } catch {
    return null;
  }
}

/** Format JS number[] as PostgreSQL vector literal: '[0.1,0.2,...]' */
function pgVector(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

// ─── Text extraction helpers ────────────────────────────────────────────────

async function extractPDF(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const buf = readFileSync(filePath);
  const data = await pdfParse(buf);
  return data.text || "";
}

async function extractDOCX(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || "";
}

// ─── Multer (disk storage → tmp) ───────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpdir()),
    filename: (_req, file, cb) => cb(null, `dlavio-upload-${randomUUID()}-${file.originalname}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (_req, file, cb) => {
    const ok = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain", "text/markdown", "text/csv", "application/json"].includes(file.mimetype)
      || file.originalname.match(/\.(pdf|docx|txt|md|csv|json)$/i);
    if (ok) cb(null, true);
    else cb(new Error("Unsupported file type. Allowed: PDF, DOCX, TXT, MD, CSV, JSON"));
  },
});

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
  const rows = await db.select({
    id: documentsTable.id,
    title: documentsTable.title,
    content: documentsTable.content,
    fileType: documentsTable.fileType,
    size: documentsTable.size,
    indexed: documentsTable.indexed,
    chunkCount: documentsTable.chunkCount,
    createdAt: documentsTable.createdAt,
    updatedAt: documentsTable.updatedAt,
    hasEmbedding: sql<boolean>`(embedding IS NOT NULL)`,
  }).from(documentsTable);
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

  // Generate embedding asynchronously (non-blocking)
  generateEmbedding(`${title} ${content}`.slice(0, 512))
    .then((vec) => {
      if (vec && vec.length === EMBED_DIMS) {
        return db.execute(sql`
          UPDATE documents SET embedding = ${pgVector(vec)}::vector
          WHERE id = ${row.id}
        `);
      }
    })
    .catch((e) => console.warn("[Embeddings] Failed to generate for doc", row.id, e));

  res.status(201).json({ ...row, wordCount, chunkCount: chunks.length });
});

/** POST /documents/upload — multipart file upload with real PDF/DOCX parsing */
router.post("/documents/upload", upload.single("file"), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded. Use multipart form with field 'file'" }); return; }

  const titleOverride = (req.body as { title?: string }).title?.trim();
  let extractedText = "";
  let fileType = "text";

  // Read the raw buffer BEFORE any cleanup so Object Storage can receive original file
  let fileBuffer: Buffer | null = null;
  try { fileBuffer = readFileSync(file.path); } catch { /* non-fatal */ }

  try {
    const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
    const mime = file.mimetype;

    if (mime === "application/pdf" || ext === "pdf") {
      extractedText = await extractPDF(file.path);
      fileType = "pdf";
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      extractedText = await extractDOCX(file.path);
      fileType = "docx";
    } else {
      extractedText = fileBuffer ? fileBuffer.toString("utf8") : readFileSync(file.path, "utf8");
      fileType = ext || "text";
    }
  } catch (parseErr) {
    try { unlinkSync(file.path); } catch { /* ignore */ }
    res.status(422).json({ error: `Failed to parse file: ${String(parseErr)}` });
    return;
  }

  // Clean up temp file now that text is extracted
  try { unlinkSync(file.path); } catch { /* ignore */ }

  const title = titleOverride || file.originalname.replace(/\.[^.]+$/, "");
  const content = extractedText.trim().slice(0, 500_000); // 500K char limit
  const chunks = chunkText(content, 500, 80);
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  const [row] = await db
    .insert(documentsTable)
    .values({
      title,
      content,
      fileType,
      size: content.length,
      indexed: true,
      chunkCount: chunks.length,
    })
    .returning();

  // Upload original file to Replit Object Storage (non-blocking, non-fatal)
  let storageResult: { objectPath: string; storageUrl: string } | null = null;
  if (fileBuffer) {
    storageResult = await uploadToObjectStorage(fileBuffer, file.originalname, file.mimetype, row.id);
    if (storageResult) {
      await db.execute(sql`
        UPDATE documents
        SET storage_url = ${storageResult.storageUrl},
            storage_object_path = ${storageResult.objectPath}
        WHERE id = ${row.id}
      `).catch(() => { /* non-fatal */ });
    }
  }

  // Generate embedding asynchronously
  generateEmbedding(`${title} ${content}`.slice(0, 512))
    .then((vec) => {
      if (vec && vec.length === EMBED_DIMS) {
        return db.execute(sql`
          UPDATE documents SET embedding = ${pgVector(vec)}::vector
          WHERE id = ${row.id}
        `);
      }
    })
    .catch((e) => console.warn("[Embeddings] Failed to generate for uploaded doc", row.id, e));

  res.status(201).json({
    ...row,
    wordCount,
    chunkCount: chunks.length,
    fileName: file.originalname,
    fileSizeBytes: file.size,
    embeddingQueued: !!getHFToken(),
    storageObjectPath: storageResult?.objectPath ?? null,
    storedInCloud: !!storageResult,
  });
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

    // Generate embedding asynchronously
    generateEmbedding(`${title} ${text}`.slice(0, 512))
      .then((vec) => {
        if (vec && vec.length === EMBED_DIMS) {
          return db.execute(sql`UPDATE documents SET embedding = ${pgVector(vec)}::vector WHERE id = ${row.id}`);
        }
      })
      .catch(() => { /* non-fatal */ });

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

/**
 * POST /documents/search — Hybrid: pgvector cosine similarity (if embeddings) + BM25 fallback
 * searchType: "vector" | "keyword" | "hybrid" (default)
 */
router.post("/documents/search", async (req: Request, res: Response) => {
  const { query = "", topK = 5, searchType = "hybrid" } = req.body as {
    query?: string; topK?: number; searchType?: string;
  };
  if (!query.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const docs = await db.select().from(documentsTable);
  if (!docs.length) { res.json([]); return; }

  const qt = tokenize(query);
  let results: Array<{ doc: DocRow; score: number; searchMethod: string }> = [];

  // Try vector search if HF_TOKEN available and embeddings exist
  const hasEmbeddings = docs.some((d) => {
    // embedding column will be cast to string or array depending on driver
    return (d as Record<string, unknown>).embedding != null;
  });

  if ((searchType === "vector" || searchType === "hybrid") && getHFToken()) {
    try {
      const queryVec = await generateEmbedding(query);
      if (queryVec && queryVec.length === EMBED_DIMS) {
        const rows = await db.execute(sql`
          SELECT id, title, content, file_type, size, chunk_count, indexed, created_at, updated_at,
                 CAST(1 - (embedding <=> ${pgVector(queryVec)}::vector) AS FLOAT8) AS vec_score
          FROM documents
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${pgVector(queryVec)}::vector
          LIMIT ${topK}
        `) as unknown as Array<Record<string, unknown>>;

        if (rows.length > 0) {
          results = rows.map((r) => ({
            doc: {
              id: r.id as number,
              title: r.title as string,
              content: r.content as string,
              fileType: (r.file_type as string) || "text",
              size: r.size as number,
              chunkCount: r.chunk_count as number,
              indexed: r.indexed as boolean,
              createdAt: r.created_at as Date,
              updatedAt: r.updated_at as Date,
            },
            score: typeof r.vec_score === "number" ? r.vec_score : parseFloat(String(r.vec_score)) || 0,
            searchMethod: "vector",
          }));
        }
      }
    } catch (vecErr) {
      console.warn("[Search] Vector search failed, falling back to BM25:", vecErr);
    }
  }

  // BM25 fallback or keyword mode
  if (results.length === 0 || searchType === "keyword") {
    if (searchType === "keyword") {
      const q = query.toLowerCase();
      const kwResults = docs.map((doc) => {
        const text = `${doc.title} ${doc.content || ""}`.toLowerCase();
        const count = (text.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
        return { doc, score: Math.min(count * 0.2, 1), searchMethod: "keyword" };
      }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
      results = kwResults;
    } else {
      results = bm25Score(docs, query, topK).map((r) => ({ ...r, searchMethod: "bm25" }));
    }
  }

  // Hybrid: merge vector + BM25 results (deduplicate by id)
  if (searchType === "hybrid" && results.length > 0) {
    const bm25Results = bm25Score(docs, query, topK).map((r) => ({ ...r, searchMethod: "bm25" }));
    const seenIds = new Set(results.map((r) => r.doc.id));
    for (const r of bm25Results) {
      if (!seenIds.has(r.doc.id)) {
        results.push(r);
        seenIds.add(r.doc.id);
      }
    }
    results = results.slice(0, topK);
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
    searchMethod: r.searchMethod,
  })));
});

export { generateEmbedding };
export default router;
