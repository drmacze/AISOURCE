/**
 * DLavie OS — Auto-Training Control API v2
 * Endpoints to manage and inspect the 24/7 live learning system.
 */

import { Router, type IRouter } from "express";
import {
  runAutoTrainingCycle,
  startAutoTraining,
  stopAutoTraining,
  getAutoTrainingStatus,
  scrapeUrlForTraining,
  registerSSEClient,
  unregisterSSEClient,
  allocateClientId,
  getAutoTrainingConfig,
  updateAutoTrainingConfig,
  type TrainingEvent,
} from "../autotraining.js";
import { checkGitHubRateLimit, isGitHubConfigured } from "../github-datasets.js";
import { db } from "@workspace/db";
import { trainingSamplesTable, trainingDatasetsTable } from "@workspace/db";
import { count, desc } from "drizzle-orm";

const router: IRouter = Router();

/** GET /api/autotraining/status — Full engine status */
router.get("/autotraining/status", (_req, res) => {
  res.json(getAutoTrainingStatus());
});

/** GET /api/autotraining/sources — Per-source stats */
router.get("/autotraining/sources", (_req, res) => {
  const status = getAutoTrainingStatus();
  res.json({
    sources: status.sources,
    stats: status.sourceStats,
    hfConnected: status.hfConnected,
    githubConnected: status.githubConnected,
    githubToken: status.githubToken,
    totalSamplesAdded: status.totalSamplesAdded,
    deduplication: {
      active: status.deduplicationActive,
      cacheSize: status.totalDedupCacheSize,
    },
    languages: status.languages,
  });
});

/** GET /api/autotraining/github-status — GitHub token and rate limit */
router.get("/autotraining/github-status", async (_req, res) => {
  const rateLimit = await checkGitHubRateLimit();
  res.json({
    configured: isGitHubConfigured(),
    tokenPrefix: process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN.slice(0, 8) + "..." : null,
    rateLimit,
    features: [
      "Trending repos with README (5000 repos/hr)",
      "Real dataset files (JSONL/CSV/JSON)",
      "GitHub issue Q&A discussions",
      "Code examples and tutorials",
      "Dataset repo search by tag",
    ],
  });
});

/** GET /api/autotraining/dataset-stats — DB training data stats */
router.get("/autotraining/dataset-stats", async (_req, res) => {
  try {
    const [totalSamples] = await db.select({ c: count() }).from(trainingSamplesTable);
    const datasets = await db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.updatedAt)).limit(5);

    // Source breakdown from metadata
    const samples = await db.select({ metadata: trainingSamplesTable.metadata }).from(trainingSamplesTable).limit(5000);
    const sourceBreakdown: Record<string, number> = {};
    for (const s of samples) {
      try {
        const meta = JSON.parse(s.metadata || "{}") as { source?: string };
        const src = meta.source || "unknown";
        sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
      } catch { /* skip */ }
    }

    res.json({
      totalSamples: totalSamples.c,
      datasets: datasets.map((d) => ({
        id: d.id,
        name: d.name,
        sampleCount: d.sampleCount,
        updatedAt: d.updatedAt,
      })),
      sourceBreakdown,
    });
  } catch (err) {
    res.status(500).json({ error: "DatabaseError", message: String(err) });
  }
});

/** POST /api/autotraining/start */
router.post("/autotraining/start", (req, res) => {
  const intervalMinutes = Number(req.body?.intervalMinutes) || 180;
  startAutoTraining(intervalMinutes * 60 * 1000);
  res.json({
    ok: true,
    message: `Auto-training v2 started (every ${intervalMinutes} min, 12+ sources, multilingual)`,
    intervalMinutes,
    sources: 12,
    languages: ["en", "id", "ar", "fr", "es"],
  });
});

/** POST /api/autotraining/stop */
router.post("/autotraining/stop", (_req, res) => {
  stopAutoTraining();
  res.json({ ok: true, message: "Auto-training stopped" });
});

/** POST /api/autotraining/run — Trigger full cycle immediately */
router.post("/autotraining/run", async (_req, res) => {
  const result = await runAutoTrainingCycle();
  res.json({ ok: result.success, ...result });
});

/** POST /api/autotraining/scrape-url — Scrape a URL and add to training data */
router.post("/autotraining/scrape-url", async (req, res) => {
  const { url, datasetId } = req.body as { url?: string; datasetId?: number };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  const result = await scrapeUrlForTraining(url, datasetId);
  res.json({ ok: result.success, ...result });
});

/** GET /api/autotraining/events — SSE stream of real-time training events */
router.get("/autotraining/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const clientId = allocateClientId();

  const send = (event: TrainingEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const close = () => {
    unregisterSSEClient(clientId);
    res.end();
  };

  registerSSEClient({ id: clientId, send, close });

  // Send initial heartbeat so client knows the connection is live
  send({ type: "heartbeat", at: new Date().toISOString() });

  // Keep-alive heartbeat every 30s
  const heartbeat = setInterval(() => {
    try { send({ type: "heartbeat", at: new Date().toISOString() }); }
    catch { clearInterval(heartbeat); unregisterSSEClient(clientId); }
  }, 30_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unregisterSSEClient(clientId);
  });
});

/** GET /api/autotraining/activity — Latest activity log */
router.get("/autotraining/activity", (_req, res) => {
  const status = getAutoTrainingStatus();
  res.json({
    log: status.activityLog,
    currentCycle: status.currentCycleLog,
    running: status.currentlyCycling,
  });
});

/** GET /api/autotraining/config — Get current engine config */
router.get("/autotraining/config", (_req, res) => {
  res.json(getAutoTrainingConfig());
});

/** POST /api/autotraining/config — Update engine config */
router.post("/autotraining/config", (req, res) => {
  const { intervalMinutes, microIntervalSeconds, sourceEnabled, autoTrigger } = req.body as {
    intervalMinutes?: number;
    microIntervalSeconds?: number;
    sourceEnabled?: Record<string, boolean>;
    autoTrigger?: { enabled?: boolean; threshold?: number };
  };
  updateAutoTrainingConfig({ intervalMinutes, microIntervalSeconds, sourceEnabled, autoTrigger });
  res.json({ ok: true, config: getAutoTrainingConfig() });
});

/** POST /api/autotraining/toggle-source — Toggle one source on/off */
router.post("/autotraining/toggle-source", (req, res) => {
  const { source, enabled } = req.body as { source?: string; enabled?: boolean };
  if (!source || typeof enabled !== "boolean") {
    res.status(400).json({ error: "source (string) and enabled (boolean) required" });
    return;
  }
  updateAutoTrainingConfig({ sourceEnabled: { [source]: enabled } });
  res.json({ ok: true, source, enabled, config: getAutoTrainingConfig() });
});

export default router;
