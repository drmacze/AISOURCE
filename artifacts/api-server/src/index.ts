import "dotenv/config";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initDatabase } from "./lib/db-init.js";
import { startOllamaServer } from "./ollama.js";
import { startAutoTraining, startMicroTraining } from "./autotraining.js";
import { startGateway as startOpenClaw } from "./openclaw-manager.js";
import { startWorkers, stopWorkers } from "./agent-workers.js";
import { isHFConfigured, HF_STATUS, probeHFToken } from "./huggingface.js";
import { startAlwaysOn, stopAlwaysOn } from "./always-on.js";

// ─── Load saved secrets from config file on startup ──────────────────────────
// (The settings route module applies them too, but we need them before routes load)
const CONFIG_PATH = join(process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace", ".dlavie-config.json");
try {
  if (existsSync(CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
      secrets?: Record<string, string>;
      hfToken?: string; moonshotApiKey?: string; githubToken?: string; dlavieApiKey?: string;
    };
    // New generic secrets map — always override (user set from Settings UI takes priority)
    if (cfg.secrets) {
      for (const [k, v] of Object.entries(cfg.secrets)) {
        if (k && v) process.env[k] = v;
      }
    }
    // Legacy field migration — always override env var (UI-set value > Replit secret)
    if (cfg.hfToken)        process.env.HF_TOKEN          = cfg.hfToken;
    if (cfg.moonshotApiKey) process.env.MOONSHOT_API_KEY  = cfg.moonshotApiKey;
    if (cfg.githubToken)    process.env.GITHUB_TOKEN      = cfg.githubToken;
    if (cfg.dlavieApiKey)    process.env.DLAVIE_API_KEY     = cfg.dlavieApiKey;
  }
} catch { /* ignore parse errors */ }

// ─── Port ─────────────────────────────────────────────────────────────────────
const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT: "${rawPort}"`);

// ─── Real Disk Storage Setup ──────────────────────────────────────────────────
// Ollama models stored on real Replit disk (256GB). Falls back to ~/.ollama/models.
const WORKSPACE_ROOT = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const DEFAULT_OLLAMA_MODELS_PATH = join(WORKSPACE_ROOT, ".ollama-models");

if (!process.env.OLLAMA_MODELS) {
  try {
    mkdirSync(DEFAULT_OLLAMA_MODELS_PATH, { recursive: true });
    process.env.OLLAMA_MODELS = DEFAULT_OLLAMA_MODELS_PATH;
    logger.info({ path: DEFAULT_OLLAMA_MODELS_PATH }, "Ollama models path initialised on real disk");
  } catch (e) {
    logger.warn({ err: e }, "Could not create .ollama-models dir — using Ollama default");
  }
}

// Create upload storage dir
const UPLOADS_PATH = join(WORKSPACE_ROOT, ".uploads");
try {
  mkdirSync(UPLOADS_PATH, { recursive: true });
} catch { /* ignore */ }

// Create training artifacts dir
const TRAINING_PATH = join(WORKSPACE_ROOT, ".training-artifacts");
try {
  mkdirSync(TRAINING_PATH, { recursive: true });
} catch { /* ignore */ }

// ─── Ollama (background) ──────────────────────────────────────────────────────
startOllamaServer().catch((err: unknown) => {
  logger.warn({ err }, "Ollama server failed to start — HuggingFace fallback active");
});

// ─── HuggingFace status + token probe ─────────────────────────────────────────
if (isHFConfigured()) {
  logger.info({ token: HF_STATUS.tokenPrefix() }, "HuggingFace connected — probing token validity…");
  // Probe in background — no need to await startup on this
  probeHFToken().then((ok: boolean) => {
    if (ok) {
      logger.info("HuggingFace token valid ✅ — using HF GPU inference");
    } else {
      logger.warn("HuggingFace token invalid/expired ⚠️ — skipping HF, using Groq+OpenRouter");
    }
  }).catch((_e: unknown) => {
    logger.warn("HuggingFace probe timed out — will retry on first use");
  });
} else {
  logger.warn("HF_TOKEN not set — HuggingFace offline fallback disabled");
}

// ─── GitHub token status ──────────────────────────────────────────────────────
if (process.env.GITHUB_TOKEN) {
  logger.info({ token: process.env.GITHUB_TOKEN.slice(0, 8) + "..." }, "GitHub token found — 5000 req/hr for auto-training");
} else {
  logger.warn("GITHUB_TOKEN not set — GitHub API limited to 60 req/hr");
}

// ─── Prompts auto-seed ────────────────────────────────────────────────────────
// Seed default prompt library on first boot (no-op if already seeded)
setTimeout(async () => {
  try {
    const { db } = await import("@workspace/db");
    const { promptsTable } = await import("@workspace/db");
    const { count } = await import("drizzle-orm");
    const [{ c }] = await db.select({ c: count() }).from(promptsTable);
    if ((c ?? 0) === 0) {
      await fetch(`http://127.0.0.1:${rawPort}/api/prompts/seed`, { method: "POST" });
      logger.info("Prompts library seeded with default prompts");
    }
  } catch (e) {
    logger.warn({ err: e }, "Prompts auto-seed failed (non-fatal)");
  }
}, 3000);

// ─── OpenClaw Gateway (background) ───────────────────────────────────────────
startOpenClaw().catch((err: unknown) => {
  logger.warn({ err }, "OpenClaw gateway failed to start — will retry automatically");
});

// ─── Multi-Agent Job Workers (background 24/7) ────────────────────────────────
// 8 specialist agents covering every DLavie OS feature — boot after 15s
// so the HTTP server and DB are fully ready before workers start.
setTimeout(() => {
  startWorkers();
  logger.info("Multi-agent worker system started (8 agents, 24/7)");
}, 15_000);

// ─── Auto-training ────────────────────────────────────────────────────────────
const AUTO_TRAIN_INTERVAL_MS = Number(process.env.AUTO_TRAIN_INTERVAL_MS) || 3 * 60 * 60 * 1000;
startAutoTraining(AUTO_TRAIN_INTERVAL_MS);
logger.info({ intervalHours: AUTO_TRAIN_INTERVAL_MS / 3600000 }, "DLavie OS auto-training v2 started (12 sources, multilingual)");

const MICRO_TRAIN_INTERVAL_MS = Number(process.env.MICRO_TRAIN_INTERVAL_MS) || 60_000;
startMicroTraining(MICRO_TRAIN_INTERVAL_MS);
logger.info({ intervalSec: MICRO_TRAIN_INTERVAL_MS / 1000 }, "Micro-training started (EN + ID/AR/FR/ES)");

// ─── Database initialization (pgvector + schema push) ─────────────────────────
// Runs synchronously before the server accepts any requests.
// Ensures all tables and extensions are created on every cold start.
await initDatabase();

// ─── Server (bind 0.0.0.0 for Replit deployment) ─────────────────────────────
app.listen(port, "0.0.0.0", (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error starting server");
    process.exit(1);
  }
  logger.info(
    {
      port,
      host: "0.0.0.0",
      env: process.env.NODE_ENV || "development",
      ollamaModels: process.env.OLLAMA_MODELS || "~/.ollama/models",
      hf: isHFConfigured(),
      github: !!process.env.GITHUB_TOKEN,
    },
    "DLavie OS API Server ready"
  );

  // Autonomous agent disabled — replaced by OpenClaw gateway.
});

// ─── Always-On Engine ─────────────────────────────────────────────────────────
// Starts after the HTTP server is listening so all services are ready.
// Detects Replit public URL automatically.
const replDomain =
  process.env.REPL_DEV_DOMAIN ||
  process.env.REPLIT_DEV_DOMAIN ||
  process.env.REPL_SLUG
    ? `https://${process.env.REPL_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN}`
    : `http://localhost:${port}`;

startAlwaysOn(replDomain);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal: string) {
  logger.info({ signal }, "Graceful shutdown initiated");
  stopAlwaysOn();
  stopWorkers();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
// Note: uncaughtException and unhandledRejection are managed by always-on.ts
// (Process Hardener replaces these handlers and keeps the server alive)
