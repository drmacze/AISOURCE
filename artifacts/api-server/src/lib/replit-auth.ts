/**
 * DLavie OS — Auth System
 *
 * Provides:
 *  - Session management via express-session + PostgreSQL store (SYNCHRONOUS setup)
 *  - Replit Auth via OpenID Connect (background OIDC discovery — non-blocking)
 *  - isAuthenticated middleware (supports both Replit OIDC + native DLavie sessions)
 *  - /api/login, /api/callback, /api/logout endpoints
 *
 * CRITICAL: setupAuth() is now SYNCHRONOUS — safe to call in app.ts without
 *           blocking the module. OIDC discovery runs in the background.
 */

import * as client from "openid-client";
import passport from "passport";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import session from "express-session";
import connectPg from "connect-pg-simple";
import memoize from "memoizee";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { authStorage } from "./auth-storage.js";
import { logger } from "./logger.js";

// ─── OIDC config (cached 1h, re-fetched on expiry) ───────────────────────────
const getOidcConfig = memoize(
  async () => {
    const issuer = process.env.ISSUER_URL ?? "https://replit.com/oidc";
    return await client.discovery(new URL(issuer), process.env.REPL_ID!);
  },
  { maxAge: 3600 * 1000, promise: true },
);

// ─── Build session middleware (synchronous, no network calls) ─────────────────
function buildSessionMiddleware(): RequestHandler {
  const PgStore = connectPg(session);
  const store = new PgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: 7 * 24 * 3600,
    tableName: "sessions",
    errorLog: (err: unknown) => logger.warn({ err }, "[Auth] Session store error (non-fatal)"),
  });

  const secret = process.env.SESSION_SECRET || "dlavie-os-dev-secret-not-for-production";
  if (!process.env.SESSION_SECRET) {
    logger.warn("[Auth] SESSION_SECRET not set — using fallback secret");
  }

  return session({
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge:   7 * 24 * 3600 * 1000,
    },
  });
}

// ─── Passport strategy per hostname (multi-domain safe) ───────────────────────
const registeredStrategies = new Set<string>();

function ensureStrategy(hostname: string) {
  const name = `replitauth:${hostname}`;
  if (registeredStrategies.has(name)) return;

  getOidcConfig().then((config) => {
    const verify: VerifyFunction = async (tokens, verified) => {
      const user: Record<string, unknown> = {};
      const claims = tokens.claims() as Record<string, unknown>;
      user.claims       = claims;
      user.accessToken  = tokens.access_token;
      user.refreshToken = tokens.refresh_token;
      user.expiresAt    = (claims as Record<string, unknown>)?.exp;

      await authStorage.upsertUser({
        id:              String(claims.sub),
        email:           claims.email as string | undefined,
        firstName:       claims.first_name as string | undefined,
        lastName:        claims.last_name as string | undefined,
        profileImageUrl: claims.profile_image_url as string | undefined,
        provider:        "replit",
        providerId:      String(claims.sub),
      }).catch((e) => logger.warn({ e }, "[Auth] upsertUser failed — non-fatal"));

      verified(null, user);
    };

    const strategy = new Strategy(
      {
        name,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${hostname}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
    registeredStrategies.add(name);
    logger.info({ hostname }, "[Auth] OIDC strategy registered");
  }).catch((e) => logger.error({ e }, "[Auth] OIDC strategy registration failed — Replit OAuth unavailable"));
}

// ─── setupAuth — SYNCHRONOUS, safe to call in app.ts without await ───────────
// Session + passport setup is synchronous. OIDC discovery runs in background.
export function setupAuth(app: Express): void {
  app.set("trust proxy", 1);

  // Session middleware — synchronous setup, PG store connects lazily
  app.use(buildSessionMiddleware());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, cb)  => cb(null, user));
  passport.deserializeUser((user, cb) => cb(null, user as Express.User));

  const replId = process.env.REPL_ID;
  if (!replId) {
    logger.warn("[Auth] REPL_ID not set — Replit OAuth disabled, native DLavie auth still active");
    app.get("/api/login",    (_req, res) => res.redirect("/login?error=oauth_disabled"));
    app.get("/api/callback", (_req, res) => res.redirect("/"));
    app.get("/api/logout",   (req, res)  => {
      (req.session as Record<string, unknown>).userId = undefined;
      req.logout(() => {});
      req.session.destroy(() => res.redirect("/login"));
    });
    return;
  }

  // ── Login → redirect to Replit OIDC ──────────────────────────────────────
  app.get("/api/login", (req: Request, res: Response, next: NextFunction) => {
    ensureStrategy(req.hostname);
    const strategyName = `replitauth:${req.hostname}`;
    if (!registeredStrategies.has(strategyName)) {
      // OIDC not ready yet — retry in 1s then proceed
      setTimeout(() => {
        passport.authenticate(strategyName, {
          prompt: "login consent",
          scope:  ["openid", "email", "profile", "offline_access"],
        })(req, res, next);
      }, 1500);
      return;
    }
    passport.authenticate(strategyName, {
      prompt: "login consent",
      scope:  ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  // ── Callback from Replit OIDC ──────────────────────────────────────────────
  app.get("/api/callback", (req: Request, res: Response, next: NextFunction) => {
    ensureStrategy(req.hostname);
    const strategyName = `replitauth:${req.hostname}`;
    passport.authenticate(strategyName, {
      successRedirect: "/",
      failureRedirect: "/login?error=auth_failed",
    })(req, res, next);
  });

  // ── Logout ─────────────────────────────────────────────────────────────────
  app.get("/api/logout", (req: Request, res: Response) => {
    (req.session as Record<string, unknown>).userId = undefined;
    req.logout(() => {});
    req.session.destroy(() => {
      // Try Replit OIDC end-session redirect
      getOidcConfig().then((config) => {
        const endUrl = client.buildEndSessionUrl(config, {
          client_id:                replId,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href;
        res.redirect(endUrl);
      }).catch(() => res.redirect("/login"));
    });
  });

  // Pre-warm OIDC strategy in background (non-blocking)
  const devDomain = process.env.REPL_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    setTimeout(() => ensureStrategy(devDomain), 100);
  }

  logger.info({ replId: replId.slice(0, 8) + "…" }, "[Auth] Replit OIDC auth system initialized");
}

// ─── getSessionUserId — checks both Replit passport + native DLavie session ──
export function getSessionUserId(req: Request): string | null {
  // Native DLavie session (email/password)
  const nativeId = (req.session as Record<string, unknown>).userId as string | undefined;
  if (nativeId) return nativeId;

  // Replit OIDC passport session
  if (req.isAuthenticated && req.isAuthenticated()) {
    const user   = req.user as Record<string, unknown> | undefined;
    const claims = user?.claims as Record<string, unknown> | undefined;
    if (claims?.sub) return String(claims.sub);
  }

  return null;
}

// ─── Legacy alias (used in oauth.ts) ─────────────────────────────────────────
export const getAuthUserId = getSessionUserId;

// ─── isAuthenticated middleware (supports both session types) ─────────────────
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const userId = getSessionUserId(req);
  if (userId) return next();

  // Replit OIDC path — check token expiry + refresh
  if (req.isAuthenticated && req.isAuthenticated()) {
    const user       = req.user as Record<string, unknown>;
    const expiresAt  = user.expiresAt as number | undefined;
    const now        = Math.floor(Date.now() / 1000);

    if (!expiresAt || now < expiresAt) return next();

    const refreshToken = user.refreshToken as string | undefined;
    if (refreshToken) {
      try {
        const config  = await getOidcConfig();
        const tokens  = await client.refreshTokenGrant(config, refreshToken);
        const claims  = tokens.claims() as Record<string, unknown>;
        user.claims       = claims;
        user.accessToken  = tokens.access_token;
        user.refreshToken = tokens.refresh_token;
        user.expiresAt    = claims.exp;
        return next();
      } catch (e) {
        logger.warn({ e }, "[Auth] Token refresh failed");
      }
    }
  }

  return res.status(401).json({ message: "Unauthorized — please log in" });
};

// ─── isAdmin middleware ───────────────────────────────────────────────────────
export const isAdmin: RequestHandler = async (req, res, next) => {
  const userId = getSessionUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const dbUser = await authStorage.getUser(userId).catch(() => null);
  if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
  return next();
};
