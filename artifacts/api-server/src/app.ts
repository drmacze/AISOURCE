import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage/index.js";
import path from "path";
import { existsSync } from "fs";

const app: Express = express();

// ─── Logging ─────────────────────────────────────────────────────────────────
app.use(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pinoHttp as unknown as (opts: unknown) => import("express").RequestHandler)({
    logger,
    serializers: {
      req(req: { id: unknown; method: string; url?: string }) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res: { statusCode: number }) {
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

// ─── .well-known — ChatGPT Actions manifest files ─────────────────────────────
app.get("/.well-known/ai-plugin.json", (req: Request, res: Response) => {
  const host = `${req.protocol}://${req.get("host")}`;
  res.setHeader("Content-Type", "application/json");
  res.json({
    schema_version: "v1",
    name_for_human: "DLavie OS",
    name_for_model: "dlavie_os",
    description_for_human: "DLavie OS AI Command Center — Read, write, and edit AI conversations, documents, and training data.",
    description_for_model: "Use this plugin to interact with DLavie OS. You can read, create, edit, and delete conversations, documents, and training samples. You can also search the knowledge base and trigger Kaggle GPU training.",
    auth: { type: "none" },
    api: { type: "openapi", url: `${host}/.well-known/openapi.yaml` },
    logo_url: `${host}/favicon.svg`,
    contact_email: "admin@dlavie.ai",
    legal_info_url: `${host}/`,
  });
});

app.get("/.well-known/openapi.yaml", (req: Request, res: Response) => {
  const host = `${req.protocol}://${req.get("host")}`;
  res.setHeader("Content-Type", "text/yaml; charset=utf-8");
  res.send(`openapi: "3.1.0"
info:
  title: DLavie OS API
  description: DLavie OS AI Command Center — Read, write, and edit AI conversations, documents, training data, and trigger Kaggle GPU training.
  version: "2.0.0"
servers:
  - url: ${host}
    description: DLavie OS
paths:
  /api/chatgpt/status:
    get:
      operationId: getStatus
      summary: System status
      description: Get DLavie OS system status and data statistics. No auth required.
      responses:
        "200":
          description: System status
          content:
            application/json:
              schema:
                type: object
                properties:
                  status: { type: string }
                  stats:
                    type: object
                    properties:
                      conversations: { type: integer }
                      documents: { type: integer }
                      trainingSamples: { type: integer }
  /api/chatgpt/conversations:
    get:
      operationId: listConversations
      summary: List conversations
      description: List all chat conversations in DLavie OS (newest first, max 50)
      responses:
        "200":
          description: List of conversations
          content:
            application/json:
              schema:
                type: object
                properties:
                  conversations:
                    type: array
                    items:
                      type: object
                      properties:
                        id: { type: integer }
                        title: { type: string }
                        createdAt: { type: string }
                        updatedAt: { type: string }
    post:
      operationId: createConversation
      summary: Create a new conversation
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                title: { type: string, description: "Conversation title" }
      responses:
        "201":
          description: Created conversation
  /api/chatgpt/conversations/{id}:
    get:
      operationId: getConversation
      summary: Get conversation with messages
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Conversation with all messages
    delete:
      operationId: deleteConversation
      summary: Delete a conversation and all its messages
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Deleted successfully
  /api/chatgpt/conversations/{id}/messages:
    post:
      operationId: addMessage
      summary: Add a message to a conversation
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [content]
              properties:
                role:
                  type: string
                  enum: [user, assistant]
                  default: user
                content: { type: string, description: "Message text" }
      responses:
        "201":
          description: Message added
  /api/chatgpt/documents:
    get:
      operationId: listDocuments
      summary: List all documents in knowledge base
      responses:
        "200":
          description: List of documents
    post:
      operationId: createDocument
      summary: Create a new document
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, content]
              properties:
                title: { type: string }
                content: { type: string }
                type: { type: string, default: text }
      responses:
        "201":
          description: Created document
  /api/chatgpt/documents/{id}:
    patch:
      operationId: editDocument
      summary: Edit a document (title or content)
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                title: { type: string }
                content: { type: string }
      responses:
        "200":
          description: Updated document
    delete:
      operationId: deleteDocument
      summary: Delete a document
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Deleted successfully
  /api/chatgpt/search:
    get:
      operationId: searchKnowledgeBase
      summary: Search knowledge base by keyword
      parameters:
        - name: q
          in: query
          required: true
          schema: { type: string }
          description: Search query
      responses:
        "200":
          description: Search results
  /api/chatgpt/training:
    get:
      operationId: listTrainingSamples
      summary: List training samples
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 50 }
        - name: offset
          in: query
          schema: { type: integer, default: 0 }
      responses:
        "200":
          description: Training samples
    post:
      operationId: addTrainingSample
      summary: Add a new training sample (input/output pair)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [input, output]
              properties:
                input: { type: string, description: "Training input / question" }
                output: { type: string, description: "Expected output / answer" }
                datasetId: { type: integer, description: "Dataset ID (optional, uses first dataset if omitted)" }
      responses:
        "201":
          description: Training sample added
  /api/chatgpt/kaggle/sync:
    post:
      operationId: syncKaggleDataset
      summary: Sync training dataset to Kaggle
      description: Uploads all training samples from DLavie OS database to the Kaggle dataset for GPU training.
      responses:
        "200":
          description: Sync result with number of samples uploaded
  /api/chatgpt/kaggle/train:
    post:
      operationId: runKaggleTraining
      summary: Trigger GPU training on Kaggle
      description: Launches the LoRA fine-tuning kernel on Kaggle GPU. Returns training URL.
      responses:
        "200":
          description: Training job started or queued
`);
});

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
