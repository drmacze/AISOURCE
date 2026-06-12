/**
 * DLavie OS — API Key Management
 *
 * Endpoints:
 *   GET    /api/keys           — List all API keys (admin only, keys are masked)
 *   POST   /api/keys           — Generate a new API key
 *   PATCH  /api/keys/:id       — Update key name / permissions / active / systemPrompt / webhookUrl / defaultModel
 *   DELETE /api/keys/:id       — Revoke (delete) an API key
 *   GET    /api/keys/:id/stats — Usage stats for a specific key
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { getPrimaryKey, setPrimaryKey } from "./auth-session";

const router: IRouter = Router();

function extractKey(req: Request): string | null {
  return (
    (req.headers["x-api-key"] as string) ||
    (req.headers["x-dlavie-key"] as string) ||
    (req.headers["x-dlavie-key"] as string) ||
    (req.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "") ||
    null
  );
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = extractKey(req);
  const masterKey = process.env.DLAVIE_API_KEY || "";

  if (masterKey && key === masterKey) return next();

  if (key) {
    try {
      const [found] = await db
        .select()
        .from(apiKeysTable)
        .where(eq(apiKeysTable.key, key))
        .limit(1);
      if (found && found.active && found.permissions === "admin") return next();
    } catch { /* fall through */ }
  }

  // Bootstrap mode — allow unauthenticated when DB empty + no master key
  if (!masterKey) {
    try {
      const [countRow] = await db.select({ c: count() }).from(apiKeysTable);
      if ((countRow?.c ?? 0) === 0) {
        console.warn("[ApiKeys] Bootstrap mode: unauthenticated access allowed until first admin key is created.");
        return next();
      }
    } catch { /* fall through */ }
  }

  res.status(401).json({
    error: "Unauthorized",
    message: "Admin API key required to manage keys.",
    hint: "Pass your admin key as X-API-Key header or Authorization: Bearer <key>",
  });
}

function generateKey(): string {
  return "dlv_" + randomBytes(24).toString("hex");
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + "****";
  return key.slice(0, 10) + "..." + key.slice(-4);
}

// ─── GET /api/keys ────────────────────────────────────────────────────────────
router.get("/keys", requireAdmin, async (_req, res) => {
  try {
    const keys = await db.select().from(apiKeysTable).orderBy(desc(apiKeysTable.createdAt));
    res.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        key: maskKey(k.key),
        permissions: k.permissions,
        active: k.active,
        defaultModel: k.defaultModel,
        systemPrompt: k.systemPrompt,
        webhookUrl: k.webhookUrl,
        requestCount: k.requestCount,
        dailyTokens: k.dailyTokens,
        dailyTokensDate: k.dailyTokensDate,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
      })),
      total: keys.length,
    });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

// ─── POST /api/keys ───────────────────────────────────────────────────────────
router.post("/keys", requireAdmin, async (req, res) => {
  const { name, permissions = "write", expiresAt, defaultModel, systemPrompt, webhookUrl } = req.body as {
    name?: string;
    permissions?: "read" | "write" | "admin";
    expiresAt?: string;
    defaultModel?: string;
    systemPrompt?: string;
    webhookUrl?: string;
  };

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "BadRequest", message: "name is required." });
    return;
  }

  const validPerms: Array<"read" | "write" | "admin"> = ["read", "write", "admin"];
  if (!validPerms.includes(permissions)) {
    res.status(400).json({ error: "BadRequest", message: `permissions must be one of: ${validPerms.join(", ")}` });
    return;
  }

  try {
    const newKey = generateKey();
    const expiry = expiresAt ? new Date(expiresAt) : null;

    const [created] = await db
      .insert(apiKeysTable)
      .values({
        name: name.trim(),
        key: newKey,
        permissions,
        active: true,
        defaultModel: defaultModel || null,
        systemPrompt: systemPrompt || null,
        webhookUrl: webhookUrl || null,
        ...(expiry ? { expiresAt: expiry } : {}),
      })
      .returning();

    if (permissions === "admin") {
      try {
        const existing = await getPrimaryKey();
        if (!existing) {
          await setPrimaryKey(newKey);
          console.log("[ApiKeys] First admin key auto-set as primary dashboard key.");
        }
      } catch { /* non-fatal */ }
    }

    res.status(201).json({
      id: created.id,
      name: created.name,
      key: newKey,
      permissions: created.permissions,
      active: created.active,
      defaultModel: created.defaultModel,
      systemPrompt: created.systemPrompt,
      webhookUrl: created.webhookUrl,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
      warning: "Save this key now — it will not be shown again in full.",
    });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

// ─── PATCH /api/keys/:id ──────────────────────────────────────────────────────
router.patch("/keys/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "BadRequest", message: "Invalid key id." });
    return;
  }

  const { name, permissions, active, defaultModel, systemPrompt, webhookUrl } = req.body as {
    name?: string;
    permissions?: "read" | "write" | "admin";
    active?: boolean;
    defaultModel?: string | null;
    systemPrompt?: string | null;
    webhookUrl?: string | null;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (permissions !== undefined) updates.permissions = permissions;
  if (active !== undefined) updates.active = active;
  if (defaultModel !== undefined) updates.defaultModel = defaultModel;
  if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
  if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;

  try {
    const [updated] = await db
      .update(apiKeysTable)
      .set(updates)
      .where(eq(apiKeysTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "NotFound", message: "API key not found." });
      return;
    }

    res.json({
      id: updated.id,
      name: updated.name,
      key: maskKey(updated.key),
      permissions: updated.permissions,
      active: updated.active,
      defaultModel: updated.defaultModel,
      systemPrompt: updated.systemPrompt,
      webhookUrl: updated.webhookUrl,
      requestCount: updated.requestCount,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

// ─── DELETE /api/keys/:id ─────────────────────────────────────────────────────
router.delete("/keys/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "BadRequest", message: "Invalid key id." });
    return;
  }

  try {
    const [deleted] = await db
      .delete(apiKeysTable)
      .where(eq(apiKeysTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "NotFound", message: "API key not found." });
      return;
    }

    res.json({ success: true, deleted: { id: deleted.id, name: deleted.name } });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

// ─── GET /api/keys/:id/stats ──────────────────────────────────────────────────
router.get("/keys/:id/stats", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "BadRequest", message: "Invalid key id." });
    return;
  }

  try {
    const [key] = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, id))
      .limit(1);

    if (!key) {
      res.status(404).json({ error: "NotFound", message: "API key not found." });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    res.json({
      id: key.id,
      name: key.name,
      key: maskKey(key.key),
      permissions: key.permissions,
      active: key.active,
      defaultModel: key.defaultModel,
      systemPrompt: key.systemPrompt ? "set" : null,
      webhookUrl: key.webhookUrl ? "set" : null,
      requestCount: key.requestCount,
      dailyTokens: key.dailyTokensDate === today ? key.dailyTokens : 0,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

export default router;
