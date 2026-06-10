/**
 * DLavie OS — Web Search + Ollama Metrics
 *
 * GET  /api/search          — DuckDuckGo web search (free, no API key)
 * GET  /api/ollama/ps       — Running Ollama models (VRAM, tokens/sec)
 * GET  /api/ollama/version  — Ollama version info
 * GET  /api/ollama/metrics  — Combined Ollama metrics
 */

import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DDG_API = "https://api.duckduckgo.com/";

// ─── DuckDuckGo Web Search ────────────────────────────────────────────────────

interface DDGResult {
  title: string;
  url: string;
  snippet: string;
  source: "instant" | "related";
}

async function ddgSearch(query: string, maxResults = 8): Promise<DDGResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    skip_disambig: "1",
    no_redirect: "1",
  });

  const res = await fetch(`${DDG_API}?${params.toString()}`, {
    headers: { "User-Agent": "DLavie-OS/1.0 (research assistant)" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`);

  const data = await res.json() as {
    Abstract?: string;
    AbstractTitle?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    Answer?: string;
    AnswerType?: string;
    RelatedTopics?: Array<{
      Text?: string;
      FirstURL?: string;
      Topics?: Array<{ Text?: string; FirstURL?: string }>;
    }>;
    Results?: Array<{ Text?: string; FirstURL?: string }>;
    Definition?: string;
    DefinitionURL?: string;
  };

  const results: DDGResult[] = [];

  // Instant Answer (abstract / answer box)
  if (data.Answer?.trim()) {
    results.push({
      title: `Answer (${data.AnswerType || "instant"})`,
      url: "",
      snippet: data.Answer.trim(),
      source: "instant",
    });
  }

  if (data.Abstract?.trim()) {
    results.push({
      title: data.AbstractTitle || "Summary",
      url: data.AbstractURL || "",
      snippet: data.Abstract.trim(),
      source: "instant",
    });
  }

  if (data.Definition?.trim()) {
    results.push({
      title: "Definition",
      url: data.DefinitionURL || "",
      snippet: data.Definition.trim(),
      source: "instant",
    });
  }

  // Top web results
  for (const r of (data.Results || []).slice(0, 3)) {
    if (r.Text && r.FirstURL) {
      results.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: r.Text, source: "related" });
    }
  }

  // Related topics (flatten sub-topics too)
  for (const topic of (data.RelatedTopics || []).slice(0, 10)) {
    if (results.length >= maxResults) break;
    if (topic.Topics?.length) {
      for (const sub of topic.Topics.slice(0, 3)) {
        if (results.length >= maxResults) break;
        if (sub.Text && sub.FirstURL) {
          results.push({ title: sub.Text.slice(0, 80), url: sub.FirstURL, snippet: sub.Text, source: "related" });
        }
      }
    } else if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: topic.Text, source: "related" });
    }
  }

  return results.slice(0, maxResults);
}

/**
 * GET /api/search?q=query&max=8
 * Returns real DuckDuckGo search results.
 */
router.get("/search", async (req: Request, res: Response) => {
  const query = String(req.query.q || "").trim();
  const max = Math.min(parseInt(String(req.query.max || "8"), 10) || 8, 20);

  if (!query) {
    res.status(400).json({ error: "q parameter is required" });
    return;
  }

  try {
    const results = await ddgSearch(query, max);
    res.json({ query, results, count: results.length, via: "duckduckgo" });
  } catch (err) {
    res.status(502).json({ error: String(err), query });
  }
});

/**
 * POST /api/search  (body: { q, max? })
 */
router.post("/search", async (req: Request, res: Response) => {
  const { q = "", max = 8 } = req.body as { q?: string; max?: number };
  const query = String(q).trim();

  if (!query) {
    res.status(400).json({ error: "q is required" });
    return;
  }

  try {
    const results = await ddgSearch(query, Math.min(max, 20));
    res.json({ query, results, count: results.length, via: "duckduckgo" });
  } catch (err) {
    res.status(502).json({ error: String(err), query });
  }
});

// ─── Ollama Metrics ───────────────────────────────────────────────────────────

/** GET /api/ollama/ps — currently loaded models and their memory usage */
router.get("/ollama/ps", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/ps`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      res.status(r.status).json({ error: `Ollama returned ${r.status}` });
      return;
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: String(err), models: [] });
  }
});

/** GET /api/ollama/version — Ollama version */
router.get("/ollama/version", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/version`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      res.status(r.status).json({ error: `Ollama returned ${r.status}` });
      return;
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

/** GET /api/ollama/metrics — combined metrics: version + ps + tag count */
router.get("/ollama/metrics", async (_req: Request, res: Response) => {
  try {
    const [versionRes, psRes, tagsRes] = await Promise.allSettled([
      fetch(`${OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${OLLAMA_HOST}/api/ps`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) }),
    ]);

    const version = versionRes.status === "fulfilled" && versionRes.value.ok
      ? (await versionRes.value.json() as { version: string }).version
      : null;

    const psData = psRes.status === "fulfilled" && psRes.value.ok
      ? await psRes.value.json() as { models?: Array<{ name: string; size: number; size_vram: number; expires_at: string }> }
      : { models: [] };

    const tagsData = tagsRes.status === "fulfilled" && tagsRes.value.ok
      ? await tagsRes.value.json() as { models?: Array<{ name: string; size: number }> }
      : { models: [] };

    const loadedModels = (psData.models || []).map((m) => ({
      name: m.name,
      sizeMB: Math.round(m.size / 1024 / 1024),
      vramMB: Math.round((m.size_vram || 0) / 1024 / 1024),
      expiresAt: m.expires_at,
    }));

    const installedModels = tagsData.models || [];
    const totalSizeMB = installedModels.reduce((sum, m) => sum + (m.size || 0), 0) / 1024 / 1024;

    res.json({
      version,
      online: !!version,
      loadedModels,
      installedCount: installedModels.length,
      totalSizeMB: Math.round(totalSizeMB),
    });
  } catch (err) {
    res.status(502).json({ error: String(err), online: false });
  }
});

export { ddgSearch };
export default router;
