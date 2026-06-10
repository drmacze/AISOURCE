import { spawn, execSync } from "child_process";
import { Response } from "express";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
export const OLLAMA_PATH =
  process.env.OLLAMA_PATH ||
  "/nix/store/ijcpwmz3lxf11vjr47nvmfpp7v1a3hx7-ollama-0.9.5/bin/ollama";

export const STORAGE_CONFIG_FILE = join(process.cwd(), ".ollama-storage-config.json");

export function loadStorageConfig(): { path: string } {
  try {
    if (existsSync(STORAGE_CONFIG_FILE)) {
      const raw = readFileSync(STORAGE_CONFIG_FILE, "utf8");
      return JSON.parse(raw) as { path: string };
    }
  } catch {
    // Ignore; use default
  }
  return { path: process.env.OLLAMA_MODELS || "" };
}

// ─── Typed error class ─────────────────────────────────────────────────────────

export type OllamaErrorCode =
  | "OFFLINE"
  | "TIMEOUT"
  | "DISK_FULL"
  | "NOT_FOUND"
  | "BAD_RESPONSE"
  | "NO_MODELS"
  | "BAD_INPUT"
  | "UNKNOWN";

const ERROR_HINTS: Record<OllamaErrorCode, string> = {
  OFFLINE:      "Ollama is not running. The server should auto-start — wait a few seconds and retry.",
  TIMEOUT:      "Request timed out. Large models may need more time, or Ollama is under load.",
  DISK_FULL:    "Disk is full. Free up space or configure a custom storage path in Storage Settings.",
  NOT_FOUND:    "Model not found. Pull it from the Model Catalogue first.",
  BAD_RESPONSE: "Ollama returned an unexpected response. Try restarting the server.",
  NO_MODELS:    "No models are installed. Go to the Model Catalogue and download one (e.g. TinyLlama).",
  BAD_INPUT:    "The request parameters are invalid. Check the input and try again.",
  UNKNOWN:      "An unexpected error occurred with the Ollama engine.",
};

export class OllamaError extends Error {
  code: OllamaErrorCode;
  hint: string;

  constructor(code: OllamaErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "OllamaError";
    this.code  = code;
    this.hint  = hint ?? ERROR_HINTS[code];
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

function classifyFetchError(err: unknown): OllamaErrorCode {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("abort") || err.name === "AbortError") return "TIMEOUT";
    if (msg.includes("enospc") || msg.includes("disk") || msg.includes("no space")) return "DISK_FULL";
    if (msg.includes("econnrefused") || msg.includes("fetch failed") || msg.includes("network")) return "OFFLINE";
  }
  return "UNKNOWN";
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = classifyFetchError(err);
      if (code === "TIMEOUT" || code === "DISK_FULL") throw err; // No point retrying
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let ollamaServerStarted = false;
let ollamaPid: number | null = null;

function killStaleOllama() {
  try {
    execSync("pkill -f 'ollama serve'", { stdio: "ignore" });
    console.log("[Ollama] Killed stale zombie Ollama process");
    // Brief wait for OS to release ports
  } catch {
    // No stale process — ignore
  }
}

export async function startOllamaServer(): Promise<void> {
  if (ollamaServerStarted) return;

  // Check if already running and responsive
  try {
    const res = await fetch("http://127.0.0.1:11434/api/version", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      console.log("[Ollama] Server already running and responsive");
      ollamaServerStarted = true;
      return;
    }
  } catch {
    // Not running or unresponsive — check for zombie
    killStaleOllama();
    await new Promise((r) => setTimeout(r, 500));
  }

  // Load storage path from config file
  const storageConfig = loadStorageConfig();
  const extraEnv: Record<string, string> = {};
  if (storageConfig.path) {
    extraEnv.OLLAMA_MODELS = storageConfig.path;
    console.log(`[Ollama] Using custom model storage path: ${storageConfig.path}`);
  }

  console.log("[Ollama] Starting server…");
  const child = spawn(OLLAMA_PATH, ["serve"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...extraEnv,
      OLLAMA_ORIGINS: "*",
      OLLAMA_HOST: "127.0.0.1:11434",
      OLLAMA_CONTEXT_LENGTH: "4096",
      OLLAMA_KEEP_ALIVE: "10m0s",
      OLLAMA_MAX_LOADED_MODELS: "2",
      OLLAMA_NUM_PARALLEL: "1",
      OLLAMA_DEBUG: "INFO",
    },
  });
  if (child.pid) {
    ollamaPid = child.pid;
    console.log(`[Ollama] Spawned PID ${ollamaPid}`);
  }
  child.unref();

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch("http://127.0.0.1:11434/api/version", {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        console.log("[Ollama] Server ready!");
        ollamaServerStarted = true;
        return;
      }
    } catch {
      // Still starting
    }
  }
  throw new OllamaError("OFFLINE", "Ollama server failed to start within 60 seconds");
}

export async function restartOllamaServer(modelsPath?: string): Promise<void> {
  ollamaServerStarted = false;
  ollamaPid = null;

  killStaleOllama();
  await new Promise((r) => setTimeout(r, 800));

  if (modelsPath) {
    process.env.OLLAMA_MODELS = modelsPath;
  }

  await startOllamaServer();
}

// ─── Model resolution ─────────────────────────────────────────────────────────

async function resolveModel(model: string): Promise<string> {
  const installed = await listOllamaModels();
  if (!installed.length) {
    throw new OllamaError(
      "NO_MODELS",
      "No models are installed in Ollama",
      ERROR_HINTS.NO_MODELS
    );
  }
  const names = installed.map((m) => m.name);
  if (names.includes(model)) return model;
  const partial = names.find((n) => n.startsWith(model.split(":")[0]));
  if (partial) return partial;
  return names[0];
}

// ─── Generate (non-streaming) ──────────────────────────────────────────────────

export async function generateOllamaResponse(
  prompt: string,
  model: string = "tinyllama",
  ragContext?: string,
  systemPrompt?: string
): Promise<string> {
  const resolvedModel = await resolveModel(model);
  try {
    const sysPrompt = systemPrompt ||
      "You are NEXUS_OS, a powerful local AI assistant. Be helpful, accurate, and concise.";
    const fullPrompt = ragContext
      ? `${sysPrompt}\n\nRelevant knowledge base context:\n\n${ragContext}\n\n---\nUser: ${prompt}\nAssistant:`
      : `${sysPrompt}\n\nUser: ${prompt}\nAssistant:`;

    const response = await withRetry(() =>
      fetch(`${OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: resolvedModel,
          prompt: fullPrompt,
          stream: false,
          options: { temperature: 0.7, top_p: 0.9, num_predict: 512 },
        }),
      })
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new OllamaError("BAD_RESPONSE", `Ollama API error: ${response.status} — ${errText}`);
    }

    const data = (await response.json()) as { response: string };
    return data.response || "I received an empty response from the AI model.";
  } catch (error) {
    console.error("Ollama error:", error);
    if (error instanceof OllamaError) throw error;
    throw new OllamaError(classifyFetchError(error), error instanceof Error ? error.message : "Unknown error");
  }
}

export async function isOllamaOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Streaming response ────────────────────────────────────────────────────────

export async function streamOllamaResponse(
  prompt: string,
  model: string = "tinyllama",
  ragContext: string | undefined,
  res: Response
): Promise<void> {
  let resolvedModel: string;
  try {
    resolvedModel = await resolveModel(model);
  } catch (err) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const code = err instanceof OllamaError ? err.code : classifyFetchError(err);
    const hint = err instanceof OllamaError ? err.hint : ERROR_HINTS[code];
    const message = err instanceof OllamaError ? err.message : (err instanceof Error ? err.message : "Unknown error");
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ error: { code, message, hint }, done: true, errorCode: code, hint })}\n\n`);
    if (!res.writableEnded) res.end();
    return;
  }

  model = resolvedModel;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function safeWrite(payload: object) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  }

  const sysPromptStream = "You are NEXUS_OS, a powerful local AI assistant. Be helpful, accurate, and concise.";
  const fullPrompt = ragContext
    ? `${sysPromptStream}\n\nRelevant knowledge base context:\n\n${ragContext}\n\n---\nUser: ${prompt}\nAssistant:`
    : `${sysPromptStream}\n\nUser: ${prompt}\nAssistant:`;

  const ollamaOnline = await isOllamaOnline();
  if (!ollamaOnline) {
    try {
      const { streamHFResponse, isHFConfigured } = await import("./huggingface");
      if (isHFConfigured()) {
        console.log("[DLavie OS] Ollama offline — streaming via HuggingFace");
        let fullHFText = "";
        for await (const token of streamHFResponse(fullPrompt, "mistralai/Mistral-7B-Instruct-v0.3", { maxTokens: 512 })) {
          fullHFText += token;
          safeWrite({ token, done: false, source: "huggingface" });
        }
        safeWrite({ token: "", done: true, fullText: fullHFText, source: "huggingface" });
        if (!res.writableEnded) res.end();
        return;
      }
    } catch (hfErr) {
      console.warn("[DLavie OS] HF stream fallback failed:", hfErr);
    }
    const fallback = await generateFallbackResponse(prompt);
    safeWrite({ token: fallback, done: true, fullText: fallback });
    if (!res.writableEnded) res.end();
    return;
  }

  try {
    const response = await withRetry(() =>
      fetch(`${OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: fullPrompt,
          stream: true,
          options: { temperature: 0.7, top_p: 0.9, num_predict: 512 },
        }),
      })
    );

    if (!response.ok || !response.body) {
      const err = await response.text().catch(() => "unknown error");
      const code = response.status === 404 ? "NOT_FOUND" : "BAD_RESPONSE";
      safeWrite({ error: `Model error: ${err}`, code });
      if (!res.writableEnded) res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      if (res.writableEnded) break;
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { response?: string; done?: boolean };
          if (parsed.response) {
            fullText += parsed.response;
            safeWrite({ token: parsed.response, done: false });
          }
          if (parsed.done) {
            safeWrite({ token: "", done: true, fullText });
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
    if (!res.writableEnded) res.end();
  } catch (error) {
    console.error("Streaming error:", error);
    const code = error instanceof OllamaError ? error.code : classifyFetchError(error);
    const hint = error instanceof OllamaError ? error.hint : ERROR_HINTS[code];
    const message = error instanceof OllamaError ? error.message : (error instanceof Error ? error.message : "Unknown error");
    safeWrite({ error: { code, message, hint }, done: true, errorCode: code, hint });
    if (!res.writableEnded) res.end();
  }
}

// ─── Fallback ──────────────────────────────────────────────────────────────────

async function generateFallbackResponse(input: string): Promise<string> {
  try {
    const { generateHFResponse, isHFConfigured } = await import("./huggingface");
    if (isHFConfigured()) {
      console.log("[DLavie OS] Ollama offline — falling back to HuggingFace Inference API");
      return await generateHFResponse(input, "mistralai/Mistral-7B-Instruct-v0.3", { maxTokens: 512 });
    }
  } catch (hfErr) {
    console.warn("[DLavie OS] HuggingFace fallback failed:", hfErr);
  }
  const lower = input.toLowerCase();
  if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
    return "Hello! I'm DLavie OS — your AI assistant. Local model is warming up, try again shortly.";
  }
  if (lower.includes("help")) {
    return "I can help with chat, document search (RAG), training data, and model management. My local Ollama models are starting up — try again in a moment.";
  }
  return "DLavie OS is online. Local AI model is warming up. You can also use HuggingFace-powered inference while Ollama loads.";
}

// ─── Pull model ────────────────────────────────────────────────────────────────

export async function pullOllamaModel(model: string): Promise<AsyncIterable<string>> {
  const response = await withRetry(() =>
    fetch(`${OLLAMA_HOST}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(600000),
    })
  );

  if (!response.ok || !response.body) {
    throw new OllamaError("BAD_RESPONSE", `Ollama pull error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined as unknown as string };
          return { done: false, value: decoder.decode(value, { stream: true }) };
        },
      };
    },
  };
}

// ─── List models ───────────────────────────────────────────────────────────────

export async function listOllamaModels(): Promise<
  Array<{
    name: string;
    size: number;
    modified: string;
    parameterSize: string;
    quantization: string;
    family: string;
  }>
> {
  try {
    const response = await withRetry(() => fetch(`${OLLAMA_HOST}/api/tags`));
    if (!response.ok) {
      throw new OllamaError(
        "BAD_RESPONSE",
        `Ollama /api/tags returned ${response.status}`,
        `Ollama responded with HTTP ${response.status}. Try restarting the server.`
      );
    }
    const data = (await response.json()) as {
      models?: Array<{
        name: string;
        size: number;
        modified_at: string;
        details?: {
          parameter_size?: string;
          quantization_level?: string;
          family?: string;
        };
      }>;
    };
    return (data.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
      parameterSize: m.details?.parameter_size || "unknown",
      quantization: m.details?.quantization_level || "unknown",
      family: m.details?.family || "unknown",
    }));
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    const code = classifyFetchError(err);
    throw new OllamaError(code, `Failed to list Ollama models: ${String(err)}`);
  }
}

// ─── Delete model ──────────────────────────────────────────────────────────────

export async function deleteOllamaModel(model: string): Promise<void> {
  const response = await withRetry(() =>
    fetch(`${OLLAMA_HOST}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
    })
  );
  if (!response.ok) {
    const status = response.status;
    const code: OllamaErrorCode = status === 404 ? "NOT_FOUND" : "BAD_RESPONSE";
    throw new OllamaError(code, `Failed to delete model "${model}": HTTP ${status}`);
  }
}

// ─── Create modelfile ─────────────────────────────────────────────────────────

export async function createOllamaModelfile(
  modelName: string,
  baseModel: string,
  systemPrompt: string,
  trainingSamples: Array<{ input: string; output: string }>
): Promise<void> {
  if (systemPrompt.length > 8192) {
    throw new OllamaError(
      "BAD_INPUT",
      `System prompt exceeds 8 192 characters (got ${systemPrompt.length})`,
      "Shorten your system prompt to 8 192 characters or fewer."
    );
  }

  const examples = trainingSamples
    .slice(0, 20)
    .map((s) => `User: ${s.input}\nAssistant: ${s.output}`)
    .join("\n\n");

  const fullSystemPrompt = `${systemPrompt}\n\nTraining examples for context:\n${examples}`;

  const installed = await listOllamaModels();
  const installedNames = installed.map((m) => m.name);
  const resolvedBase =
    installedNames.find((n) => n.startsWith(baseModel.split(":")[0])) ||
    installedNames[0] ||
    "tinyllama:latest";

  const newApiBody = {
    model: modelName,
    from: resolvedBase,
    system: fullSystemPrompt,
    parameters: { temperature: 0.7, top_p: 0.9, num_predict: 512 },
    stream: false,
  };

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newApiBody),
      signal: AbortSignal.timeout(300000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new OllamaError("BAD_RESPONSE", `Failed to create model: ${err}`);
    }

    console.log(`✅ Created Ollama custom model: ${modelName} (based on ${resolvedBase})`);
  } catch (error) {
    if (error instanceof OllamaError) throw error;
    console.error("Model creation error:", error);
    throw new OllamaError("UNKNOWN", `Model creation failed: ${String(error)}`);
  }
}

// ─── Show model info ───────────────────────────────────────────────────────────

export async function getOllamaModelInfo(model: string): Promise<{
  parameters: string;
  template: string;
  system: string;
} | null> {
  try {
    const response = await withRetry(() =>
      fetch(`${OLLAMA_HOST}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model }),
      })
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw new OllamaError("NOT_FOUND", `Model "${model}" is not installed`);
      }
      throw new OllamaError("BAD_RESPONSE", `Ollama /api/show returned ${response.status}`);
    }
    return (await response.json()) as { parameters: string; template: string; system: string };
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    const code = classifyFetchError(err);
    throw new OllamaError(code, `Failed to get model info: ${String(err)}`);
  }
}
