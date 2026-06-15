/**
 * DLavie OS — OneDrive Routes
 * Microsoft OneDrive integration via Graph API + Device Code OAuth
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db";
import {
  isOneDriveConfigured,
  getOneDriveClientId,
  persistClientId,
  startDeviceAuth,
  pollDeviceAuth,
  getUserInfo,
  getDriveQuota,
  listFiles,
  searchFiles,
  downloadFileContent,
  uploadFile,
  deleteFile,
  createFolder,
} from "../onedrive";
import { desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { generateEmbedding } from "./documents";

/** Convert number[] to PostgreSQL vector literal, matching documents.ts format */
function pgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

const router: IRouter = Router();

// ─── Server-side background polling registry ──────────────────────────────────
// Keyed by deviceCode; value is current status
const bgPollStatus = new Map<string, { status: "pending" | "connected" | "error"; error?: string }>();

function startBackgroundPoll(clientId: string, deviceCode: string, intervalSecs: number, expiresIn: number) {
  bgPollStatus.set(deviceCode, { status: "pending" });
  const deadline = Date.now() + expiresIn * 1000;
  const iv = setInterval(async () => {
    if (Date.now() > deadline) {
      clearInterval(iv);
      bgPollStatus.set(deviceCode, { status: "error", error: "Code expired" });
      return;
    }
    try {
      const result = await pollDeviceAuth(clientId, deviceCode);
      if ("pending" in result) return; // keep polling
      clearInterval(iv);
      if ("error" in result) {
        bgPollStatus.set(deviceCode, { status: "error", error: result.error });
      } else {
        // persistToken already called inside pollDeviceAuth
        // Also persist clientId so it survives restart
        persistClientId(clientId);
        bgPollStatus.set(deviceCode, { status: "connected" });
      }
    } catch (e) {
      clearInterval(iv);
      bgPollStatus.set(deviceCode, { status: "error", error: String(e) });
    }
  }, intervalSecs * 1000);
}

// ─── Status ───────────────────────────────────────────────────────────────────

router.get("/onedrive/status", async (_req: Request, res: Response) => {
  const configured = isOneDriveConfigured();
  const clientId = getOneDriveClientId();

  if (!configured) {
    res.json({
      connected: false,
      clientId: clientId || null,
      message: "Not connected. Set ONEDRIVE_CLIENT_ID and connect via /api/onedrive/auth/start",
    });
    return;
  }

  try {
    const [user, quota] = await Promise.all([getUserInfo(), getDriveQuota()]);
    res.json({
      connected: true,
      clientId,
      user,
      quota: {
        totalGB: Math.round(quota.total / 1e9 * 10) / 10,
        usedGB: Math.round(quota.used / 1e9 * 10) / 10,
        remainingGB: Math.round(quota.remaining / 1e9 * 10) / 10,
        usedPercent: Math.round((quota.used / quota.total) * 100),
        state: quota.state,
      },
    });
  } catch (e) {
    res.json({ connected: false, error: String(e), clientId });
  }
});

// ─── Auth — Device Code Flow ──────────────────────────────────────────────────

router.post("/onedrive/auth/start", async (req: Request, res: Response) => {
  const { clientId } = req.body as { clientId?: string };
  const id = clientId || process.env.ONEDRIVE_CLIENT_ID;
  if (!id) {
    res.status(400).json({
      error: "clientId required. Register app at portal.azure.com → App registrations → New registration → Public client → Enable 'Allow public client flows'",
    });
    return;
  }

  process.env.ONEDRIVE_CLIENT_ID = id;

  try {
    const info = await startDeviceAuth(id);
    // Start server-side background polling so token is saved even if frontend navigates away
    startBackgroundPoll(id, info.device_code, info.interval || 5, info.expires_in || 900);
    res.json({
      userCode: info.user_code,
      verificationUri: info.verification_uri,
      deviceCode: info.device_code,
      expiresIn: info.expires_in,
      interval: info.interval,
      message: `Go to ${info.verification_uri} and enter code: ${info.user_code}`,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Check status of server-side background polling by deviceCode
router.get("/onedrive/auth/poll-status", (req: Request, res: Response) => {
  const deviceCode = req.query.deviceCode as string | undefined;
  if (!deviceCode) { res.status(400).json({ error: "deviceCode required" }); return; }
  const entry = bgPollStatus.get(deviceCode);
  if (!entry) { res.json({ status: "pending" }); return; }
  res.json(entry);
});

router.post("/onedrive/auth/poll", async (req: Request, res: Response) => {
  const { deviceCode, clientId } = req.body as { deviceCode?: string; clientId?: string };
  if (!deviceCode) { res.status(400).json({ error: "deviceCode required" }); return; }

  // First check if server-side polling already finished
  const bgEntry = bgPollStatus.get(deviceCode);
  if (bgEntry?.status === "connected") {
    res.json({ status: "connected", message: "OneDrive connected successfully!" });
    return;
  }
  if (bgEntry?.status === "error") {
    res.status(400).json({ status: "error", error: bgEntry.error });
    return;
  }

  res.json({ status: "pending", message: "Waiting for user to complete authentication." });
});

router.post("/onedrive/auth/disconnect", (_req: Request, res: Response) => {
  delete process.env.ONEDRIVE_REFRESH_TOKEN;
  res.json({ disconnected: true });
});

// ─── File Operations ──────────────────────────────────────────────────────────

router.get("/onedrive/files", async (req: Request, res: Response) => {
  if (!isOneDriveConfigured()) { res.status(401).json({ error: "OneDrive not connected" }); return; }
  try {
    const folderId = req.query.folderId as string | undefined;
    const files = await listFiles(folderId);
    res.json({ files, count: files.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/onedrive/search", async (req: Request, res: Response) => {
  if (!isOneDriveConfigured()) { res.status(401).json({ error: "OneDrive not connected" }); return; }
  const q = String(req.query.q || "").trim();
  if (!q) { res.status(400).json({ error: "q required" }); return; }
  try {
    const files = await searchFiles(q);
    res.json({ files, count: files.length, query: q });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.delete("/onedrive/files/:id", async (req: Request, res: Response) => {
  if (!isOneDriveConfigured()) { res.status(401).json({ error: "OneDrive not connected" }); return; }
  try {
    await deleteFile(req.params.id);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/onedrive/folders", async (req: Request, res: Response) => {
  if (!isOneDriveConfigured()) { res.status(401).json({ error: "OneDrive not connected" }); return; }
  const { name, parentId } = req.body as { name?: string; parentId?: string };
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  try {
    const folder = await createFolder(name, parentId);
    res.json(folder);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Sync to RAG (Knowledge Base) ────────────────────────────────────────────

router.post("/onedrive/sync-to-rag", async (req: Request, res: Response) => {
  if (!isOneDriveConfigured()) { res.status(401).json({ error: "OneDrive not connected" }); return; }

  const { folderId, fileIds } = req.body as { folderId?: string; fileIds?: string[] };

  try {
    let filesToSync: Array<{ id: string; name: string; size?: number }> = [];

    if (fileIds && fileIds.length > 0) {
      const allFiles = await listFiles(folderId);
      filesToSync = allFiles.filter((f) => fileIds.includes(f.id) && f.file);
    } else {
      const files = await listFiles(folderId);
      filesToSync = files.filter((f) => {
        if (!f.file) return false;
        const mime = f.file.mimeType;
        return (
          mime.includes("text") ||
          mime.includes("pdf") ||
          mime.includes("word") ||
          mime.includes("markdown") ||
          f.name.endsWith(".md") ||
          f.name.endsWith(".txt") ||
          f.name.endsWith(".pdf") ||
          f.name.endsWith(".json") ||
          f.name.endsWith(".csv")
        );
      }).slice(0, 20);
    }

    const results: Array<{ name: string; ok: boolean; chunks?: number; error?: string }> = [];

    for (const file of filesToSync) {
      try {
        const content = await downloadFileContent(file.id);
        const text = content.toString("utf8").slice(0, 50000);

        const chunkSize = 1500;
        const overlap = 200;
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += chunkSize - overlap) {
          const chunk = text.slice(i, i + chunkSize).trim();
          if (chunk.length > 100) chunks.push(chunk);
        }

        const docId = crypto.randomUUID();
        for (const chunk of chunks.slice(0, 30)) {
          // Insert document row first (without embedding)
          const inserted = await db
            .insert(documentsTable)
            .values({
              title: `[OneDrive] ${file.name}`,
              content: chunk,
              source: `onedrive:${file.id}`,
            })
            .onConflictDoNothing()
            .returning({ id: documentsTable.id });

          // Generate real embedding via HuggingFace sentence-transformers and update
          // Falls back gracefully (document still searchable via BM25) if HF unavailable
          const rowId = inserted[0]?.id;
          if (rowId != null) {
            generateEmbedding(chunk.slice(0, 512))
              .then((vec) => {
                if (!vec) return;
                return db.execute(sql`
                  UPDATE documents
                  SET embedding = ${pgVector(vec)}::vector,
                      embedding_model = 'sentence-transformers/all-MiniLM-L6-v2'
                  WHERE id = ${rowId}
                `);
              })
              .catch(() => { /* non-fatal: BM25 fallback still works */ });
          }
        }

        results.push({ name: file.name, ok: true, chunks: chunks.length });
      } catch (e) {
        results.push({ name: file.name, ok: false, error: String(e) });
      }
    }

    const synced = results.filter((r) => r.ok).length;
    res.json({
      synced,
      failed: results.length - synced,
      total: results.length,
      results,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Re-embed: fix old random embeddings for OneDrive documents ──────────────

router.post("/onedrive/re-embed", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, content FROM documents
      WHERE source LIKE 'onedrive:%'
      AND (embedding IS NULL OR embedding_model IS NULL OR embedding_model != 'sentence-transformers/all-MiniLM-L6-v2')
      ORDER BY id ASC
      LIMIT 200
    `);

    const docs = rows.rows as Array<{ id: number; content: string }>;
    if (docs.length === 0) {
      res.json({ message: "All OneDrive documents already have real embeddings", updated: 0 });
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const doc of docs) {
      const vec = await generateEmbedding((doc.content as string).slice(0, 512));
      if (vec) {
        await db.execute(sql`
          UPDATE documents
          SET embedding = ${pgVector(vec)}::vector,
              embedding_model = 'sentence-transformers/all-MiniLM-L6-v2'
          WHERE id = ${doc.id}
        `);
        updated++;
      } else {
        failed++;
      }
    }

    res.json({
      message: `Re-embedding complete`,
      updated,
      failed,
      total: docs.length,
      note: failed > 0 ? "Some failed — ensure HF_TOKEN is set in Settings" : "All done ✅",
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Download proxy ───────────────────────────────────────────────────────────

router.get("/onedrive/download/:id", async (req: Request, res: Response) => {
  if (!isOneDriveConfigured()) { res.status(401).json({ error: "OneDrive not connected" }); return; }
  try {
    const content = await downloadFileContent(req.params.id);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(content);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
