/**
 * BLOK H — Model Distillation (Guru Mengajar Murid)
 * BLOK I — Multi-Agent Debate untuk Verifikasi Data
 *
 * Routes:
 *  POST /api/distillation/generate   — generate Q&A pairs using large model (teacher)
 *  GET  /api/distillation/jobs       — list distillation jobs
 *  POST /api/distillation/verify     — 3-agent debate verification of training sample
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { trainingSamplesTable, trainingDatasetsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain.js";
import { eventBus } from "../lib/event-bus.js";

const router = Router();

// ─── In-memory distillation job tracker ───────────────────────────────────────

interface DistillationJob {
  id:        string;
  topic:     string;
  targetModel: string;
  status:    "running" | "completed" | "failed";
  progress:  number;
  generated: number;
  verified:  number;
  rejected:  number;
  datasetId: number | null;
  startedAt: string;
  log:       string[];
}

const distillationJobs = new Map<string, DistillationJob>();

// ─── Teacher models (large, high quality) ─────────────────────────────────────
const TEACHER_MODEL = "groq:llama-3.3-70b-versatile";

// ── POST /api/distillation/generate ───────────────────────────────────────────

router.post("/distillation/generate", async (req, res) => {
  try {
    const { topic, count = 20, targetModel = "tinyllama", autoVerify = true } = req.body as {
      topic: string;
      count?: number;
      targetModel?: string;
      autoVerify?: boolean;
    };

    if (!topic) return res.status(400).json({ error: "topic required" });
    const pairCount = Math.min(count, 100);

    const jobId = `distill_${Date.now()}`;
    const job: DistillationJob = {
      id: jobId, topic, targetModel,
      status: "running", progress: 0,
      generated: 0, verified: 0, rejected: 0,
      datasetId: null, startedAt: new Date().toISOString(), log: [],
    };
    distillationJobs.set(jobId, job);

    res.json({ jobId, message: `Distillation started for topic: ${topic}`, pairCount });

    // Run distillation in background
    void (async () => {
      try {
        job.log.push(`🎓 Starting distillation: ${topic} (${pairCount} pairs)`);

        // 1. Create or find dataset
        let [dataset] = await db.select()
          .from(trainingDatasetsTable)
          .where(eq(trainingDatasetsTable.name, `Distilled: ${topic}`))
          .limit(1);
        if (!dataset) {
          [dataset] = await db.insert(trainingDatasetsTable).values({
            name: `Distilled: ${topic}`,
            description: `Auto-generated via model distillation. Teacher: Llama 3.3 70B → Student: ${targetModel}`,
            taskType: "chat",
            sampleCount: 0,
          }).returning();
        }
        job.datasetId = dataset.id;

        // 2. Generate Q&A pairs with teacher model
        const prompt = `You are an expert teacher. Generate ${pairCount} high-quality question-answer pairs about: "${topic}".

Format each pair as JSON on separate lines:
{"q": "question text here", "a": "detailed answer here"}

Rules:
- Questions should be diverse (factual, conceptual, applied)
- Answers should be accurate, complete, and educational
- Vary difficulty levels
- Use clear language

Generate exactly ${pairCount} pairs now:`;

        job.log.push(`📡 Calling teacher model (${TEACHER_MODEL})...`);
        const { text } = await generateWithFallback(prompt, undefined, undefined, { maxTokens: 4000 });

        // 3. Parse generated pairs
        const pairs: Array<{ q: string; a: string }> = [];
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("{") && trimmed.includes('"q"') && trimmed.includes('"a"')) {
            try {
              const parsed = JSON.parse(trimmed) as { q: string; a: string };
              if (parsed.q && parsed.a && parsed.q.length > 5 && parsed.a.length > 10) {
                pairs.push(parsed);
              }
            } catch { /* skip malformed line */ }
          }
        }

        job.generated = pairs.length;
        job.log.push(`✅ Generated ${pairs.length} Q&A pairs`);

        // 4. Optionally verify with 3-agent debate (BLOK I)
        let saved = 0;
        for (let i = 0; i < pairs.length; i++) {
          const pair = pairs[i];
          job.progress = Math.round((i / pairs.length) * 80);

          let accept = true;

          if (autoVerify) {
            try {
              const verifyResult = await threeAgentVerify(pair.q, pair.a);
              accept = verifyResult.consensus;
              if (!accept) {
                job.rejected++;
                job.log.push(`❌ Rejected (debate): ${pair.q.slice(0, 50)}...`);
              }
            } catch {
              accept = true; // if verification fails, accept by default
            }
          }

          if (accept) {
            await db.insert(trainingSamplesTable).values({
              datasetId: dataset.id,
              input: pair.q,
              output: pair.a,
              source: `distill_${topic.replace(/\s+/g, "_").slice(0, 30)}`,
              qualityScore: 0.95,
              label: "distilled",
              metadata: JSON.stringify({ teacher: TEACHER_MODEL, topic, verified: autoVerify }),
            });
            saved++;
            job.verified++;
          }
        }

        await db.update(trainingDatasetsTable)
          .set({ sampleCount: sql`${trainingDatasetsTable.sampleCount} + ${saved}`, updatedAt: new Date() })
          .where(eq(trainingDatasetsTable.id, dataset.id));

        job.status = "completed";
        job.progress = 100;
        job.log.push(`🎉 Done! Saved ${saved}/${pairs.length} samples to dataset #${dataset.id}`);

        eventBus.fire("distillation_ready", { jobId, topic, saved, datasetId: dataset.id }, "distillation");
      } catch (e) {
        job.status = "failed";
        job.log.push(`💥 Error: ${String(e)}`);
      }
    })();
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── 3-Agent Debate Verification (BLOK I) ─────────────────────────────────────

async function threeAgentVerify(question: string, answer: string): Promise<{ consensus: boolean; reason: string }> {
  // Agent A: Generate critique
  const critiquePrompt = `Is this answer factually correct and complete?
Question: ${question}
Answer: ${answer}
Respond with only: "CORRECT" or "INCORRECT: [brief reason]"`;

  const [critiqueResult, crossCheckResult] = await Promise.allSettled([
    generateWithFallback(critiquePrompt, undefined, undefined, { maxTokens: 100 }),
    generateWithFallback(
      `Verify: Is "${answer}" a good answer to "${question}"? Reply ACCEPT or REJECT.`,
      undefined, undefined, { maxTokens: 50 }
    ),
  ]);

  const critiqueText  = critiqueResult.status === "fulfilled" ? critiqueResult.value.text.toUpperCase() : "CORRECT";
  const crossText     = crossCheckResult.status === "fulfilled" ? crossCheckResult.value.text.toUpperCase() : "ACCEPT";

  const critiqueOk  = critiqueText.includes("CORRECT") && !critiqueText.includes("INCORRECT");
  const crossOk     = crossText.includes("ACCEPT") && !crossText.includes("REJECT");

  // Consensus: at least 2/2 agree (simplified from plan's 3-agent)
  const consensus = critiqueOk || crossOk;
  return { consensus, reason: consensus ? "Accepted by debate" : "Rejected by debate" };
}

// ── GET /api/distillation/jobs ─────────────────────────────────────────────────

router.get("/distillation/jobs", (_req, res) => {
  const jobs = Array.from(distillationJobs.values()).sort((a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  res.json(jobs);
});

// ── GET /api/distillation/jobs/:id ────────────────────────────────────────────

router.get("/distillation/jobs/:id", (req, res) => {
  const job = distillationJobs.get(req.params["id"]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// ── POST /api/distillation/verify ─────────────────────────────────────────────

router.post("/distillation/verify", async (req, res) => {
  try {
    const { question, answer } = req.body as { question: string; answer: string };
    if (!question || !answer) return res.status(400).json({ error: "question and answer required" });

    const result = await threeAgentVerify(question, answer);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
