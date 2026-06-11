/**
 * DLavie OS — Model Management API
 *
 * Endpoints:
 *   GET  /api/models/storage        — Get storage config + disk usage
 *   POST /api/models/storage        — Update OLLAMA_MODELS path and restart Ollama
 *   GET  /api/models/list           — List installed Ollama models (full metadata)
 *   POST /api/models/pull           — Pull a model from Ollama hub (SSE streaming)
 *   POST /api/models/delete         — Delete a model
 *   GET  /api/models/hf-search      — Search HuggingFace model hub
 *   GET  /api/models/catalogue      — Curated model catalogue with tags
 *   POST /api/models/show           — Show model info
 *   GET  /api/ollama-models         — Alias used by Training Hub page
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import {
  listOllamaModels,
  deleteOllamaModel,
  getOllamaModelInfo,
  OllamaError,
  OllamaErrorCode,
  STORAGE_CONFIG_FILE,
  loadStorageConfig,
  restartOllamaServer,
} from "../ollama";
import { listHFModels } from "../huggingface";

const router: IRouter = Router();

/** SSE helper */
function sse(res: Response, payload: object) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
function initSSE(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/** Structured error response shape */
function errorBody(err: unknown) {
  if (err instanceof OllamaError) {
    return { code: err.code, message: err.message, hint: err.hint };
  }
  return { code: "UNKNOWN", message: String(err), hint: "An unexpected error occurred." };
}

// ─── Curated catalogue ────────────────────────────────────────────────────────
interface CatalogueEntry {
  name: string;
  label: string;
  desc: string;
  paramSize: string;
  sizeMB: number;
  tag: string;
  icon: string;
  ramGb: number;
  contextK: number;
  languages: string[];
  quantization: string;
  family: string;
}

const MODEL_CATALOGUE: CatalogueEntry[] = [
  // Ultrafast (<1GB)
  {
    name: "tinyllama:latest",    label: "TinyLlama",          desc: "Ultra-fast general chat",
    paramSize: "1.1B",  sizeMB: 637,   tag: "fast",      icon: "⚡",
    ramGb: 2,  contextK: 4,   languages: ["en"],                       quantization: "Q4_0", family: "llama",
  },
  {
    name: "smollm2:1.7b",        label: "SmolLM2 1.7B",       desc: "Compact & efficient",
    paramSize: "1.7B",  sizeMB: 1100,  tag: "fast",      icon: "⚡",
    ramGb: 2,  contextK: 8,   languages: ["en"],                       quantization: "Q4_K_M", family: "smollm2",
  },
  {
    name: "llama3.2:1b",         label: "Llama 3.2 1B",       desc: "Meta Llama 3.2 — very fast",
    paramSize: "1B",    sizeMB: 1300,  tag: "fast",      icon: "⚡",
    ramGb: 2,  contextK: 128, languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"], quantization: "Q4_K_M", family: "llama",
  },
  // Smart (1-4GB)
  {
    name: "qwen2.5:1.5b",        label: "Qwen 2.5 1.5B",      desc: "Fast & capable — highly recommended",
    paramSize: "1.5B",  sizeMB: 940,   tag: "smart",     icon: "🧠",
    ramGb: 2,  contextK: 32,  languages: ["en", "zh", "ar", "fr", "de", "es", "ja", "ko"], quantization: "Q4_K_M", family: "qwen2",
  },
  {
    name: "qwen2.5:3b",          label: "Qwen 2.5 3B",        desc: "Better quality than 1.5B",
    paramSize: "3B",    sizeMB: 1900,  tag: "smart",     icon: "🧠",
    ramGb: 4,  contextK: 32,  languages: ["en", "zh", "ar", "fr", "de", "es", "ja", "ko"], quantization: "Q4_K_M", family: "qwen2",
  },
  {
    name: "gemma2:2b",           label: "Gemma 2 2B",         desc: "Google Gemma 2 — accurate",
    paramSize: "2B",    sizeMB: 1600,  tag: "smart",     icon: "🧠",
    ramGb: 3,  contextK: 8,   languages: ["en"],                       quantization: "Q4_K_M", family: "gemma2",
  },
  {
    name: "gemma3:1b",           label: "Gemma 3 1B",         desc: "Google Gemma 3 — ultra-light",
    paramSize: "1B",    sizeMB: 800,   tag: "smart",     icon: "🧠",
    ramGb: 2,  contextK: 32,  languages: ["en"],                       quantization: "Q4_K_M", family: "gemma3",
  },
  {
    name: "gemma3:4b",           label: "Gemma 3 4B",         desc: "Google Gemma 3 — great quality",
    paramSize: "4B",    sizeMB: 2600,  tag: "smart",     icon: "🧠",
    ramGb: 5,  contextK: 128, languages: ["en"],                       quantization: "Q4_K_M", family: "gemma3",
  },
  {
    name: "llama3.2:3b",         label: "Llama 3.2 3B",       desc: "Meta Llama 3.2 3B — great quality",
    paramSize: "3B",    sizeMB: 2000,  tag: "smart",     icon: "🧠",
    ramGb: 4,  contextK: 128, languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"], quantization: "Q4_K_M", family: "llama",
  },
  {
    name: "llama3.1:8b",         label: "Llama 3.1 8B",       desc: "Meta Llama 3.1 8B — strong reasoner",
    paramSize: "8B",    sizeMB: 4700,  tag: "smart",     icon: "🧠",
    ramGb: 8,  contextK: 128, languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"], quantization: "Q4_K_M", family: "llama",
  },
  {
    name: "llama3.3:70b",      label: "Llama 3.3 70B",      desc: "Meta Llama 3.3 70B — very powerful (needs 40GB+ RAM)",
    paramSize: "70B",   sizeMB: 43000,  tag: "smart",     icon: "🧠",
    ramGb: 44, contextK: 128, languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"], quantization: "Q4_K_M", family: "llama",
  },
  {
    name: "mistral-nemo:12b",  label: "Mistral Nemo 12B",   desc: "Mistral Nemo — large context, multilingual",
    paramSize: "12B",   sizeMB: 7100,   tag: "smart",     icon: "🧠",
    ramGb: 10, contextK: 128, languages: ["en", "fr", "de", "es", "it", "pt", "zh", "ja"], quantization: "Q4_K_M", family: "mistral",
  },
  {
    name: "command-r:35b",     label: "Command R 35B",      desc: "Cohere Command R — RAG-optimized, 35B",
    paramSize: "35B",   sizeMB: 20000,  tag: "smart",     icon: "🧠",
    ramGb: 24, contextK: 128, languages: ["en", "fr", "de", "es", "it", "pt", "zh", "ja", "ar", "ko"], quantization: "Q4_K_M", family: "command-r",
  },
  // Reasoning
  {
    name: "deepseek-r1:1.5b",    label: "DeepSeek-R1 1.5B",   desc: "Reasoning model with chain-of-thought",
    paramSize: "1.5B",  sizeMB: 1100,  tag: "reasoning", icon: "🔍",
    ramGb: 2,  contextK: 64,  languages: ["en", "zh"],                 quantization: "Q4_K_M", family: "deepseek",
  },
  {
    name: "deepseek-r1:7b",      label: "DeepSeek-R1 7B",     desc: "Powerful reasoning — needs 6GB+ RAM",
    paramSize: "7B",    sizeMB: 4700,  tag: "reasoning", icon: "🔍",
    ramGb: 8,  contextK: 64,  languages: ["en", "zh"],                 quantization: "Q4_K_M", family: "deepseek",
  },
  {
    name: "phi3.5:3.8b",         label: "Phi-3.5 3.8B",       desc: "Microsoft — excellent reasoning",
    paramSize: "3.8B",  sizeMB: 2200,  tag: "reasoning", icon: "🔍",
    ramGb: 5,  contextK: 128, languages: ["en"],                       quantization: "Q4_K_M", family: "phi3",
  },
  {
    name: "phi4-mini:3.8b",      label: "Phi-4 Mini",         desc: "Microsoft Phi-4 Mini — latest",
    paramSize: "3.8B",  sizeMB: 2500,  tag: "reasoning", icon: "🔍",
    ramGb: 5,  contextK: 128, languages: ["en"],                       quantization: "Q4_K_M", family: "phi4",
  },
  {
    name: "phi4:14b",            label: "Phi-4 14B",          desc: "Microsoft Phi-4 full — top reasoning",
    paramSize: "14B",   sizeMB: 9000,  tag: "reasoning", icon: "🔍",
    ramGb: 12, contextK: 16,  languages: ["en"],                       quantization: "Q4_K_M", family: "phi4",
  },
  {
    name: "mistral:7b",          label: "Mistral 7B",         desc: "Mistral AI — fast, strong reasoning",
    paramSize: "7B",    sizeMB: 4100,  tag: "reasoning", icon: "🔍",
    ramGb: 8,  contextK: 32,  languages: ["en", "fr", "de", "it", "es", "pt"], quantization: "Q4_K_M", family: "mistral",
  },
  // Coding
  {
    name: "qwen2.5-coder:1.5b",  label: "Qwen 2.5 Coder 1.5B", desc: "Specialized for code generation",
    paramSize: "1.5B",  sizeMB: 1000,  tag: "coding",    icon: "💻",
    ramGb: 2,  contextK: 32,  languages: ["en", "zh"],                 quantization: "Q4_K_M", family: "qwen2",
  },
  {
    name: "qwen2.5-coder:7b",    label: "Qwen 2.5 Coder 7B",   desc: "Best small coding model",
    paramSize: "7B",    sizeMB: 4700,  tag: "coding",    icon: "💻",
    ramGb: 8,  contextK: 32,  languages: ["en", "zh"],                 quantization: "Q4_K_M", family: "qwen2",
  },
  {
    name: "codellama:7b",        label: "Code Llama 7B",      desc: "Meta Code Llama for programming",
    paramSize: "7B",    sizeMB: 3800,  tag: "coding",    icon: "💻",
    ramGb: 8,  contextK: 16,  languages: ["en"],                       quantization: "Q4_K_M", family: "llama",
  },
  {
    name: "starcoder2:3b",       label: "StarCoder 2 3B",     desc: "Multi-language code generation",
    paramSize: "3B",    sizeMB: 1700,  tag: "coding",    icon: "💻",
    ramGb: 4,  contextK: 16,  languages: ["en"],                       quantization: "Q4_K_M", family: "starcoder2",
  },
  // Multilingual
  {
    name: "aya:8b",              label: "Aya 8B",             desc: "Cohere Aya — multilingual (101 langs)",
    paramSize: "8B",    sizeMB: 4800,  tag: "multilang", icon: "🌍",
    ramGb: 8,  contextK: 8,   languages: ["en","fr","de","es","pt","ar","zh","hi","ja","ko","ru","tr"], quantization: "Q4_K_M", family: "aya",
  },
  {
    name: "qwen2.5:7b",          label: "Qwen 2.5 7B",        desc: "Strong multilingual + reasoning",
    paramSize: "7B",    sizeMB: 4700,  tag: "multilang", icon: "🌍",
    ramGb: 8,  contextK: 32,  languages: ["en", "zh", "ar", "fr", "de", "es", "ja", "ko"], quantization: "Q4_K_M", family: "qwen2",
  },
];

// ─── Cloud models (not Ollama — served via external APIs) ─────────────────────
export interface CloudModelEntry {
  name: string; label: string; desc: string; paramSize: string;
  tag: string; icon: string; provider: "kimi" | "puter";
  contextK: number; languages: string[];
  endpoint?: string;
}

export const CLOUD_MODELS: CloudModelEntry[] = [
  {
    name: "kimi/kimi-k2-instruct",
    label: "Kimi K2 Instruct",
    desc: "MoonshotAI — 1T param MoE, top reasoning & agentic tasks. Runs via HuggingFace Router.",
    paramSize: "1T (32B active)",
    tag: "reasoning",
    icon: "🌙",
    provider: "kimi",
    contextK: 128,
    languages: ["en", "zh", "ja", "ko", "de", "fr", "es", "ar"],
    endpoint: "/api/kimi/chat/stream",
  },
  {
    name: "kimi/kimi-k2-0711-preview",
    label: "Kimi K2 Preview",
    desc: "MoonshotAI official — kimi-k2-0711-preview via Moonshot API (needs MOONSHOT_API_KEY).",
    paramSize: "1T (32B active)",
    tag: "reasoning",
    icon: "🌙",
    provider: "kimi",
    contextK: 128,
    languages: ["en", "zh", "ja", "ko", "de", "fr", "es", "ar"],
    endpoint: "/api/kimi/chat/stream",
  },
];

// ─── Storage endpoints ─────────────────────────────────────────────────────────

function getDiskStats(): { usedBytes: number; freeBytes: number; totalBytes: number } {
  try {
    const modelPath = process.env.OLLAMA_MODELS || "/home/runner/workspace/.ollama-models";
    const out = execSync(`df -B1 "${modelPath}" --output=used,avail,size 2>/dev/null | tail -1`, { encoding: "utf8" }).trim();
    const parts = out.split(/\s+/);
    if (parts.length >= 3) {
      return {
        usedBytes:  Number(parts[0]),
        freeBytes:  Number(parts[1]),
        totalBytes: Number(parts[2]),
      };
    }
  } catch { /* ignore */ }
  return { usedBytes: 0, freeBytes: 0, totalBytes: 0 };
}

function getSystemRamGb(): number {
  try {
    const out = execSync("free -b 2>/dev/null | awk '/^Mem:/ {print $2}'", { encoding: "utf8" }).trim();
    return Math.round(Number(out) / (1024 ** 3));
  } catch {
    return 0;
  }
}

/** GET /api/models/storage — no key required (read-only) */
router.get("/models/storage", (_req, res) => {
  const config = loadStorageConfig();
  const disk   = getDiskStats();
  const ramGb  = getSystemRamGb();
  const currentPath = process.env.OLLAMA_MODELS || config.path || "~/.ollama/models (default)";
  res.json({ path: currentPath, disk, systemRamGb: ramGb });
});

/** POST /api/models/storage */
router.post("/models/storage", async (req: Request, res: Response) => {
  const { path: storagePath } = req.body as { path?: string };
  if (!storagePath || typeof storagePath !== "string" || !storagePath.trim()) {
    res.status(400).json({ code: "BAD_INPUT", message: "path is required", hint: "Provide an absolute directory path." });
    return;
  }

  const cleanPath = storagePath.trim();

  // Validate path is absolute and doesn't contain shell metacharacters
  if (!cleanPath.startsWith("/")) {
    res.status(400).json({ code: "BAD_INPUT", message: "path must be absolute", hint: "Provide an absolute path starting with / (e.g. /home/user/.ollama_models)." });
    return;
  }
  if (/[;&|`$(){}[\]\n\r]/.test(cleanPath)) {
    res.status(400).json({ code: "BAD_INPUT", message: "path contains invalid characters", hint: "Only alphanumeric, dash, underscore, dot, and slash characters are allowed." });
    return;
  }

  // Validate path is writable using safe filesystem APIs (no shell)
  try {
    mkdirSync(cleanPath, { recursive: true });
    const testFile = cleanPath + "/.write-test";
    writeFileSync(testFile, "", "utf8");
    unlinkSync(testFile);
  } catch (fsErr) {
    res.status(400).json({
      code: "NOT_WRITABLE",
      message: `Path "${cleanPath}" is not writable`,
      hint: "Make sure the directory exists and this process has write permission.",
    });
    return;
  }

  // Persist to config file
  try {
    writeFileSync(STORAGE_CONFIG_FILE, JSON.stringify({ path: cleanPath }, null, 2), "utf8");
  } catch (writeErr) {
    res.status(500).json({ code: "UNKNOWN", message: `Failed to save config: ${String(writeErr)}`, hint: "Check workspace write permissions." });
    return;
  }

  // Restart Ollama with new path
  try {
    await restartOllamaServer(cleanPath);
    res.json({ ok: true, path: cleanPath, message: "Ollama restarted with new storage path." });
  } catch (err) {
    res.status(500).json(errorBody(err));
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/models/list — Full installed models list */
router.get("/models/list", async (_req, res) => {
  try {
    const models = await listOllamaModels();

    const enriched = models.map((m) => {
      const cat = MODEL_CATALOGUE.find(
        (c) => c.name === m.name || m.name.startsWith(c.name.split(":")[0])
      );
      return {
        ...m,
        label:       cat?.label       || m.name,
        description: cat?.desc        || "Custom model",
        tag:         cat?.tag         || "custom",
        icon:        cat?.icon        || "🤖",
        inCatalogue: !!cat,
        sizeMB:      Math.round(m.size / (1024 * 1024)),
        ramGb:       cat?.ramGb       ?? null,
        contextK:    cat?.contextK    ?? null,
        languages:   cat?.languages   ?? [],
        family:      cat?.family      || m.family,
      };
    });
    res.json({ models: enriched, count: enriched.length });
  } catch (err) {
    res.status(500).json(errorBody(err));
  }
});

/** GET /api/ollama-models — Alias used by Training Hub */
router.get("/ollama-models", async (_req, res) => {
  try {
    const models = await listOllamaModels();
    res.json(models.map((m) => ({
      ...m,
      sizeMB: Math.round(m.size / (1024 * 1024)),
    })));
  } catch (err) {
    res.status(500).json(errorBody(err));
  }
});

/** GET /api/ollama/models — Alias: same as /api/ollama-models */
router.get("/ollama/models", async (_req, res) => {
  try {
    const models = await listOllamaModels();
    res.json({ models: models.map((m) => ({ ...m, sizeMB: Math.round(m.size / (1024 * 1024)) })) });
  } catch (err) {
    res.status(500).json(errorBody(err));
  }
});

/** GET /api/ollama/status — Ollama health + installed models summary */
router.get("/ollama/status", async (_req, res) => {
  try {
    const models = await listOllamaModels();
    res.json({
      online: true,
      modelCount: models.length,
      models: models.map((m) => ({ name: m.name, sizeMB: Math.round(m.size / (1024 * 1024)) })),
    });
  } catch (err) {
    res.json({ online: false, modelCount: 0, models: [], error: String(err) });
  }
});

/** GET /api/admin/api-keys — Admin alias for /api/keys */
router.get("/admin/api-keys", async (req, res) => {
  res.redirect(307, "/api/keys");
});

/** GET /api/models/catalogue — Return curated model catalogue grouped by category */
router.get("/models/catalogue", async (_req, res) => {
  try {
    const installed    = await listOllamaModels();
    const installedNames = installed.map((m) => m.name);

    const withStatus = MODEL_CATALOGUE.map((m) => ({
      ...m,
      installed: installedNames.some(
        (n) => n === m.name || n.startsWith(m.name.split(":")[0])
      ),
    }));

    const categories = [
      { id: "fast",      label: "Ultrafast",   desc: "Lightweight — chat on any device" },
      { id: "smart",     label: "Smart",       desc: "Balanced speed and quality" },
      { id: "reasoning", label: "Reasoning",   desc: "Chain-of-thought and logic" },
      { id: "coding",    label: "Coding",      desc: "Code generation and completion" },
      { id: "multilang", label: "Multilingual",desc: "Multi-language support" },
    ];

    const grouped = categories.map((cat) => ({
      ...cat,
      models: withStatus.filter((m) => m.tag === cat.id),
    })).filter((g) => g.models.length > 0);

    res.json({ categories: grouped, models: withStatus });
  } catch (err) {
    res.status(500).json(errorBody(err));
  }
});

/** POST /api/models/pull — Pull a model via Ollama HTTP API (SSE streaming, no spawn) */
router.post("/models/pull", async (req: Request, res: Response) => {
  const { model } = req.body as { model?: string };
  if (!model || typeof model !== "string" || !model.trim()) {
    res.status(400).json({ code: "BAD_INPUT", message: "model name is required", hint: "Provide a valid Ollama model name." });
    return;
  }

  const modelName = model.trim();
  initSSE(res);
  sse(res, { type: "info", text: `Pulling ${modelName} via Ollama API…`, model: modelName });

  // 1. Verify Ollama is up
  try {
    const ver = await fetch("http://127.0.0.1:11434/api/version", {
      signal: AbortSignal.timeout(4000),
    });
    if (!ver.ok) throw new Error("not ok");
    sse(res, { type: "stdout", text: "Ollama is ready — starting download…" });
  } catch {
    sse(res, { type: "error", text: "Ollama server not reachable. Attempting restart…", code: "OFFLINE" });
    try {
      const { startOllamaServer } = await import("../ollama.js");
      await startOllamaServer();
      sse(res, { type: "stdout", text: "Ollama restarted — retrying pull…" });
    } catch (e2) {
      sse(res, { type: "error", text: `Cannot start Ollama: ${String(e2)}`, code: "OFFLINE", hint: "The Ollama process failed to start. Check server logs." });
      sse(res, { type: "done", success: false });
      if (!res.writableEnded) res.end();
      return;
    }
  }

  // 2. Stream pull from Ollama HTTP API
  try {
    const pullRes = await fetch("http://127.0.0.1:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal: AbortSignal.timeout(60 * 60 * 1000), // 60 min max
    });

    if (!pullRes.ok) {
      const errBody = await pullRes.text().catch(() => `HTTP ${pullRes.status}`);
      sse(res, { type: "error", text: `Ollama refused pull: ${errBody}`, code: "BAD_RESPONSE", hint: "Model name may be invalid. Check the Ollama model hub." });
      sse(res, { type: "done", success: false });
      if (!res.writableEnded) res.end();
      return;
    }

    if (!pullRes.body) {
      sse(res, { type: "error", text: "Empty response from Ollama", code: "BAD_RESPONSE", hint: "Ollama returned no response body." });
      sse(res, { type: "done", success: false });
      if (!res.writableEnded) res.end();
      return;
    }

    const reader = pullRes.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let lastStatus = "";
    let succeeded = false;

    while (true) {
      if (res.writableEnded) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const raw of lines) {
        if (res.writableEnded) break;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };
          if (json.error) {
            const errLow = json.error.toLowerCase();
            const isDisk = errLow.includes("space") || errLow.includes("enospc") || errLow.includes("disk") || errLow.includes("full");
            const code: OllamaErrorCode = isDisk ? "DISK_FULL" : "BAD_RESPONSE";
            const hint = isDisk
              ? "Disk is full — free up space or configure a custom storage path in Storage Settings."
              : "Pull failed. Check that the model name is correct.";
            sse(res, { type: "error", text: json.error, code, hint });
            continue;
          }
          lastStatus = json.status ?? lastStatus;

          if (json.status === "success") {
            succeeded = true;
          } else if (json.total && json.completed && json.completed > 0) {
            const pct = Math.min(99, Math.round((json.completed / json.total) * 100));
            const mb  = Math.round(json.completed / 1048576);
            const tot = Math.round(json.total     / 1048576);
            sse(res, {
              type: "progress",
              text: `${json.status || "downloading"}: ${pct}%  (${mb} MB / ${tot} MB)`,
              completed: json.completed,
              total: json.total,
              pct,
            });
          } else if (json.status) {
            sse(res, { type: "stdout", text: json.status });
          }
        } catch {
          if (trimmed) sse(res, { type: "stdout", text: trimmed });
        }
      }
    }

    if (!res.writableEnded) {
      if (succeeded || lastStatus === "success") {
        invalidateOllamaModelCache();
        sse(res, { type: "success", text: `✅ ${modelName} ready — use it in Chat, API, and Training Hub` });
        sse(res, { type: "done", success: true, model: modelName });
      } else {
        sse(res, {
          type: "error",
          text: `Pull ended unexpectedly (last status: "${lastStatus}"). If storage is full, configure a custom path in Storage Settings.`,
          code: "BAD_RESPONSE",
          hint: "If Replit storage is full, set a custom OLLAMA_MODELS path in Storage Settings.",
        });
        sse(res, { type: "done", success: false });
      }
    }
  } catch (err) {
    const msg  = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort");
    const isDiskFull = msg.toLowerCase().includes("enospc") || msg.toLowerCase().includes("no space");
    const code = isTimeout ? "TIMEOUT" : isDiskFull ? "DISK_FULL" : "UNKNOWN";
    const hint = isTimeout
      ? "Download timed out. Large models (>4GB) may need more time."
      : isDiskFull
      ? "Disk is full. Configure a custom storage path in Storage Settings."
      : "Download failed. Check connectivity and Ollama status.";
    sse(res, { type: "error", text: `Download error: ${msg}`, code, hint });
    sse(res, { type: "done", success: false });
  }

  if (!res.writableEnded) res.end();
});

/** POST /api/models/delete — Delete an installed model (body: { model }) */
router.post("/models/delete", async (req: Request, res: Response) => {
  const { model } = req.body as { model?: string };
  if (!model) {
    res.status(400).json({ code: "BAD_INPUT", message: "model name required", hint: "Provide the model name to delete." });
    return;
  }
  try {
    await deleteOllamaModel(model);
    res.json({ ok: true, deleted: model });
  } catch (err) {
    res.status(500).json(errorBody(err));
  }
});

/** GET /api/models/hf-search — Search HuggingFace model hub */
router.get("/models/hf-search", async (req: Request, res: Response) => {
  const { q = "", task = "text-generation", limit = "12" } = req.query as {
    q?: string;
    task?: string;
    limit?: string;
  };

  try {
    const models = await listHFModels({ task, limit: Number(limit), search: q || undefined });
    const ollamaCompatible = new Set(MODEL_CATALOGUE.map((m) => m.name.split(":")[0]));
    const enriched = models.map((m) => ({
      ...m,
      ollamaCompatible: ollamaCompatible.has(m.id.split("/")[1]?.toLowerCase() || ""),
    }));
    res.json({ models: enriched, query: q, task });
  } catch (err) {
    res.status(500).json(errorBody(err));
  }
});

/** POST /api/models/show — Show model info (body: { model }) */
router.post("/models/show", async (req: Request, res: Response) => {
  const { model } = req.body as { model?: string };
  if (!model) {
    res.status(400).json({ code: "BAD_INPUT", message: "model name required", hint: "Provide the model name." });
    return;
  }
  try {
    const info = await getOllamaModelInfo(model);
    res.json(info);
  } catch (err) {
    if (err instanceof OllamaError && err.code === "NOT_FOUND") {
      res.status(404).json(errorBody(err));
    } else {
      res.status(500).json(errorBody(err));
    }
  }
});

/** POST /api/models/benchmark — Run real benchmark on an installed model */
router.post("/models/benchmark", async (req: Request, res: Response) => {
  const { model } = req.body as { model?: string };
  if (!model) {
    res.status(400).json({ code: "BAD_INPUT", message: "model name required", hint: "Provide the model name." });
    return;
  }

  const OLLAMA_HOST_URL = "http://127.0.0.1:11434";
  const BENCHMARK_PROMPTS = [
    { id: "factual",   prompt: "What is the capital of France?",             expected: "Paris" },
    { id: "math",      prompt: "What is 17 multiplied by 13?",               expected: "221" },
    { id: "code",      prompt: "Write a Python function that adds two numbers.", expected: "def" },
    { id: "reasoning", prompt: "If all cats are animals, and Whiskers is a cat, is Whiskers an animal?", expected: "yes" },
    { id: "creative",  prompt: "Write a one-sentence description of an AI assistant.", expected: "" },
  ];

  const results: Array<{
    id: string; prompt: string; response: string; latencyMs: number;
    tokensPerSec: number | null; passed: boolean | null;
  }> = [];

  let totalLatency = 0;
  let totalTokens = 0;
  let passed = 0;

  for (const bp of BENCHMARK_PROMPTS) {
    const startMs = Date.now();
    try {
      const r = await fetch(`${OLLAMA_HOST_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: bp.prompt, stream: false, options: { temperature: 0, num_predict: 80 } }),
        signal: AbortSignal.timeout(30_000),
      });
      const latencyMs = Date.now() - startMs;

      if (!r.ok) {
        results.push({ id: bp.id, prompt: bp.prompt, response: `Error: HTTP ${r.status}`, latencyMs, tokensPerSec: null, passed: false });
        continue;
      }

      const data = await r.json() as {
        response?: string;
        eval_count?: number;
        eval_duration?: number;
      };
      const response = (data.response || "").trim();
      const evalCount = data.eval_count || 0;
      const evalDuration = data.eval_duration || 0;
      const tokensPerSec = evalDuration > 0 ? Math.round((evalCount / (evalDuration / 1e9)) * 10) / 10 : null;
      const testPassed = bp.expected ? response.toLowerCase().includes(bp.expected.toLowerCase()) : null;

      if (testPassed) passed++;
      totalLatency += latencyMs;
      totalTokens += evalCount;

      results.push({ id: bp.id, prompt: bp.prompt, response: response.slice(0, 300), latencyMs, tokensPerSec, passed: testPassed });
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      results.push({ id: bp.id, prompt: bp.prompt, response: `Error: ${String(err)}`, latencyMs, tokensPerSec: null, passed: false });
    }
  }

  const checkedResults = results.filter((r) => r.passed !== null);
  const accuracy = checkedResults.length > 0 ? Math.round((passed / checkedResults.length) * 100) : null;
  const avgLatency = results.length > 0 ? Math.round(totalLatency / results.length) : 0;

  res.json({
    model,
    prompts: BENCHMARK_PROMPTS.length,
    results,
    summary: {
      accuracy,
      avgLatencyMs: avgLatency,
      totalTokens,
      passed,
      failed: checkedResults.length - passed,
      grade:
        accuracy === null ? "N/A" :
        accuracy >= 80 ? "A" :
        accuracy >= 60 ? "B" :
        accuracy >= 40 ? "C" : "D",
    },
    ranAt: new Date().toISOString(),
  });
});

export default router;
