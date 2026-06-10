/**
 * DLavie OS — Settings API
 *
 * Provides read-only status for all configured integrations
 * and allows updating API keys (requires restart to take effect).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const CONFIG_PATH = join(process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace", ".dlavie-config.json");

interface ConfigFile {
  hfToken?: string;
  moonshotApiKey?: string;
  githubToken?: string;
  nexusApiKey?: string;
  updatedAt?: string;
}

function readConfig(): ConfigFile {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ConfigFile;
    }
  } catch { /* ignore */ }
  return {};
}

function writeConfig(cfg: ConfigFile) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

/** GET /api/settings — status of all integrations */
router.get("/settings", (_req, res) => {
  const env = {
    hfToken: !!process.env.HF_TOKEN,
    hfTokenPrefix: process.env.HF_TOKEN ? maskKey(process.env.HF_TOKEN) : null,
    moonshotApiKey: !!process.env.MOONSHOT_API_KEY,
    moonshotPrefix: process.env.MOONSHOT_API_KEY ? maskKey(process.env.MOONSHOT_API_KEY) : null,
    githubToken: !!process.env.GITHUB_TOKEN,
    githubPrefix: process.env.GITHUB_TOKEN ? maskKey(process.env.GITHUB_TOKEN) : null,
    nexusApiKey: !!process.env.NEXUS_API_KEY,
    nexusPrefix: process.env.NEXUS_API_KEY ? maskKey(process.env.NEXUS_API_KEY) : null,
  };

  const file = readConfig();
  const fileExists = existsSync(CONFIG_PATH);

  res.json({
    integrations: {
      huggingface: {
        name: "HuggingFace",
        description: "Image Gen, RAG embeddings, chat fallback",
        configured: env.hfToken,
        maskedKey: env.hfTokenPrefix,
        source: env.hfToken ? "Replit Secrets" : "not set",
      },
      moonshot: {
        name: "Kimi K2 (MoonshotAI)",
        description: "1T MoE cloud reasoning model",
        configured: env.moonshotApiKey,
        maskedKey: env.moonshotPrefix,
        source: env.moonshotApiKey ? "Replit Secrets" : "not set",
      },
      github: {
        name: "GitHub",
        description: "Auto-training datasets, rate limit 5000 req/hr",
        configured: env.githubToken,
        maskedKey: env.githubPrefix,
        source: env.githubToken ? "Replit Secrets" : "not set",
      },
      nexus: {
        name: "NEXUS API Key",
        description: "Admin access for key management",
        configured: env.nexusApiKey,
        maskedKey: env.nexusPrefix,
        source: env.nexusApiKey ? "Replit Secrets" : "not set",
      },
    },
    fileConfig: {
      exists: fileExists,
      path: CONFIG_PATH,
      updatedAt: file.updatedAt || null,
    },
    env: {
      nodeEnv: process.env.NODE_ENV || "development",
      port: process.env.PORT || "8080",
      ollamaModels: process.env.OLLAMA_MODELS || "~/.ollama/models",
      ollamaHost: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    },
    restartRequired: false,
  });
});

/** POST /api/settings/update — update a key value (saved to config file) */
router.post("/settings/update", async (req: Request, res: Response) => {
  const { key, value } = req.body as { key?: string; value?: string };

  const validKeys = ["hfToken", "moonshotApiKey", "githubToken", "nexusApiKey"];
  if (!key || !validKeys.includes(key)) {
    res.status(400).json({ error: "Invalid key name", validKeys });
    return;
  }

  if (!value || typeof value !== "string" || !value.trim()) {
    res.status(400).json({ error: "Value is required" });
    return;
  }

  const config = readConfig();
  const mapping: Record<string, keyof ConfigFile> = {
    hfToken: "hfToken",
    moonshotApiKey: "moonshotApiKey",
    githubToken: "githubToken",
    nexusApiKey: "nexusApiKey",
  };

  config[mapping[key]!] = value.trim();
  config.updatedAt = new Date().toISOString();
  writeConfig(config);

  logger.info({ key }, "API key updated in config file — restart required");

  res.json({
    success: true,
    key,
    message: "Key saved to config file. Restart the API server to apply changes.",
    restartRequired: true,
  });
});

/** POST /api/settings/reload — attempt to reload env from config file */
router.post("/settings/reload", (_req, res) => {
  const config = readConfig();
  let applied = 0;

  if (config.hfToken && !process.env.HF_TOKEN) {
    process.env.HF_TOKEN = config.hfToken;
    applied++;
  }
  if (config.moonshotApiKey && !process.env.MOONSHOT_API_KEY) {
    process.env.MOONSHOT_API_KEY = config.moonshotApiKey;
    applied++;
  }
  if (config.githubToken && !process.env.GITHUB_TOKEN) {
    process.env.GITHUB_TOKEN = config.githubToken;
    applied++;
  }
  if (config.nexusApiKey && !process.env.NEXUS_API_KEY) {
    process.env.NEXUS_API_KEY = config.nexusApiKey;
    applied++;
  }

  logger.info({ applied }, "Hot-reloaded keys from config file");

  res.json({
    success: true,
    applied,
    message: applied > 0
      ? `Hot-reloaded ${applied} key(s). Some features may require a restart to fully activate.`
      : "No new keys to reload — all keys are already set.",
  });
});

export default router;
