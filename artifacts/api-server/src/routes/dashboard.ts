import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  documentsTable,
  aiModelsTable,
  trainingJobsTable,
  trainingDatasetsTable,
} from "@workspace/db";
import { count, eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res) => {
  const [conversations] = await db
    .select({ count: count() })
    .from(conversationsTable);
  const [messages] = await db
    .select({ count: count() })
    .from(messagesTable);
  const [docs] = await db
    .select({ count: count() })
    .from(documentsTable);
  const [models] = await db
    .select({ count: count() })
    .from(aiModelsTable);
  const [datasets] = await db
    .select({ count: count() })
    .from(trainingDatasetsTable);
  const [activeJobs] = await db
    .select({ count: count() })
    .from(trainingJobsTable)
    .where(eq(trainingJobsTable.status, "running"));

  res.json({
    totalConversations: conversations.count,
    totalMessages: messages.count,
    totalDocuments: docs.count,
    totalModels: models.count,
    activeTrainingJobs: activeJobs.count,
    totalDatasets: datasets.count,
    systemStatus: "online",
    lastUpdated: new Date().toISOString(),
  });
});

router.get("/dashboard/recent-activity", async (_req, res) => {
  const convs = await db
    .select()
    .from(conversationsTable)
    .orderBy(conversationsTable.createdAt)
    .limit(3);
  const docs = await db
    .select()
    .from(documentsTable)
    .orderBy(documentsTable.createdAt)
    .limit(2);
  const jobs = await db
    .select()
    .from(trainingJobsTable)
    .orderBy(desc(trainingJobsTable.id))
    .limit(2);
  const models = await db
    .select()
    .from(aiModelsTable)
    .orderBy(aiModelsTable.createdAt)
    .limit(2);

  const activities = [
    ...convs.map((c) => ({
      id: c.id,
      type: "conversation" as const,
      title: `New conversation: ${c.title}`,
      description: `Started at ${new Date(c.createdAt).toLocaleString()}`,
      createdAt: new Date(c.createdAt).toISOString(),
    })),
    ...docs.map((d) => ({
      id: d.id + 1000,
      type: "document" as const,
      title: `Document uploaded: ${d.title}`,
      description: `${d.chunkCount} chunks indexed`,
      createdAt: new Date(d.createdAt).toISOString(),
    })),
    ...jobs.map((j) => ({
      id: j.id + 2000,
      type: "training" as const,
      title: `Training job: ${j.status}`,
      description: `Epoch ${j.currentEpoch}/${j.epochs}`,
      createdAt: new Date(j.createdAt).toISOString(),
    })),
    ...models.map((m) => ({
      id: m.id + 3000,
      type: "model" as const,
      title: `Model registered: ${m.name}`,
      description: `Type: ${m.type}, Status: ${m.status}`,
      createdAt: new Date(m.createdAt).toISOString(),
    })),
  ];

  activities.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  res.json(activities.slice(0, 10));
});

export default router;
