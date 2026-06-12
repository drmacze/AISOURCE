import "dotenv/config";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import app from "./app";
import { logger } from "./lib/logger";
import { startOllamaServer } from "./ollama";
import { startAutoTraining, startMicroTraining } from "./autotraining";
import { startGateway as startOpenClaw } from "./openclaw-manager";
import { isHFConfigured, HF_STATUS } from "./huggingface";

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
startOllamaServer().catch((err) => {
  logger.warn({ err }, "Ollama server failed to start — HuggingFace fallback active");
});

// ─── HuggingFace status ───────────────────────────────────────────────────────
if (isHFConfigured()) {
  logger.info({ token: HF_STATUS.tokenPrefix() }, "HuggingFace connected — offline fallback enabled");
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
startOpenClaw().catch((err) => {
  logger.warn({ err }, "OpenClaw gateway failed to start — will retry automatically");
});

// ─── Auto-training ────────────────────────────────────────────────────────────
const AUTO_TRAIN_INTERVAL_MS = Number(process.env.AUTO_TRAIN_INTERVAL_MS) || 3 * 60 * 60 * 1000;
startAutoTraining(AUTO_TRAIN_INTERVAL_MS);
logger.info({ intervalHours: AUTO_TRAIN_INTERVAL_MS / 3600000 }, "DLavie OS auto-training v2 started (12 sources, multilingual)");

const MICRO_TRAIN_INTERVAL_MS = Number(process.env.MICRO_TRAIN_INTERVAL_MS) || 60_000;
startMicroTraining(MICRO_TRAIN_INTERVAL_MS);
logger.info({ intervalSec: MICRO_TRAIN_INTERVAL_MS / 1000 }, "Micro-training started (EN + ID/AR/FR/ES)");

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
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal: string) {
  logger.info({ signal }, "Graceful shutdown initiated");
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — server continues");
});
process.on("unhandledRejection", (reason) => {
  logger.warn({ reason }, "Unhandled promise rejection");
});
