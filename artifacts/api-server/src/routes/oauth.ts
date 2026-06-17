/**
 * DLavie OS — OAuth & Auth API Routes
 *
 * GET  /api/auth/me       — current user profile (Replit OIDC or native DLavie session)
 * GET  /api/auth/users    — list all users (admin only)
 * POST /api/auth/admin    — promote user to admin (master key required)
 * GET  /api/auth/status   — public: is auth configured?
 */

import { Router, type Request, type Response } from "express";
import { authStorage } from "../lib/auth-storage.js";
import { getSessionUserId } from "../lib/replit-auth.js";
import { extractRawKey } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Public: auth system status ──────────────────────────────────────────────
router.get("/auth/status", (_req: Request, res: Response) => {
  const replId = process.env.REPL_ID;
  res.json({
    oauthEnabled:      !!replId,
    nativeAuthEnabled: true,
    providers:         ["replit-oidc", "dlavie-native"],
    loginUrl:          "/api/login",
    nativeLoginUrl:    "/api/auth/login/native",
    registerUrl:       "/api/auth/register",
    logoutUrl:         "/api/logout",
    userEndpoint:      "/api/auth/me",
    sessionConfigured: !!process.env.SESSION_SECRET,
  });
});

// ── Protected: current user (supports both Replit OIDC + native DLavie) ──────
router.get("/auth/me", async (req: Request, res: Response) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const user = await authStorage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      id:              user.id,
      email:           user.email,
      username:        user.username,
      firstName:       user.firstName,
      lastName:        user.lastName,
      profileImageUrl: user.profileImageUrl,
      isAdmin:         user.isAdmin,
      role:            user.role,
      provider:        user.provider,
      createdAt:       user.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "[OAuth] /auth/me error");
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

// ── Admin: list all users ────────────────────────────────────────────────────
router.get("/auth/users", async (req: Request, res: Response) => {
  try {
    const userId = getSessionUserId(req);
    const currentUser = userId ? await authStorage.getUser(userId) : null;
    if (!currentUser?.isAdmin) {
      const raw    = extractRawKey(req);
      const master = process.env.DLAVIE_API_KEY;
      if (!master || raw !== master) {
        return res.status(403).json({ message: "Admin access required" });
      }
    }
    const users = await authStorage.getAllUsers();
    res.json({ users, total: users.length });
  } catch (err) {
    logger.error({ err }, "[OAuth] /auth/users error");
    res.status(500).json({ message: "Failed to list users" });
  }
});

// ── Admin: promote user ──────────────────────────────────────────────────────
router.post("/auth/admin", async (req: Request, res: Response) => {
  const raw    = extractRawKey(req);
  const master = process.env.DLAVIE_API_KEY;
  if (!master || raw !== master) {
    return res.status(403).json({ message: "Master API key required" });
  }
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ message: "userId required" });
  await authStorage.makeAdmin(userId);
  res.json({ success: true, message: `User ${userId} promoted to admin` });
});

export default router;
