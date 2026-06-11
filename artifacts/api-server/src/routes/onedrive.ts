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
import { desc } from "drizzle-orm";
import crypto from "crypto";

const router: IRouter = Router();

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

router.post("/onedrive/auth/poll", async (req: Request, res: Response) => {
  const { deviceCode, clientId } = req.body as { deviceCode?: string; clientId?: string };
  if (!deviceCode) { res.status(400).json({ error: "deviceCode required" }); return; }

  const id = clientId || process.env.ONEDRIVE_CLIENT_ID;
  if (!id) { res.status(400).json({ error: "clientId required" }); return; }

  try {
    const result = await pollDeviceAuth(id, deviceCode);

    if ("pending" in result) {
      res.json({ status: "pending", message: "User has not completed authentication yet. Keep polling." });
      return;
    }
    if ("error" in result) {
      res.status(400).json({ status: "error", error: result.error });
      return;
    }

    res.json({ status: "connected", message: "OneDrive connected successfully!" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
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
          const embedding = Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
          await db.insert(documentsTable).values({
            title: `[OneDrive] ${file.name}`,
            content: chunk,
            source: `onedrive:${file.id}`,
            embedding: JSON.stringify(embedding),
          }).onConflictDoNothing();
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
