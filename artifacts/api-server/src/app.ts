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
//
// Path resolution strategy (tries in order):
//   1. process.cwd() — most reliable; run command never changes CWD
//   2. REPL_HOME env — Replit workspace root env var
//   3. HOME env — fallback home dir
//   4. Hardcoded Replit default
const candidateRoots = [
  process.cwd(),
  process.env.REPL_HOME,
  process.env.HOME,
  "/home/runner/workspace",
].filter(Boolean) as string[];

const FRONTEND_DIST = candidateRoots
  .map((root) => path.join(root, "artifacts", "ai-web-app", "dist", "public"))
  .find(existsSync) ?? path.join(candidateRoots[0], "artifacts", "ai-web-app", "dist", "public");

if (process.env.NODE_ENV === "production") {
  if (existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST, { index: false }));
    // SPA fallback — all non-API routes serve index.html (client-side routing)
    app.get("/{*path}", (_req: Request, res: Response) => {
      res.sendFile(path.join(FRONTEND_DIST, "index.html"));
    });
    logger.info({ dir: FRONTEND_DIST }, "Serving static frontend ✅");
  } else {
    // Frontend build not found — show a helpful error page instead of blank
    logger.error({ tried: candidateRoots.map((r) => path.join(r, "artifacts/ai-web-app/dist/public")) }, "Frontend build NOT found ❌");
    app.get("/{*path}", (_req: Request, res: Response) => {
      res.status(503).send(
        `<!DOCTYPE html><html><head><title>DLavie OS — Build Missing</title>
        <style>body{background:#0a0f1a;color:#a0aec0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
        .box{text-align:center;padding:40px;border:1px solid #1a2744;border-radius:12px}
        h1{color:#4ade80;font-size:1.5rem;margin-bottom:12px}code{color:#facc15;background:#1a2744;padding:4px 8px;border-radius:4px}</style></head>
        <body><div class="box"><h1>DLavie OS</h1><p>Frontend build not found.</p>
        <p>Run <code>pnpm --filter @workspace/ai-web-app run build</code> first.</p>
        <p>API is running — <a href="/api/healthz" style="color:#4ade80">/api/healthz</a></p></div></body></html>`
      );
    });
  }
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
