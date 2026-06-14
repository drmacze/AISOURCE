/**
 * BLOK B — Capability Map + Gap Analysis
 * BLOK C — Self-Healing Training Loop
 * BLOK N — Catastrophic Forgetting Prevention
 *
 * Routes:
 *  GET  /api/benchmarks                — list benchmark results
 *  POST /api/benchmarks/run            — run capability benchmark on a model
 *  GET  /api/benchmarks/radar/:model   — radar chart data per model
 *  GET  /api/benchmarks/gap-report     — identify weakest capabilities
 *  GET  /api/golden-tests              — list golden test set
 *  POST /api/golden-tests              — add golden test question
 *  POST /api/golden-tests/run/:model   — run golden test on model
 *  GET  /api/model-versions            — model version history
 *  POST /api/model-versions/rollback/:id — rollback to version
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  modelBenchmarksTable,
  goldenTestSetTable,
  modelVersionsTable,
  trainingJobsTable,
  aiModelsTable,
} from "@workspace/db";
import { eq, desc, and, lt } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain.js";
import { eventBus } from "../lib/event-bus.js";

const router = Router();

// ─── Capability areas ──────────────────────────────────────────────────────────
const CAPABILITIES = ["coding", "bahasa_indonesia", "reasoning", "math", "creative", "general"] as const;
type Capability = typeof CAPABILITIES[number];

// ─── Standard test questions per capability ────────────────────────────────────
const BENCHMARK_QUESTIONS: Record<Capability, string[]> = {
  coding: [
    "Write a Python function that reverses a linked list.",
    "Explain the difference between async/await and Promises in JavaScript.",
    "What is Big O notation? Give an example with O(n log n).",
    "Write a SQL query to find duplicate emails in a users table.",
    "Explain what a Docker container is and how it differs from a VM.",
  ],
  bahasa_indonesia: [
    "Jelaskan apa itu kecerdasan buatan dalam bahasa Indonesia yang mudah dipahami.",
    "Buatkan ringkasan singkat tentang revolusi industri 4.0.",
    "Apa perbedaan antara machine learning dan deep learning?",
    "Tuliskan kalimat dengan tata bahasa Indonesia yang benar tentang teknologi.",
    "Jelaskan konsep cloud computing dengan analogi sederhana.",
  ],
  reasoning: [
    "If all roses are flowers and some flowers fade quickly, can we conclude all roses fade quickly?",
    "A bat and ball cost $1.10. The bat costs $1 more than the ball. How much is the ball?",
    "What comes next in the sequence: 2, 6, 12, 20, 30, ?",
    "If it takes 5 machines 5 minutes to make 5 widgets, how long for 100 machines to make 100 widgets?",
    "Explain the trolley problem and give your reasoned response.",
  ],
  math: [
    "Solve: 3x + 7 = 22",
    "What is the derivative of f(x) = x³ + 2x² - 5x + 1?",
    "Calculate the area of a circle with radius 7cm (use π ≈ 3.14159).",
    "If log₂(x) = 5, what is x?",
    "Find the sum of the first 10 Fibonacci numbers.",
  ],
  creative: [
    "Write a haiku about artificial intelligence.",
    "Create a short story (3 sentences) about a robot learning to feel emotions.",
    "Write a product tagline for an AI that helps students learn.",
    "Describe a sunset on an alien planet in 50 words.",
    "Write a motivational quote about learning from failure.",
  ],
  general: [
    "What is the capital of Australia?",
    "Who wrote the novel '1984'?",
    "Explain how photosynthesis works in simple terms.",
    "What is the speed of light in km/s?",
    "Name three renewable energy sources.",
  ],
};

// ─── Run benchmark ─────────────────────────────────────────────────────────────

async function runCapabilityBenchmark(modelName: string, capability: Capability): Promise<number> {
  const questions = BENCHMARK_QUESTIONS[capability];
  let passed = 0;

  for (const question of questions) {
    try {
      const start = Date.now();
      const { text } = await generateWithFallback(question, undefined, undefined, { maxTokens: 300 });
      const latency = Date.now() - start;

      // Scoring heuristic: response length + keywords + latency bonus
      const hasContent = text.trim().length > 20;
      const relevantKeywords = getRelevantKeywords(capability);
      const hasKeyword = relevantKeywords.some((kw) => text.toLowerCase().includes(kw));
      const latencyBonus = latency < 5000 ? 1 : 0;

      if (hasContent && (hasKeyword || text.length > 100)) passed += (1 + latencyBonus * 0.1);
    } catch {
      // failed question
    }
  }

  return Math.min(100, Math.round((passed / questions.length) * 100));
}

function getRelevantKeywords(capability: Capability): string[] {
  const map: Record<Capability, string[]> = {
    coding:           ["function", "code", "python", "return", "variable", "class", "def", "```"],
    bahasa_indonesia: ["adalah", "merupakan", "dalam", "untuk", "yang", "dengan", "ini", "itu"],
    reasoning:        ["therefore", "because", "if", "then", "since", "thus", "conclude", "logic"],
    math:             ["x =", "=", "calculate", "result", "answer", "π", "equation", "solve"],
    creative:         ["once", "the", "a ", "an ", "felt", "was", "story", "haiku"],
    general:          ["is", "are", "the", "a ", "capital", "was", "speed"],
  };
  return map[capability] ?? [];
}

// ── POST /api/benchmarks/run ───────────────────────────────────────────────────

router.post("/benchmarks/run", async (req, res) => {
  try {
    const { modelName, capabilities = CAPABILITIES } = req.body as {
      modelName: string;
      capabilities?: Capability[];
    };

    if (!modelName) return res.status(400).json({ error: "modelName required" });

    const results: Record<string, number> = {};
    const previousScores = await db.select()
      .from(modelBenchmarksTable)
      .where(eq(modelBenchmarksTable.modelName, modelName))
      .orderBy(desc(modelBenchmarksTable.testedAt));

    for (const cap of capabilities) {
      const score = await runCapabilityBenchmark(modelName, cap as Capability);
      results[cap] = score;

      await db.insert(modelBenchmarksTable).values({
        modelName,
        capability: cap,
        score,
        sampleCount: BENCHMARK_QUESTIONS[cap as Capability]?.length ?? 5,
        notes: `Auto-benchmark run`,
      });
    }

    // Check for quality drop (BLOK C)
    const drops: string[] = [];
    for (const [cap, score] of Object.entries(results)) {
      const prev = previousScores.find((r) => r.capability === cap);
      if (prev && score < prev.score - 5) {
        drops.push(`${cap}: ${prev.score} → ${score}`);
      }
    }

    if (drops.length > 0) {
      eventBus.fire("quality_drop_detected", {
        modelName,
        drops,
        currentScores: results,
      }, "benchmarks_route");
    }

    eventBus.fire("benchmark_completed", { modelName, results }, "benchmarks_route");

    res.json({ modelName, results, drops, timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/benchmarks ────────────────────────────────────────────────────────

router.get("/benchmarks", async (req, res) => {
  try {
    const { model, limit = "50" } = req.query as { model?: string; limit?: string };
    let rows;
    if (model) {
      rows = await db.select().from(modelBenchmarksTable)
        .where(eq(modelBenchmarksTable.modelName, model))
        .orderBy(desc(modelBenchmarksTable.testedAt))
        .limit(Number(limit));
    } else {
      rows = await db.select().from(modelBenchmarksTable)
        .orderBy(desc(modelBenchmarksTable.testedAt))
        .limit(Number(limit));
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/benchmarks/radar/:model ──────────────────────────────────────────

router.get("/benchmarks/radar/:model", async (req, res) => {
  try {
    const modelName = decodeURIComponent(req.params["model"]);
    const rows = await db.select().from(modelBenchmarksTable)
      .where(eq(modelBenchmarksTable.modelName, modelName))
      .orderBy(desc(modelBenchmarksTable.testedAt));

    // Latest score per capability
    const radar: Record<string, number> = {};
    for (const cap of CAPABILITIES) {
      const row = rows.find((r) => r.capability === cap);
      radar[cap] = row?.score ?? 0;
    }

    res.json({ modelName, radar, capabilities: CAPABILITIES });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/benchmarks/gap-report ────────────────────────────────────────────

router.get("/benchmarks/gap-report", async (_req, res) => {
  try {
    const allModels = await db.selectDistinct({ modelName: modelBenchmarksTable.modelName })
      .from(modelBenchmarksTable);

    const report: Array<{ modelName: string; gaps: Array<{ capability: string; score: number }> }> = [];

    for (const { modelName } of allModels) {
      const rows = await db.select().from(modelBenchmarksTable)
        .where(eq(modelBenchmarksTable.modelName, modelName))
        .orderBy(desc(modelBenchmarksTable.testedAt));

      const latest: Record<string, number> = {};
      for (const cap of CAPABILITIES) {
        const row = rows.find((r) => r.capability === cap);
        latest[cap] = row?.score ?? 0;
      }

      const gaps = Object.entries(latest)
        .filter(([, s]) => s < 60)
        .sort(([, a], [, b]) => a - b)
        .map(([capability, score]) => ({ capability, score }));

      report.push({ modelName, gaps });
    }

    res.json({ report, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/golden-tests ─────────────────────────────────────────────────────

router.get("/golden-tests", async (_req, res) => {
  try {
    const rows = await db.select().from(goldenTestSetTable)
      .where(eq(goldenTestSetTable.active, true))
      .orderBy(goldenTestSetTable.capability, goldenTestSetTable.difficulty);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/golden-tests ────────────────────────────────────────────────────

router.post("/golden-tests", async (req, res) => {
  try {
    const { question, expectedAnswer, capability, difficulty = "medium" } = req.body as {
      question: string;
      expectedAnswer: string;
      capability: string;
      difficulty?: "easy" | "medium" | "hard";
    };
    if (!question || !expectedAnswer || !capability)
      return res.status(400).json({ error: "question, expectedAnswer, capability required" });

    const [row] = await db.insert(goldenTestSetTable).values({ question, expectedAnswer, capability, difficulty }).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/golden-tests/run/:model ─────────────────────────────────────────

router.post("/golden-tests/run/:model", async (req, res) => {
  try {
    const modelName = decodeURIComponent(req.params["model"]);
    const tests = await db.select().from(goldenTestSetTable)
      .where(eq(goldenTestSetTable.active, true))
      .limit(50); // limit for speed

    if (tests.length === 0) return res.json({ modelName, passed: 0, total: 0, score: 0 });

    let passed = 0;
    const failures: Array<{ question: string; expected: string; got: string }> = [];

    for (const test of tests) {
      try {
        const { text } = await generateWithFallback(test.question, undefined, undefined, { maxTokens: 200 });
        // Soft match: expected keywords present in response
        const keywords = test.expectedAnswer.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const matches = keywords.filter((kw) => text.toLowerCase().includes(kw));
        if (matches.length >= Math.ceil(keywords.length * 0.4)) {
          passed++;
        } else {
          failures.push({ question: test.question, expected: test.expectedAnswer.slice(0, 100), got: text.slice(0, 100) });
        }
      } catch {
        failures.push({ question: test.question, expected: test.expectedAnswer.slice(0, 100), got: "ERROR" });
      }
    }

    const score = Math.round((passed / tests.length) * 100);

    // BLOK N: Emit event if score too low
    if (score < 85) {
      eventBus.fire("golden_test_failed", { modelName, score, passed, total: tests.length }, "golden_tests");
    }

    res.json({ modelName, passed, total: tests.length, score, failures: failures.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/model-versions ────────────────────────────────────────────────────

router.get("/model-versions", async (_req, res) => {
  try {
    const rows = await db.select().from(modelVersionsTable).orderBy(desc(modelVersionsTable.createdAt)).limit(100);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/model-versions/rollback/:id ─────────────────────────────────────

router.post("/model-versions/rollback/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [version] = await db.select().from(modelVersionsTable).where(eq(modelVersionsTable.id, id));
    if (!version) return res.status(404).json({ error: "Version not found" });

    await db.update(modelVersionsTable)
      .set({ status: "active" })
      .where(eq(modelVersionsTable.id, id));

    // Mark other versions of same model as deprecated
    await db.update(modelVersionsTable)
      .set({ status: "rolled_back" })
      .where(and(
        eq(modelVersionsTable.modelId, version.modelId),
        eq(modelVersionsTable.status, "active")
      ));

    res.json({ success: true, rolledBackTo: version });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
