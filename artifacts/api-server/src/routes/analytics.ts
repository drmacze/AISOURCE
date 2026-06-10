/**
 * DLavie OS — Analytics API
 *
 * Real analytics from the PostgreSQL database — no simulated data.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable, messagesTable, documentsTable,
  trainingSamplesTable, trainingJobsTable, aiModelsTable,
} from "@workspace/db";
import { count, sql, desc } from "drizzle-orm";
import { listOllamaModels, isOllamaOnline } from "../ollama";
import { isHFConfigured } from "../huggingface";
import { getAutoTrainingStatus } from "../autotraining";

const router: IRouter = Router();

/** Extract rows array from Drizzle/pg QueryResult or plain array */
function rows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r.rows || [];
}

// ─── GET /api/analytics/overview ─────────────────────────────────────────────
router.get("/analytics/overview", async (_req, res) => {
  const [convs, msgs, docs, samples, jobs, models] = await Promise.all([
    db.select({ c: count() }).from(conversationsTable),
    db.select({ c: count() }).from(messagesTable),
    db.select({ c: count() }).from(documentsTable),
    db.select({ c: count() }).from(trainingSamplesTable),
    db.select({ c: count() }).from(trainingJobsTable),
    db.select({ c: count() }).from(aiModelsTable),
  ]);

  let embeddedDocs = 0;
  let totalTokens = 0;
  try {
    const r1 = rows<{ n: number }>(await db.execute(sql`SELECT COUNT(*)::int AS n FROM documents WHERE embedding IS NOT NULL`));
    embeddedDocs = r1[0]?.n ?? 0;
    const r2 = rows<{ t: string }>(await db.execute(sql`SELECT COALESCE(SUM(tokens), 0)::bigint AS t FROM messages`));
    totalTokens = Number(r2[0]?.t ?? 0);
  } catch { /* ignore */ }

  const autoStatus = getAutoTrainingStatus();
  const ollamaModels = await listOllamaModels().catch(() => []);

  res.json({
    conversations:    convs[0]?.c ?? 0,
    messages:         msgs[0]?.c ?? 0,
    documents:        docs[0]?.c ?? 0,
    trainingSamples:  samples[0]?.c ?? 0,
    trainingJobs:     jobs[0]?.c ?? 0,
    registeredModels: models[0]?.c ?? 0,
    embeddedDocuments: embeddedDocs,
    embeddingCoverage: (docs[0]?.c ?? 0) > 0
      ? Math.round((embeddedDocs / (docs[0]?.c ?? 1)) * 100) : 0,
    totalTokensEstimated: totalTokens,
    ollamaModels: ollamaModels.length,
    ollamaOnline: await isOllamaOnline().catch(() => false),
    hfConnected: isHFConfigured(),
    autoTrainingCycles: autoStatus.totalCyclesCompleted,
    autoTrainingSamples: autoStatus.totalSamplesAdded,
    autoTrainingRunning: autoStatus.running,
    uptime: Math.round(process.uptime()),
    uptimeHours: Math.round(process.uptime() / 3600 * 10) / 10,
  });
});

// ─── GET /api/analytics/messages-by-day ──────────────────────────────────────
router.get("/analytics/messages-by-day", async (req, res) => {
  const days = Math.min(parseInt(String(req.query.days || "30"), 10), 90);
  try {
    const data = rows<{ day: string; total: number; user_messages: number; assistant_messages: number; tokens: string }>(
      await db.execute(sql`
        SELECT
          DATE(created_at AT TIME ZONE 'UTC') AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE role = 'user')::int AS user_messages,
          COUNT(*) FILTER (WHERE role = 'assistant')::int AS assistant_messages,
          COALESCE(SUM(tokens), 0)::bigint AS tokens
        FROM messages
        WHERE created_at >= NOW() - INTERVAL '${sql.raw(String(days))} days'
        GROUP BY day
        ORDER BY day ASC
      `)
    ).map((r) => ({ ...r, tokens: Number(r.tokens) }));
    res.json({ days, data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── GET /api/analytics/samples-by-source ────────────────────────────────────
router.get("/analytics/samples-by-source", async (_req, res) => {
  try {
    const data = rows<{ source: string; count: number; first_at: string; last_at: string }>(
      await db.execute(sql`
        SELECT
          COALESCE(source, 'unknown') AS source,
          COUNT(*)::int AS count,
          MIN(created_at) AS first_at,
          MAX(created_at) AS last_at
        FROM training_samples
        GROUP BY source
        ORDER BY count DESC
      `)
    ).map((r) => ({ ...r, count: Number(r.count) }));
    const total = data.reduce((s, r) => s + r.count, 0);
    res.json({
      total,
      sources: data.map((r) => ({
        ...r,
        percentage: Math.round((r.count / Math.max(total, 1)) * 100),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── GET /api/analytics/models-usage ─────────────────────────────────────────
router.get("/analytics/models-usage", async (_req, res) => {
  try {
    const data = rows<{ model: string; conversations: number; first_used: string; last_used: string }>(
      await db.execute(sql`
        SELECT
          COALESCE(model, 'unknown') AS model,
          COUNT(*)::int AS conversations,
          MIN(created_at) AS first_used,
          MAX(created_at) AS last_used
        FROM conversations
        GROUP BY model
        ORDER BY conversations DESC
      `)
    ).map((r) => ({ ...r, conversations: Number(r.conversations) }));
    res.json({ models: data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── GET /api/analytics/documents-status ─────────────────────────────────────
router.get("/analytics/documents-status", async (_req, res) => {
  try {
    const data = rows<{ file_type: string; count: number; embedded: number; total_chunks: number; total_size_bytes: string }>(
      await db.execute(sql`
        SELECT
          COALESCE(file_type, 'text') AS file_type,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
          COALESCE(SUM(chunk_count), 0)::int AS total_chunks,
          COALESCE(SUM(size), 0)::bigint AS total_size_bytes
        FROM documents
        GROUP BY file_type
        ORDER BY count DESC
      `)
    ).map((r) => ({ ...r, count: Number(r.count), embedded: Number(r.embedded) }));
    const total = data.reduce((s, r) => s + r.count, 0);
    const embedded = data.reduce((s, r) => s + r.embedded, 0);
    res.json({ total, embedded, coverage: total > 0 ? Math.round(embedded / total * 100) : 0, byType: data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── GET /api/analytics/system-metrics ───────────────────────────────────────
router.get("/analytics/system-metrics", async (_req, res) => {
  const mem = process.memoryUsage();
  const ollamaModels = await listOllamaModels().catch(() => []);

  let dbSize = "unknown";
  try {
    const r = rows<{ size: string }>(await db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`));
    dbSize = r[0]?.size || "unknown";
  } catch { /* ignore */ }

  res.json({
    memory: {
      heapUsedMB:  Math.round(mem.heapUsed  / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB:       Math.round(mem.rss       / 1024 / 1024),
      externalMB:  Math.round(mem.external  / 1024 / 1024),
    },
    uptime: {
      seconds: Math.round(process.uptime()),
      formatted: formatUptime(process.uptime()),
    },
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },
    ollama: {
      online: await isOllamaOnline().catch(() => false),
      models: ollamaModels.length,
    },
    database: { size: dbSize },
    hf: { connected: isHFConfigured() },
  });
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// ─── GET /api/analytics/top-conversations ────────────────────────────────────
router.get("/analytics/top-conversations", async (_req, res) => {
  try {
    const data = rows<{ id: number; title: string; model: string; message_count: number; total_tokens: string; created_at: string; updated_at: string }>(
      await db.execute(sql`
        SELECT
          c.id, c.title, c.model,
          COUNT(m.id)::int AS message_count,
          COALESCE(SUM(m.tokens), 0)::bigint AS total_tokens,
          c.created_at, c.updated_at
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id, c.title, c.model, c.created_at, c.updated_at
        ORDER BY message_count DESC
        LIMIT 10
      `)
    ).map((r) => ({ ...r, message_count: Number(r.message_count), total_tokens: Number(r.total_tokens) }));
    res.json({ conversations: data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── GET /api/analytics/training-jobs ────────────────────────────────────────
router.get("/analytics/training-jobs", async (_req, res) => {
  try {
    const byStatus = rows<{ status: string; count: number }>(
      await db.execute(sql`
        SELECT status, COUNT(*)::int AS count
        FROM training_jobs
        GROUP BY status
      `)
    ).map((r) => ({ ...r, count: Number(r.count) }));
    const recent = await db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.id)).limit(20);
    res.json({ byStatus, recent });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
