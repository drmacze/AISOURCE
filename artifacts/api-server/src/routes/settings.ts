/**
 * DLavie OS — Settings & ENV Secrets API
 *
 * GET    /api/settings                — system status (env + system config)
 * GET    /api/settings/secrets        — list all stored secrets (names + masked values)
 * POST   /api/settings/secrets        — add or update a secret { name, value }
 * POST   /api/settings/secrets/test   — live test a key against its real provider API
 * DELETE /api/settings/secrets/:name  — delete a secret by env name
 * POST   /api/settings/reload         — reload all secrets from file into process.env
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
  dlavieApiKey?: string;
}

const LEGACY_MAP: Record<string, string> = {
  hfToken: "HF_TOKEN",
  moonshotApiKey: "MOONSHOT_API_KEY",
  githubToken: "GITHUB_TOKEN",
  dlavieApiKey: "DLAVIE_API_KEY",
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
  delete cfg.dlavieApiKey;
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
      port: process.env.PORT || "3000",
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

// ─── POST /api/settings/secrets/test ─────────────────────────────────────────
// Live-tests a key against the real provider API. Returns { ok, provider, detail }.
router.post("/settings/secrets/test", async (req: Request, res: Response) => {
  const { name, value } = req.body as { name?: string; value?: string };

  if (!name || !value) {
    res.status(400).json({ ok: false, error: "name and value are required" });
    return;
  }

  const key = value.trim();

  try {
    let result: { ok: boolean; provider: string; detail: string };

    switch (name.trim().toUpperCase()) {

      case "GROQ_API_KEY": {
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const data = await r.json() as { data?: { id: string }[] };
          const count = data?.data?.length ?? 0;
          result = { ok: true, provider: "Groq", detail: `Valid — ${count} model tersedia` };
        } else {
          const err = await r.json().catch(() => ({})) as { error?: { message?: string } };
          result = { ok: false, provider: "Groq", detail: err?.error?.message || `HTTP ${r.status}` };
        }
        break;
      }

      case "OPENROUTER_API_KEY": {
        const r = await fetch("https://openrouter.ai/api/v1/models", {
          headers: {
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": "https://dlavie-os.replit.app",
            "X-Title": "DLavie OS",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const data = await r.json() as { data?: { id: string }[] };
          const count = data?.data?.length ?? 0;
          result = { ok: true, provider: "OpenRouter", detail: `Valid — ${count} model tersedia` };
        } else {
          const err = await r.json().catch(() => ({})) as { error?: { message?: string } };
          result = { ok: false, provider: "OpenRouter", detail: err?.error?.message || `HTTP ${r.status}` };
        }
        break;
      }

      case "HF_TOKEN": {
        const r = await fetch("https://huggingface.co/api/whoami", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const data = await r.json() as { name?: string; type?: string };
          result = { ok: true, provider: "HuggingFace", detail: `Valid — logged in sebagai @${data?.name || "unknown"}` };
        } else {
          result = { ok: false, provider: "HuggingFace", detail: r.status === 401 ? "Token tidak valid atau expired" : `HTTP ${r.status}` };
        }
        break;
      }

      case "GITHUB_TOKEN": {
        const r = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${key}`,
            "User-Agent": "DLavie OS/1.0",
            Accept: "application/vnd.github+json",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const data = await r.json() as { login?: string; public_repos?: number };
          const rateLimit = r.headers.get("x-ratelimit-remaining");
          result = {
            ok: true,
            provider: "GitHub",
            detail: `Valid — @${data?.login || "unknown"} · ${rateLimit ?? "?"} req/hr tersisa`,
          };
        } else {
          result = { ok: false, provider: "GitHub", detail: r.status === 401 ? "Token tidak valid atau expired" : `HTTP ${r.status}` };
        }
        break;
      }

      default:
        result = { ok: false, provider: name, detail: "Provider tidak dikenali untuk pengujian otomatis" };
    }

    logger.info({ name, ok: result.ok, provider: result.provider }, "Secret connection test");
    res.json(result);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("timeout") || msg.includes("abort");
    res.json({
      ok: false,
      provider: name,
      detail: isTimeout ? "Timeout — tidak ada respons dari server provider" : `Error: ${msg}`,
    });
  }
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
