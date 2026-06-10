/**
 * DLavie OS — API Key Management
 *
 * Endpoints:
 *   GET    /api/keys          — List all API keys (admin only, keys are masked)
 *   POST   /api/keys          — Generate a new API key
 *   PATCH  /api/keys/:id      — Update key name / permissions / active
 *   DELETE /api/keys/:id      — Revoke (delete) an API key
 *   GET    /api/keys/:id/stats — Usage stats for a specific key
 *
 * Admin auth: uses NEXUS_API_KEY env var OR any DB key with 'admin' permission.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

// ─── Master admin key (env var) ───────────────────────────────────────────────
const MASTER_KEY = process.env.NEXUS_API_KEY || "";

function extractKey(req: Request): string | null {
  return (
    (req.headers["x-api-key"] as string) ||
    (req.headers["x-nexus-key"] as string) ||
    (req.headers["x-dlavie-key"] as string) ||
    (req.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "") ||
    null
  );
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = extractKey(req);

  // If master key is set, accept it directly
  if (MASTER_KEY && key === MASTER_KEY) {
    return next();
  }

  // Otherwise check DB for an admin key
  if (key) {
    try {
      const [found] = await db
        .select()
        .from(apiKeysTable)
        .where(eq(apiKeysTable.key, key))
        .limit(1);

      if (found && found.active && found.permissions === "admin") {
        return next();
      }
    } catch {
      // fall through
    }
  }

  // ── Bootstrap mode ──────────────────────────────────────────────────────────
  // When no NEXUS_API_KEY is set AND no keys exist in the DB yet,
  // allow unauthenticated access so the first admin key can be created.
  if (!MASTER_KEY) {
    try {
      const [countRow] = await db
        .select({ c: (await import("drizzle-orm")).count() })
        .from(apiKeysTable);
      if ((countRow?.c ?? 0) === 0) {
        console.warn("[ApiKeys] Bootstrap mode: no keys in DB — unauthenticated access allowed until first admin key is created.");
        return next();
      }
    } catch {
      // If DB query fails, still reject
    }
  }

  res.status(401).json({
    error: "Unauthorized",
    message: "Admin API key required to manage keys.",
    hint: "Pass your admin key as X-API-Key header or Authorization: Bearer <key>",
  });
}

// ─── Generate key ─────────────────────────────────────────────────────────────
function generateKey(): string {
  return "nxs_" + randomBytes(24).toString("hex");
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + "****";
  return key.slice(0, 10) + "..." + key.slice(-4);
}

// ─── GET /api/keys ────────────────────────────────────────────────────────────
router.get("/keys", requireAdmin, async (_req, res) => {
  try {
    const keys = await db
      .select()
      .from(apiKeysTable)
      .orderBy(desc(apiKeysTable.createdAt));

    res.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        key: maskKey(k.key),
        permissions: k.permissions,
        active: k.active,
        defaultModel: k.defaultModel,
        requestCount: k.requestCount,
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
  const { name, permissions = "write", expiresAt, defaultModel } = req.body as {
    name?: string;
    permissions?: "read" | "write" | "admin";
    expiresAt?: string;
    defaultModel?: string;
  };

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "BadRequest", message: "name is required." });
    return;
  }

  const validPerms: Array<"read" | "write" | "admin"> = ["read", "write", "admin"];
  if (!validPerms.includes(permissions)) {
    res.status(400).json({
      error: "BadRequest",
      message: `permissions must be one of: ${validPerms.join(", ")}`,
    });
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
        ...(expiry ? { expiresAt: expiry } : {}),
      })
      .returning();

    // Return the FULL key once — it won't be shown again
    res.status(201).json({
      id: created.id,
      name: created.name,
      key: newKey,
      permissions: created.permissions,
      active: created.active,
      defaultModel: created.defaultModel,
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

  const { name, permissions, active } = req.body as {
    name?: string;
    permissions?: "read" | "write" | "admin";
    active?: boolean;
  };

  const updates: Partial<typeof apiKeysTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (name !== undefined) updates.name = name.trim();
  if (permissions !== undefined) updates.permissions = permissions;
  if (active !== undefined) updates.active = active;

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

    res.json({
      id: key.id,
      name: key.name,
      key: maskKey(key.key),
      permissions: key.permissions,
      active: key.active,
      requestCount: key.requestCount,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

export default router;
