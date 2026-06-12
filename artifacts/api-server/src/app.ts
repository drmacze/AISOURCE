import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import path from "path";
import { existsSync } from "fs";

const app: Express = express();

// ─── Logging ─────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Wide-open CORS for multi-platform use (web, mobile, desktop, Postman, curl).
// Security is enforced via DLAVIE_API_KEY on protected /api/v1/* endpoints.
app.use(
  cors({
    origin(origin, callback) {
      // Allow:
      //  • No origin   → curl, Postman, server-to-server, React Native fetch
      //  • null origin → file:// (mobile WebView, Capacitor, Electron)
      //  • localhost   → local dev (any port)
      //  • 127.0.0.1   → local dev
      //  • 10.x / 192.168.x → LAN dev on mobile
      //  • HTTPS       → any deployed web app, Vercel, Netlify, etc.
      //  • Replit      → .replit.dev and .replit.app
      if (!origin || origin === "null") return callback(null, true);
      if (
        origin.startsWith("https://") ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        /^http:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin) ||
        /\.replit\.(dev|app)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-DLavie-Key",
      "X-DLavie-Key",
      "X-Requested-With",
      "Accept",
      "Cache-Control",
    ],
    exposedHeaders: ["X-Conversation-Id", "X-Request-Id"],
    credentials: true,
    maxAge: 86400, // preflight cache 24h
  })
);

// Handle OPTIONS preflight explicitly for all routes (Express 5 compatible)
app.options("/{*path}", cors());

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Health check (for Replit deployment probe) ───────────────────────────────
app.get("/api/healthz", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    ts: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api", router);

// ─── Replit Object Storage (presigned upload + file serving) ─────────────────
registerObjectStorageRoutes(app);

// ─── Static frontend (production only) ───────────────────────────────────────
// In production the Vite app is pre-built; serve it from the API process so
// a single port (5000) handles both the API and the web UI.
const WORKSPACE_ROOT = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const FRONTEND_DIST = path.join(WORKSPACE_ROOT, "artifacts", "ai-web-app", "dist", "public");

if (process.env.NODE_ENV === "production" && existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST, { index: false }));
  // SPA fallback — all non-API routes return index.html
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
  logger.info({ dir: FRONTEND_DIST }, "Serving static frontend");
}

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({
    error: err.name || "InternalError",
    message: err.message || "An unexpected error occurred.",
  });
});

export default app;
