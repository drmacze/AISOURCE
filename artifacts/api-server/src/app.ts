import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
// Security is enforced via NEXUS_API_KEY on protected /api/v1/* endpoints.
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
      "X-Nexus-Key",
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

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api", router);

export default app;
