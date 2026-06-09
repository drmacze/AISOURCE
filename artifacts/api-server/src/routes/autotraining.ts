/**
 * DLavie OS — Auto-Training Control API
 * Endpoints to manage the 24/7 live learning system.
 */

import { Router, type IRouter } from "express";
import {
  runAutoTrainingCycle,
  startAutoTraining,
  stopAutoTraining,
  getAutoTrainingStatus,
  scrapeUrlForTraining,
} from "../autotraining";

const router: IRouter = Router();

/** GET /api/autotraining/status */
router.get("/autotraining/status", (_req, res) => {
  res.json(getAutoTrainingStatus());
});

/** GET /api/autotraining/sources — active data source stats */
router.get("/autotraining/sources", (_req, res) => {
  const status = getAutoTrainingStatus();
  res.json({
    sources: status.sources,
    stats: status.sourceStats,
    hfConnected: status.hfConnected,
    totalSamplesAdded: status.totalSamplesAdded,
  });
});

/** POST /api/autotraining/start — Start the scheduler */
router.post("/autotraining/start", (req, res) => {
  const intervalMinutes = Number(req.body?.intervalMinutes) || 180;
  startAutoTraining(intervalMinutes * 60 * 1000);
  res.json({ ok: true, message: `Auto-training started (every ${intervalMinutes} min)`, intervalMinutes });
});

/** POST /api/autotraining/stop — Stop the scheduler */
router.post("/autotraining/stop", (_req, res) => {
  stopAutoTraining();
  res.json({ ok: true, message: "Auto-training stopped" });
});

/** POST /api/autotraining/run — Trigger a full cycle immediately */
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

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  const result = await scrapeUrlForTraining(url, datasetId);
  res.json({ ok: result.success, ...result });
});

export default router;
