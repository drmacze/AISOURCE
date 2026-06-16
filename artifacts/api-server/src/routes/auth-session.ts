/**
 * DLavie OS — Persistent Auth Session
 *
 * GET  /api/auth/session   — return the stored primary admin key (auto-login)
 * POST /api/auth/session   — set a key as the primary admin key (requires admin auth)
 * DELETE /api/auth/session — clear the primary admin key (requires admin auth)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, systemConfigTable, apiKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router: IRouter = Router();

const PRIMARY_KEY_CONFIG = "primary_admin_key";

async function getPrimaryKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, PRIMARY_KEY_CONFIG))
      .limit(1);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function setPrimaryKey(keyValue: string): Promise<void> {
  await db
    .insert(systemConfigTable)
    .values({ key: PRIMARY_KEY_CONFIG, value: keyValue, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemConfigTable.key,
      set: { value: keyValue, updatedAt: new Date() },
    });
}

export { getPrimaryKey, setPrimaryKey };

/** GET /api/auth/session — returns stored primary key so UI can auto-authenticate */
router.get("/auth/session", async (_req: Request, res: Response) => {
  const primaryKey = await getPrimaryKey();

  if (primaryKey) {
    try {
      const [row] = await db
        .select()
        .from(apiKeysTable)
        .where(eq(apiKeysTable.key, primaryKey))
        .limit(1);

      if (row && row.active && row.permissions === "admin") {
        const expired = row.expiresAt && new Date() > row.expiresAt;
        if (!expired) {
          res.json({ found: true, key: primaryKey, name: row.name, permissions: row.permissions });
          return;
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: if DLAVIE_API_KEY is set in env (e.g. saved via Settings), use it automatically
  // so the user doesn't need to paste it manually every time
  const dlavieKey = process.env.DLAVIE_API_KEY;
  if (dlavieKey) {
    res.json({ found: true, key: dlavieKey, name: "DLavie Admin Key", permissions: "admin" });
    return;
  }

  res.json({ found: false, key: null });
});

/** POST /api/auth/session — set a specific key as primary (admin only) */
router.post("/auth/session", requireAuth("admin"), async (req: Request, res: Response) => {
  const { keyId } = req.body as { keyId?: number };
  if (!keyId || typeof keyId !== "number") {
    res.status(400).json({ error: "keyId is required" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, keyId))
      .limit(1);

    if (!row || !row.active || row.permissions !== "admin") {
      res.status(400).json({ error: "Key must exist, be active, and have admin permission." });
      return;
    }

    await setPrimaryKey(row.key);
    res.json({ success: true, message: "Primary admin key updated." });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

/** DELETE /api/auth/session — clear the primary key (admin only) */
router.delete("/auth/session", requireAuth("admin"), async (_req: Request, res: Response) => {
  try {
    await db
      .delete(systemConfigTable)
      .where(eq(systemConfigTable.key, PRIMARY_KEY_CONFIG));
    res.json({ success: true, message: "Primary admin key cleared." });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

export default router;
