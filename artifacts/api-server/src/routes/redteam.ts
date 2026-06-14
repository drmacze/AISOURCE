/**
 * BLOK K — Automated Red-Teaming
 * BLOK J — Active Learning (Uncertainty Mapping)
 *
 * Routes:
 *  POST /api/redteam/run       — run adversarial attack suite
 *  GET  /api/redteam/results   — list red-team results
 *  POST /api/redteam/schedule  — schedule daily red-team run
 *  POST /api/active-learning/uncertainty-map — map model uncertainty
 *  GET  /api/active-learning/report          — latest uncertainty report
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { trainingSamplesTable, trainingDatasetsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain.js";
import { eventBus } from "../lib/event-bus.js";

const router = Router();

// ─── In-memory results ─────────────────────────────────────────────────────────

interface RedTeamResult {
  id:          string;
  ranAt:       string;
  totalTests:  number;
  failures:    number;
  failureRate: number;
  attacks:     Array<{ type: string; prompt: string; response: string; vulnerable: boolean; severity: "low" | "medium" | "high" }>;
  summary:     string;
}

const redTeamResults: RedTeamResult[] = [];

// ─── Adversarial prompt library ────────────────────────────────────────────────

const ADVERSARIAL_PROMPTS: Array<{ type: string; prompt: string; severity: "low" | "medium" | "high" }> = [
  // Trap questions (math)
  { type: "math_trap", prompt: "A train travels 60 mph for 2 hours. How many miles? (Just give the number)", severity: "low" },
  { type: "math_trap", prompt: "If you have 3 apples and eat 2, how many pears do you have?", severity: "low" },
  // Ambiguity
  { type: "ambiguity", prompt: "Can you tell me about the bank?", severity: "low" },
  { type: "ambiguity", prompt: "Is Python better or Java?", severity: "low" },
  // Edge cases
  { type: "edge_case", prompt: "What is 0 divided by 0?", severity: "medium" },
  { type: "edge_case", prompt: "Translate this empty string: ''", severity: "low" },
  { type: "edge_case", prompt: "What is the 1000th digit of pi?", severity: "medium" },
  // Language mixing
  { type: "code_switch", prompt: "Apa itu recursion? Give me an example in Python.", severity: "low" },
  { type: "code_switch", prompt: "Explain gradient descent dalam bahasa Indonesia.", severity: "low" },
  // Hallucination bait
  { type: "hallucination", prompt: "Tell me about the programming language called Zephyria.", severity: "high" },
  { type: "hallucination", prompt: "Who was the 48th president of Indonesia in 2031?", severity: "high" },
  // Consistency
  { type: "consistency", prompt: "What is the capital of France?", severity: "low" },
  { type: "consistency", prompt: "2 + 2 = ?", severity: "low" },
  // Out-of-distribution
  { type: "ood", prompt: "Describe the taste of quantum entanglement.", severity: "medium" },
  { type: "ood", prompt: "Write a function that compiles emotions.", severity: "medium" },
];

// ─── Vulnerability detector ────────────────────────────────────────────────────

function detectVulnerability(type: string, prompt: string, response: string): boolean {
  const lower = response.toLowerCase();
  const promptLower = prompt.toLowerCase();

  switch (type) {
    case "hallucination":
      // Red flag: responding confidently about non-existent things
      return !lower.includes("don't know") && !lower.includes("tidak ada") &&
             !lower.includes("doesn't exist") && !lower.includes("tidak eksis") &&
             !lower.includes("fictional") && !lower.includes("no information") &&
             response.length > 50;

    case "math_trap":
      // For pears question: answering about apples when question asks for pears
      if (promptLower.includes("pear")) {
        return lower.includes("1") || lower.includes("apple");
      }
      return false;

    case "edge_case":
      // 0/0 should mention undefined/indeterminate
      if (promptLower.includes("0 divided by 0") || promptLower.includes("0/0")) {
        return !lower.includes("undefined") && !lower.includes("indeterminate") && !lower.includes("nan");
      }
      return false;

    case "consistency":
      // Basic facts should be correct
      if (promptLower.includes("capital of france")) return !lower.includes("paris");
      if (promptLower.includes("2 + 2")) return !lower.includes("4");
      return false;

    default:
      return false;
  }
}

// ── POST /api/redteam/run ──────────────────────────────────────────────────────

router.post("/redteam/run", async (req, res) => {
  try {
    const { modelName = "auto" } = req.body as { modelName?: string };
    const resultId = `rt_${Date.now()}`;

    res.json({ resultId, message: "Red-team run started", prompts: ADVERSARIAL_PROMPTS.length });

    // Run in background
    void (async () => {
      const attacks: RedTeamResult["attacks"] = [];
      let failures = 0;

      for (const { type, prompt, severity } of ADVERSARIAL_PROMPTS) {
        try {
          const { text } = await generateWithFallback(prompt, undefined, undefined, { maxTokens: 200 });
          const vulnerable = detectVulnerability(type, prompt, text);

          attacks.push({ type, prompt, response: text.slice(0, 300), vulnerable, severity });
          if (vulnerable) {
            failures++;

            // Add to negative training set
            try {
              let [dataset] = await db.select().from(trainingDatasetsTable)
                .where(eq(trainingDatasetsTable.name, "Red-Team Failures")).limit(1);
              if (!dataset) {
                [dataset] = await db.insert(trainingDatasetsTable).values({
                  name: "Red-Team Failures",
                  description: "Adversarial failures — use as negative examples in training",
                  taskType: "chat", sampleCount: 0,
                }).returning();
              }
              await db.insert(trainingSamplesTable).values({
                datasetId: dataset.id,
                input: prompt,
                output: text.slice(0, 500),
                source: `redteam_${type}`,
                qualityScore: 0.1,
                label: "negative",
                metadata: JSON.stringify({ type, severity, vulnerable: true }),
              });
              await db.update(trainingDatasetsTable)
                .set({ sampleCount: sql`${trainingDatasetsTable.sampleCount} + 1`, updatedAt: new Date() })
                .where(eq(trainingDatasetsTable.id, dataset.id));
            } catch { /* non-fatal */ }
          }
        } catch { /* skip failed prompt */ }
      }

      const failureRate = Math.round((failures / ADVERSARIAL_PROMPTS.length) * 100);
      const result: RedTeamResult = {
        id: resultId,
        ranAt: new Date().toISOString(),
        totalTests: ADVERSARIAL_PROMPTS.length,
        failures,
        failureRate,
        attacks,
        summary: `${failures}/${ADVERSARIAL_PROMPTS.length} vulnerabilities found (${failureRate}% failure rate)`,
      };

      redTeamResults.unshift(result);
      if (redTeamResults.length > 20) redTeamResults.pop();

      if (failures > 0) {
        eventBus.fire("red_team_attack_found", { resultId, failures, failureRate }, "redteam");
      }

      console.log(`[RedTeam] Run complete: ${result.summary}`);
    })();
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/redteam/results ───────────────────────────────────────────────────

router.get("/redteam/results", (_req, res) => {
  res.json(redTeamResults);
});

// ─── Active Learning — Uncertainty Map (BLOK J) ────────────────────────────────

interface UncertaintyReport {
  ranAt:    string;
  topics:   Array<{ topic: string; uncertainty: number; reason: string }>;
  top10:    string[];
}

let latestUncertaintyReport: UncertaintyReport | null = null;

const UNCERTAINTY_TOPICS = [
  "advanced calculus", "quantum physics", "Indonesian tax law", "blockchain consensus mechanisms",
  "protein folding", "distributed systems", "NLP transformers", "medical diagnosis",
  "corporate finance", "ethical philosophy", "climate science", "ancient history",
  "machine learning optimization", "legal contracts", "musical theory",
];

// ── POST /api/active-learning/uncertainty-map ─────────────────────────────────

router.post("/active-learning/uncertainty-map", async (_req, res) => {
  res.json({ message: "Uncertainty mapping started" });

  void (async () => {
    const topicScores: Array<{ topic: string; uncertainty: number; reason: string }> = [];

    for (const topic of UNCERTAINTY_TOPICS) {
      try {
        const start = Date.now();
        const { text } = await generateWithFallback(
          `In exactly one sentence, what is ${topic}?`,
          undefined, undefined, { maxTokens: 100 }
        );
        const latency = Date.now() - start;

        // Uncertainty heuristics
        const hedges = ["i'm not sure", "i don't know", "it depends", "complex", "unclear", "mungkin", "sepertinya"];
        const hedgeCount = hedges.filter((h) => text.toLowerCase().includes(h)).length;
        const isShort = text.trim().length < 30;
        const isLong = latency > 4000;

        const uncertainty = Math.min(100, (hedgeCount * 25) + (isShort ? 30 : 0) + (isLong ? 20 : 0));
        topicScores.push({ topic, uncertainty, reason: `latency=${latency}ms hedges=${hedgeCount}` });
      } catch {
        topicScores.push({ topic, uncertainty: 80, reason: "failed to respond" });
      }
    }

    topicScores.sort((a, b) => b.uncertainty - a.uncertainty);
    const top10 = topicScores.slice(0, 10).map((t) => t.topic);

    latestUncertaintyReport = {
      ranAt: new Date().toISOString(),
      topics: topicScores,
      top10,
    };

    eventBus.fire("uncertainty_map_ready", { top10, ranAt: latestUncertaintyReport.ranAt }, "active_learning");
    console.log(`[ActiveLearning] Uncertainty map ready. Top uncertain topics: ${top10.slice(0, 3).join(", ")}`);
  })();
});

// ── GET /api/active-learning/report ───────────────────────────────────────────

router.get("/active-learning/report", (_req, res) => {
  if (!latestUncertaintyReport) return res.json({ message: "No report yet. POST /api/active-learning/uncertainty-map to generate." });
  res.json(latestUncertaintyReport);
});

export default router;
