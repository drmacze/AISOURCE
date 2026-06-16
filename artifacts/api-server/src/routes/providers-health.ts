/**
 * DLavie OS — Real-time Provider Health Check
 *
 * GET /healthz/providers
 *   Probes each AI provider in parallel and returns live status.
 *   No auth required — used by dashboard and deployment monitors.
 */

import { Router, type Request, type Response } from "express";
import { isGroqConfigured, getGroqKey } from "../groq.js";
import { isOpenRouterConfigured, getOpenRouterKey } from "../openrouter.js";
import { isHFConfigured, HF_STATUS, probeHFToken } from "../huggingface.js";
import { isOllamaOnline } from "../ollama.js";

const router = Router();

interface ProviderStatus {
  name: string;
  configured: boolean;
  online: boolean;
  latencyMs: number | null;
  model: string | null;
  error: string | null;
}

async function probeGroq(): Promise<ProviderStatus> {
  const configured = isGroqConfigured();
  if (!configured) {
    return { name: "groq", configured: false, online: false, latencyMs: null, model: null, error: "GROQ_API_KEY not set" };
  }
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${getGroqKey()}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const msg = `HTTP ${res.status}`;
      return { name: "groq", configured: true, online: false, latencyMs, model: null, error: msg };
    }
    const data = await res.json() as { data?: Array<{ id: string }> };
    const firstModel = data?.data?.[0]?.id ?? "llama-3.3-70b-versatile";
    return { name: "groq", configured: true, online: true, latencyMs, model: firstModel, error: null };
  } catch (e) {
    return {
      name: "groq", configured: true, online: false,
      latencyMs: Date.now() - t0, model: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeOpenRouter(): Promise<ProviderStatus> {
  const configured = isOpenRouterConfigured();
  if (!configured) {
    return { name: "openrouter", configured: false, online: false, latencyMs: null, model: null, error: "OPENROUTER_API_KEY not set" };
  }
  const t0 = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models?limit=1", {
      headers: {
        Authorization: `Bearer ${getOpenRouterKey()}`,
        "HTTP-Referer": "https://dlavie.ai",
      },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { name: "openrouter", configured: true, online: false, latencyMs, model: null, error: `HTTP ${res.status}` };
    }
    const data = await res.json() as { data?: Array<{ id: string }> };
    const firstModel = data?.data?.[0]?.id ?? "openrouter/auto";
    return { name: "openrouter", configured: true, online: true, latencyMs, model: firstModel, error: null };
  } catch (e) {
    return {
      name: "openrouter", configured: true, online: false,
      latencyMs: Date.now() - t0, model: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeHuggingFace(): Promise<ProviderStatus> {
  const configured = isHFConfigured();
  if (!configured) {
    return { name: "huggingface", configured: false, online: false, latencyMs: null, model: null, error: "HF_TOKEN not set" };
  }
  const t0 = Date.now();
  try {
    const valid = await probeHFToken();
    const latencyMs = Date.now() - t0;
    return {
      name: "huggingface",
      configured: true,
      online: valid,
      latencyMs,
      model: valid ? "Qwen/Qwen2.5-Coder-32B-Instruct" : null,
      error: valid ? null : "Token invalid or HF inference not available",
    };
  } catch (e) {
    return {
      name: "huggingface", configured: true, online: false,
      latencyMs: Date.now() - t0, model: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeOllama(): Promise<ProviderStatus> {
  const t0 = Date.now();
  try {
    const online = await isOllamaOnline();
    const latencyMs = Date.now() - t0;

    if (!online) {
      return { name: "ollama", configured: true, online: false, latencyMs, model: null, error: "Ollama server not responding" };
    }

    const modelsRes = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    const modelsData = await modelsRes.json() as { models?: Array<{ name: string }> };
    const firstModel = modelsData?.models?.[0]?.name ?? null;

    return { name: "ollama", configured: true, online: true, latencyMs, model: firstModel, error: null };
  } catch (e) {
    return {
      name: "ollama", configured: true, online: false,
      latencyMs: Date.now() - t0, model: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

router.get("/healthz/providers", async (_req: Request, res: Response) => {
  const startedAt = Date.now();

  const [groq, openrouter, huggingface, ollama] = await Promise.all([
    probeGroq(),
    probeOpenRouter(),
    probeHuggingFace(),
    probeOllama(),
  ]);

  const providers: ProviderStatus[] = [groq, openrouter, huggingface, ollama];
  const onlineCount = providers.filter((p) => p.online).length;
  const activeProvider = providers.find((p) => p.online) ?? null;

  res.json({
    status: onlineCount > 0 ? "ok" : "degraded",
    checkedAt: new Date().toISOString(),
    totalMs: Date.now() - startedAt,
    summary: {
      total: providers.length,
      online: onlineCount,
      offline: providers.length - onlineCount,
      activeProvider: activeProvider?.name ?? null,
      activeModel: activeProvider?.model ?? null,
    },
    providers,
  });
});

export default router;
