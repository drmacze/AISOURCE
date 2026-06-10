import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  documentsTable,
  aiModelsTable,
  trainingJobsTable,
  trainingDatasetsTable,
  trainingSamplesTable,
} from "@workspace/db";
import { count, eq, desc, sql } from "drizzle-orm";
import { isOllamaOnline, listOllamaModels } from "../ollama";
import { isHFConfigured } from "../huggingface";
import { getAutoTrainingStatus } from "../autotraining";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res) => {
  const [
    convRows,
    msgRows,
    docRows,
    modelRows,
    datasetRows,
    activeJobRows,
    completedJobRows,
    sampleRows,
    ollamaModels,
    ollamaOnline,
  ] = await Promise.all([
    db.select({ count: count() }).from(conversationsTable),
    db.select({ count: count() }).from(messagesTable),
    db.select({ count: count() }).from(documentsTable),
    db.select({ count: count() }).from(aiModelsTable),
    db.select({ count: count() }).from(trainingDatasetsTable),
    db.select({ count: count() }).from(trainingJobsTable).where(eq(trainingJobsTable.status, "running")),
    db.select({ count: count() }).from(trainingJobsTable).where(eq(trainingJobsTable.status, "completed")),
    db.select({ count: count() }).from(trainingSamplesTable),
    listOllamaModels().catch(() => [] as Array<{ name: string }>),
    isOllamaOnline().catch(() => false),
  ]);

  const totalDocs = convRows[0]?.count ?? 0;
  const docCount  = docRows[0]?.count ?? 0;

  // Count docs with real vector embeddings
  let embeddedCount = 0;
  try {
    const embResult = await db.execute(sql`SELECT COUNT(*)::int AS n FROM documents WHERE embedding IS NOT NULL`);
    embeddedCount = (embResult as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  } catch { /* pgvector not ready yet */ }

  const autoStatus = getAutoTrainingStatus();

  res.json({
    totalConversations: convRows[0]?.count ?? 0,
    totalMessages:      msgRows[0]?.count ?? 0,
    totalDocuments:     docCount,
    totalModels:        modelRows[0]?.count ?? 0,
    activeTrainingJobs: activeJobRows[0]?.count ?? 0,
    completedTrainingJobs: completedJobRows[0]?.count ?? 0,
    totalDatasets:      datasetRows[0]?.count ?? 0,
    totalTrainingSamples: sampleRows[0]?.count ?? 0,
    embeddedDocuments:  embeddedCount,
    embeddingCoverage:  docCount > 0 ? Math.round((embeddedCount / docCount) * 100) : 0,
    ollamaOnline,
    ollamaModels:       (ollamaModels as Array<{ name: string }>).length,
    installedModels:    (ollamaModels as Array<{ name: string }>).map((m) => m.name),
    hfConnected:        isHFConfigured(),
    autoTraining: {
      running:          autoStatus.running,
      cyclesCompleted:  autoStatus.totalCyclesCompleted,
      samplesAdded:     autoStatus.totalSamplesAdded,
      lastCycleAt:      autoStatus.lastCycleAt,
      sources:          Object.keys(autoStatus.sourceStats),
    },
    systemStatus: "online",
    lastUpdated:  new Date().toISOString(),
  });

  void totalDocs; // suppress unused warning
});

router.get("/dashboard/recent-activity", async (_req, res) => {
  const [convs, docs, jobs, models] = await Promise.all([
    db.select().from(conversationsTable).orderBy(desc(conversationsTable.createdAt)).limit(3),
    db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt)).limit(2),
    db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.id)).limit(2),
    db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.createdAt)).limit(2),
  ]);

  const activities = [
    ...convs.map((c) => ({
      id: c.id,
      type: "conversation" as const,
      title: `New conversation: ${c.title}`,
      description: `Model: ${c.model || "tinyllama"}`,
      createdAt: new Date(c.createdAt).toISOString(),
    })),
    ...docs.map((d) => ({
      id: d.id + 1000,
      type: "document" as const,
      title: `Document indexed: ${d.title}`,
      description: `${d.chunkCount} chunks · ${d.fileType || "text"}`,
      createdAt: new Date(d.createdAt).toISOString(),
    })),
    ...jobs.map((j) => ({
      id: j.id + 2000,
      type: "training" as const,
      title: `Training job ${j.status}`,
      description: `Progress ${Math.round((j.progress || 0) * 100)}%${j.accuracy ? ` · acc ${(j.accuracy * 100).toFixed(1)}%` : ""}`,
      createdAt: new Date(j.createdAt).toISOString(),
    })),
    ...models.map((m) => ({
      id: m.id + 3000,
      type: "model" as const,
      title: `Model: ${m.name}`,
      description: `${m.type} · ${m.status}`,
      createdAt: new Date(m.createdAt).toISOString(),
    })),
  ];

  activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(activities.slice(0, 10));
});

export default router;
