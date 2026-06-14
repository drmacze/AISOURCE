/**
 * BLOK A — RLHF-lite: Message Feedback Routes
 * POST /api/feedback          — submit 👍/👎 for any message
 * GET  /api/feedback/stats    — aggregate stats for dashboard
 * GET  /api/feedback          — list recent feedback entries
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { messageFeedbackTable, trainingSamplesTable, trainingDatasetsTable } from "@workspace/db";
import { eq, desc, count, sql, and } from "drizzle-orm";
import { eventBus } from "../lib/event-bus.js";

const router = Router();

// ── POST /api/feedback ─────────────────────────────────────────────────────────

router.post("/feedback", async (req, res) => {
  try {
    const {
      messageId,
      conversationId,
      rating,
      source = "web",
      userId,
      messageContent,
      model,
      notes,
    } = req.body as {
      messageId?: number;
      conversationId?: number;
      rating: "positive" | "negative";
      source?: "web" | "telegram" | "whatsapp";
      userId?: string;
      messageContent?: string;
      model?: string;
      notes?: string;
    };

    if (!rating || !["positive", "negative"].includes(rating)) {
      return res.status(400).json({ error: "rating must be 'positive' or 'negative'" });
    }

    const [feedback] = await db.insert(messageFeedbackTable).values({
      messageId:      messageId ?? null,
      conversationId: conversationId ?? null,
      rating,
      source,
      userId:         userId ?? null,
      messageContent: messageContent ?? null,
      model:          model ?? null,
      notes:          notes ?? null,
    }).returning();

    // Emit event for reactive agent processing (BLOK G)
    eventBus.fire("feedback_received", {
      feedbackId:  feedback.id,
      rating,
      source,
      messageId:   messageId ?? null,
      model:       model ?? null,
    }, "feedback_api");

    // If positive feedback + message content → auto-add to training dataset (BLOK A1)
    if (rating === "positive" && messageContent && messageContent.length > 20) {
      try {
        // Find or create "RLHF Positive" dataset
        let [dataset] = await db.select()
          .from(trainingDatasetsTable)
          .where(eq(trainingDatasetsTable.name, "RLHF — Positive Feedback"))
          .limit(1);

        if (!dataset) {
          [dataset] = await db.insert(trainingDatasetsTable).values({
            name:        "RLHF — Positive Feedback",
            description: "Auto-collected from user 👍 feedback. High-quality training data.",
            taskType:    "chat",
            sampleCount: 0,
          }).returning();
        }

        await db.insert(trainingSamplesTable).values({
          datasetId:    dataset.id,
          input:        userId ? `[${source}] ${userId}` : `[${source}]`,
          output:       messageContent,
          source:       `rlhf_${source}`,
          qualityScore: 0.9,
          label:        "positive",
          metadata:     JSON.stringify({ feedbackId: feedback.id, model, rating: "positive" }),
        });

        await db.update(trainingDatasetsTable)
          .set({ sampleCount: sql`${trainingDatasetsTable.sampleCount} + 1`, updatedAt: new Date() })
          .where(eq(trainingDatasetsTable.id, dataset.id));
      } catch (e) {
        console.warn("[Feedback] Auto-training sample failed:", String(e));
      }
    }

    res.json({ success: true, feedbackId: feedback.id });
  } catch (e) {
    console.error("[Feedback] POST /api/feedback error:", e);
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/feedback/stats ────────────────────────────────────────────────────

router.get("/feedback/stats", async (_req, res) => {
  try {
    const [totalRow] = await db.select({ total: count() }).from(messageFeedbackTable);
    const [posRow]   = await db.select({ pos: count() }).from(messageFeedbackTable)
      .where(eq(messageFeedbackTable.rating, "positive"));
    const [negRow]   = await db.select({ neg: count() }).from(messageFeedbackTable)
      .where(eq(messageFeedbackTable.rating, "negative"));

    const total    = Number(totalRow?.total ?? 0);
    const positive = Number(posRow?.pos ?? 0);
    const negative = Number(negRow?.neg ?? 0);

    // Per-source breakdown
    const sourceRows = await db
      .select({ source: messageFeedbackTable.source, cnt: count() })
      .from(messageFeedbackTable)
      .groupBy(messageFeedbackTable.source);

    res.json({
      total,
      positive,
      negative,
      positiveRate: total > 0 ? Math.round((positive / total) * 100) : 0,
      bySources: Object.fromEntries(sourceRows.map((r) => [r.source, Number(r.cnt)])),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/feedback ──────────────────────────────────────────────────────────

router.get("/feedback", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query["limit"] ?? 50), 200);
    const source = req.query["source"] as string | undefined;

    const query = db.select().from(messageFeedbackTable).orderBy(desc(messageFeedbackTable.createdAt)).limit(limit);

    const rows = source
      ? await db.select().from(messageFeedbackTable)
          .where(eq(messageFeedbackTable.source, source as "web" | "telegram" | "whatsapp"))
          .orderBy(desc(messageFeedbackTable.createdAt))
          .limit(limit)
      : await query;

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
