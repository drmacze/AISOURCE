/**
 * DLavie OS — Shared Auth Middleware
 *
 * Validates API keys against the database.
 * Falls back to the NEXUS_API_KEY env var as a master admin key.
 *
 * Attaches req.apiKey to the request on success.
 */

import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: number | "master";
        name: string;
        permissions: "read" | "write" | "admin";
        defaultModel: string | null;
        systemPrompt: string | null;
        webhookUrl: string | null;
      };
    }
  }
}

const MASTER_KEY = process.env.NEXUS_API_KEY || "";

export function extractRawKey(req: Request): string | null {
  return (
    (req.headers["x-api-key"] as string) ||
    (req.headers["x-nexus-key"] as string) ||
    (req.headers["x-dlavie-key"] as string) ||
    (req.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "") ||
    null
  );
}

/**
 * Validates a raw key string against master key + DB.
 * Returns resolved key info, or null if invalid/inactive.
 */
export async function resolveApiKey(
  rawKey: string
): Promise<{ id: number | "master"; name: string; permissions: "read" | "write" | "admin"; defaultModel: string | null; systemPrompt: string | null; webhookUrl: string | null } | null> {
  // Master key bypass
  if (MASTER_KEY && rawKey === MASTER_KEY) {
    return { id: "master", name: "Master Key", permissions: "admin", defaultModel: null, systemPrompt: null, webhookUrl: null };
  }

  if (!rawKey.startsWith("nxs_")) return null;

  try {
    const [found] = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.key, rawKey))
      .limit(1);

    if (!found || !found.active) return null;

    // Check expiry
    if (found.expiresAt && new Date() > found.expiresAt) return null;

    // Bump request count + lastUsedAt + daily token tracking (fire and forget)
    const today = new Date().toISOString().slice(0, 10);
    const isNewDay = found.dailyTokensDate !== today;
    db.update(apiKeysTable)
      .set({
        requestCount: found.requestCount + 1,
        lastUsedAt: new Date(),
        dailyTokens: isNewDay ? 0 : found.dailyTokens,
        dailyTokensDate: today,
        updatedAt: new Date(),
      })
      .where(eq(apiKeysTable.id, found.id))
      .catch(() => {});

    return {
      id: found.id,
      name: found.name,
      permissions: found.permissions as "read" | "write" | "admin",
      defaultModel: found.defaultModel,
      systemPrompt: found.systemPrompt ?? null,
      webhookUrl: found.webhookUrl ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Increment daily token count for an API key (fire and forget).
 */
export function trackTokens(keyId: number | "master", tokens: number): void {
  if (keyId === "master") return;
  const today = new Date().toISOString().slice(0, 10);
  db.select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.id, keyId as number))
    .limit(1)
    .then(([k]) => {
      if (!k) return;
      const isNewDay = k.dailyTokensDate !== today;
      return db.update(apiKeysTable)
        .set({
          dailyTokens: (isNewDay ? 0 : k.dailyTokens) + tokens,
          dailyTokensDate: today,
          updatedAt: new Date(),
        })
        .where(eq(apiKeysTable.id, keyId as number));
    })
    .catch(() => {});
}

/**
 * Express middleware: requires a valid API key.
 * Optionally requires a minimum permission level.
 */
export function requireAuth(
  minPermission: "read" | "write" | "admin" = "read"
): (req: Request, res: Response, next: NextFunction) => void {
  const PERM_RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };

  return (req: Request, res: Response, next: NextFunction) => {
    const rawKey = extractRawKey(req);

    if (!rawKey) {
      // If neither master key nor DB keys are configured, open access for dev
      if (!MASTER_KEY) {
        req.apiKey = { id: "master", name: "Open (no key set)", permissions: "admin", defaultModel: null, systemPrompt: null, webhookUrl: null };
        return next();
      }
      res.status(401).json({
        error: "Unauthorized",
        message: "API key required.",
        hint: "Pass your key as: X-API-Key: nxs_... or Authorization: Bearer nxs_...",
      });
      return;
    }

    resolveApiKey(rawKey).then((resolved) => {
      if (!resolved) {
        res.status(401).json({
          error: "Unauthorized",
          message: "Invalid or revoked API key.",
          hint: "Generate a new key from the DLavie OS dashboard → API Keys page.",
        });
        return;
      }

      const rank = PERM_RANK[resolved.permissions] ?? 0;
      const required = PERM_RANK[minPermission] ?? 0;
      if (rank < required) {
        res.status(403).json({
          error: "Forbidden",
          message: `This endpoint requires '${minPermission}' permission. Your key has '${resolved.permissions}'.`,
        });
        return;
      }

      req.apiKey = resolved;
      next();
    }).catch(() => {
      res.status(500).json({ error: "AuthError", message: "Failed to validate API key." });
    });
  };
}
