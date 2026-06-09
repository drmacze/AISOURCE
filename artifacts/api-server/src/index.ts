import "dotenv/config"; // loads .env from workspace root
import app from "./app";
import { logger } from "./lib/logger";
import { startOllamaServer } from "./ollama";
import { startAutoTraining, startMicroTraining } from "./autotraining";
import { isHFConfigured, HF_STATUS } from "./huggingface";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Start Ollama server in background for local LLM inference
startOllamaServer().catch((err) => {
  logger.warn({ err }, "Ollama server failed to start — HuggingFace fallback active");
});

// Log HuggingFace status
if (isHFConfigured()) {
  logger.info({ token: HF_STATUS.tokenPrefix() }, "HuggingFace connected — offline fallback enabled");
} else {
  logger.warn("HF_TOKEN not set — HuggingFace offline fallback disabled");
}

// Start 24/7 auto-training (full cycle every 3 hours by default)
const AUTO_TRAIN_INTERVAL_MS = Number(process.env.AUTO_TRAIN_INTERVAL_MS) || 3 * 60 * 60 * 1000;
startAutoTraining(AUTO_TRAIN_INTERVAL_MS);
logger.info({ intervalHours: AUTO_TRAIN_INTERVAL_MS / 3600000 }, "DLavie OS auto-training started (24/7 live learning)");

// Start per-minute micro-training (1 Wikipedia sample every 60 seconds)
const MICRO_TRAIN_INTERVAL_MS = Number(process.env.MICRO_TRAIN_INTERVAL_MS) || 60_000;
startMicroTraining(MICRO_TRAIN_INTERVAL_MS);
logger.info({ intervalSec: MICRO_TRAIN_INTERVAL_MS / 1000 }, "Micro-training started (1 sample/min)");

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "DLavie OS API Server listening");
});
