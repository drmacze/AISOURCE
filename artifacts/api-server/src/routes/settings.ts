/**
 * DLavie OS — Settings & ENV Secrets API
 *
 * GET    /api/settings          — system status (env + system config)
 * GET    /api/settings/secrets  — list all stored secrets (names + masked values)
 * POST   /api/settings/secrets  — add or update a secret { name, value }
 * DELETE /api/settings/secrets/:name — delete a secret by env name
 * POST   /api/settings/reload   — reload all secrets from file into process.env
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const CONFIG_PATH = join(process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace", ".dlavie-config.json");

interface ConfigFile {
  secrets?: Record<string, string>;
  updatedAt?: string;
  // legacy fields — kept for migration
  hfToken?: string;
  moonshotApiKey?: string;
  githubToken?: string;
  nexusApiKey?: string;
}

const LEGACY_MAP: Record<string, string> = {
  hfToken: "HF_TOKEN",
  moonshotApiKey: "MOONSHOT_API_KEY",
  githubToken: "GITHUB_TOKEN",
  nexusApiKey: "NEXUS_API_KEY",
};

function readConfig(): ConfigFile {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ConfigFile;
    }
  } catch { /* ignore */ }
  return {};
}

/** Read secrets map, migrating legacy fields automatically */
function readSecrets(): Record<string, string> {
  const cfg = readConfig();
  const secrets: Record<string, string> = { ...(cfg.secrets || {}) };
  // migrate legacy fields into secrets map
  for (const [legacyKey, envName] of Object.entries(LEGACY_MAP)) {
    const val = cfg[legacyKey as keyof ConfigFile] as string | undefined;
    if (val && !secrets[envName]) {
      secrets[envName] = val;
    }
  }
  return secrets;
}

function writeSecrets(secrets: Record<string, string>) {
  const cfg = readConfig();
  cfg.secrets = secrets;
  cfg.updatedAt = new Date().toISOString();
  // clear legacy fields — they're now in secrets map
  delete cfg.hfToken;
  delete cfg.moonshotApiKey;
  delete cfg.githubToken;
  delete cfg.nexusApiKey;
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function maskValue(val: string): string {
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••" + val.slice(-4);
}

function validateEnvName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

/** Apply all secrets to process.env */
function applySecrets(secrets: Record<string, string>) {
  for (const [name, value] of Object.entries(secrets)) {
    process.env[name] = value;
  }
}

// ─── Apply saved secrets on module load ──────────────────────────────────────
applySecrets(readSecrets());

// ─── GET /api/settings — system status ────────────────────────────────────────
router.get("/settings", (_req, res) => {
  const cfg = readConfig();
  res.json({
    env: {
      nodeEnv: process.env.NODE_ENV || "development",
      port: process.env.PORT || "8080",
      ollamaModels: process.env.OLLAMA_MODELS || "~/.ollama/models",
      ollamaHost: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    },
    fileConfig: {
      exists: existsSync(CONFIG_PATH),
      path: CONFIG_PATH,
      updatedAt: cfg.updatedAt || null,
    },
    restartRequired: false,
  });
});

// ─── GET /api/settings/secrets ────────────────────────────────────────────────
router.get("/settings/secrets", (_req, res) => {
  const secrets = readSecrets();
  const list = Object.entries(secrets).map(([name, value]) => ({
    name,
    masked: maskValue(value),
    set: true,
    // also show live process.env status
    active: process.env[name] === value,
  }));
  res.json({ secrets: list, total: list.length });
});

// ─── POST /api/settings/secrets ───────────────────────────────────────────────
router.post("/settings/secrets", (req: Request, res: Response) => {
  const { name, value } = req.body as { name?: string; value?: string };

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const envName = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

  if (!validateEnvName(envName)) {
    res.status(400).json({ error: "Name must start with a letter and contain only letters, numbers, underscores" });
    return;
  }

  if (!value || typeof value !== "string" || !value.trim()) {
    res.status(400).json({ error: "value is required" });
    return;
  }

  const trimmed = value.trim();
  const secrets = readSecrets();
  secrets[envName] = trimmed;
  writeSecrets(secrets);

  // Apply immediately to running process
  process.env[envName] = trimmed;

  logger.info({ name: envName }, "Secret saved and applied to process.env");

  res.json({ success: true, name: envName, message: "Secret saved and active immediately." });
});

// ─── DELETE /api/settings/secrets/:name ───────────────────────────────────────
router.delete("/settings/secrets/:name", (req: Request, res: Response) => {
  const name = req.params.name?.trim().toUpperCase();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const secrets = readSecrets();
  if (!secrets[name]) {
    res.status(404).json({ error: "Secret not found", name });
    return;
  }

  delete secrets[name];
  writeSecrets(secrets);

  // Remove from process.env
  delete process.env[name];

  logger.info({ name }, "Secret deleted");
  res.json({ success: true, name, message: "Secret deleted." });
});

// ─── POST /api/settings/reload ────────────────────────────────────────────────
router.post("/settings/reload", (_req, res) => {
  const secrets = readSecrets();
  applySecrets(secrets);
  const applied = Object.keys(secrets).length;
  logger.info({ applied }, "All secrets reloaded into process.env");
  res.json({
    success: true,
    applied,
    message: applied > 0 ? `Reloaded ${applied} secret(s) into environment.` : "No secrets to reload.",
  });
});

export default router;
