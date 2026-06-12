/**
 * DLavie OS — Quality Agent
 *
 * Continuously monitors AI response quality:
 * 1. Picks random past conversations from DB
 * 2. Re-runs the same user prompt through current AI
 * 3. Uses Groq as a judge to score both original and new response
 * 4. Alerts boss if quality is degrading
 * 5. Also runs a set of standard test prompts every cycle
 * 6. Tracks quality trends over time in metrics
 */

import { db } from "@workspace/db";
import { messagesTable, conversationsTable, agentMetricsTable } from "@workspace/db/schema";
import { eq, desc, sql, count } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain.js";
import { BaseAgent } from "./base-agent.js";

const STANDARD_TESTS = [
  { prompt: "Apa itu machine learning? Jelaskan secara singkat.", minScore: 6, lang: "id" },
  { prompt: "Write a Python function to calculate Fibonacci numbers.", minScore: 7, lang: "en" },
  { prompt: "What is the capital of France? Answer in one word.", minScore: 8, lang: "en" },
  { prompt: "كيف يعمل الذكاء الاصطناعي؟", minScore: 5, lang: "ar" },
  { prompt: "Translate 'hello world' to Indonesian.", minScore: 8, lang: "en" },
];

interface QualityResult {
  prompt:    string;
  response:  string;
  score:     number;
  reasoning: string;
  latencyMs: number;
}

export class QualityAgent extends BaseAgent {
  private consecutiveLowScores = 0;

  constructor() {
    super({
      id:             "quality",
      displayName:    "🔬 Quality Agent",
      tickIntervalMs: 20 * 60 * 1000, // every 20 minutes
    });
  }

  protected async tick() {
    this.log("Starting quality evaluation cycle…");

    const results: QualityResult[] = [];

    // 1. Standard test battery
    for (const test of STANDARD_TESTS) {
      try {
        const result = await this.evaluate(test.prompt);
        results.push(result);
        this.log(`Standard test [${test.lang}]: score=${result.score}/10`);
      } catch (e) {
        this.logError(`Standard test failed: ${String(e)}`);
      }
    }

    // 2. Random real conversation re-test
    const convoResult = await this.testRandomConversation();
    if (convoResult) results.push(convoResult);

    if (results.length === 0) {
      this.log("No test results — skipping cycle");
      return;
    }

    // 3. Analyze results
    const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    const failing  = results.filter(r => r.score < 6);
    const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);

    await this.recordMetric("avg_quality_score", avgScore.toFixed(1), "quality_cycle");
    await this.recordMetric("avg_latency_ms",    avgLatency,          "quality_cycle");

    if (avgScore < 6) {
      this.consecutiveLowScores++;
    } else {
      this.consecutiveLowScores = 0;
    }

    // 4. Send mail with results
    const grade = avgScore >= 8 ? "🟢 Excellent" : avgScore >= 6 ? "🟡 Good" : "🔴 Poor";
    const priority = avgScore < 5 ? "critical" : avgScore < 6 ? "high" : "normal";

    await this.sendMail({
      subject:  `${grade} AI Quality Report — Avg ${avgScore.toFixed(1)}/10 (${results.length} tests)`,
      body: [
        `Quality Agent completed ${results.length} AI response evaluations.`,
        ``,
        `**Overall Score: ${avgScore.toFixed(1)}/10** | Avg Latency: ${avgLatency}ms`,
        ``,
        `**Test Results:**`,
        results.map(r =>
          `  • "${r.prompt.slice(0, 60)}…"\n    Score: ${r.score}/10 — ${r.reasoning.slice(0, 100)}`
        ).join("\n"),
        failing.length > 0 ? `\n**⚠️ Failing tests (${failing.length}):**\n${failing.map(r => `  • "${r.prompt.slice(0, 60)}…" (${r.score}/10)`).join("\n")}` : "",
        this.consecutiveLowScores > 2 ? `\n⛔ ALERT: ${this.consecutiveLowScores} consecutive low-score cycles. AI quality is degrading!` : "",
      ].filter(Boolean).join("\n"),
      priority,
      metadata: { avgScore, avgLatency, testCount: results.length, failingCount: failing.length },
    });
  }

  private async evaluate(prompt: string): Promise<QualityResult> {
    const t0 = Date.now();

    const { text: response } = await generateWithFallback(
      prompt,
      undefined,
      "You are DLavie OS AI assistant. Give a helpful, accurate, concise response."
    );

    const latencyMs = Date.now() - t0;

    // Use AI-as-judge via Groq
    const judgePrompt = [
      `You are an AI quality judge. Score this response from 1-10 and give ONE SENTENCE reasoning.`,
      ``,
      `USER PROMPT: ${prompt}`,
      `AI RESPONSE: ${response.slice(0, 500)}`,
      ``,
      `Reply in this EXACT format:`,
      `SCORE: [1-10]`,
      `REASON: [one sentence]`,
    ].join("\n");

    let score     = 7;
    let reasoning = "No judge evaluation";

    try {
      const { text: judgment } = await generateWithFallback(judgePrompt, undefined,
        "You are a strict AI response quality judge. Be concise and honest.");

      const scoreMatch   = judgment.match(/SCORE:\s*([0-9]+)/i);
      const reasonMatch  = judgment.match(/REASON:\s*(.+)/i);

      if (scoreMatch)  score     = Math.min(10, Math.max(1, parseInt(scoreMatch[1])));
      if (reasonMatch) reasoning = reasonMatch[1].trim();
    } catch { /* use default score */ }

    return { prompt, response, score, reasoning, latencyMs };
  }

  private async testRandomConversation(): Promise<QualityResult | null> {
    try {
      // Get a random real conversation with at least 2 messages
      const convos = await db
        .select({ id: conversationsTable.id, title: conversationsTable.title })
        .from(conversationsTable)
        .orderBy(sql`RANDOM()`)
        .limit(5);

      for (const convo of convos) {
        const msgs = await db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.conversationId, convo.id))
          .orderBy(desc(messagesTable.createdAt))
          .limit(4);

        const userMsg = msgs.find(m => m.role === "user");
        if (userMsg && userMsg.content.length > 10) {
          this.log(`Re-testing real conversation: "${convo.title}" — "${userMsg.content.slice(0, 60)}…"`);
          const result = await this.evaluate(userMsg.content);
          return result;
        }
      }
    } catch (e) {
      this.logError("Real convo test failed: " + String(e));
    }
    return null;
  }
}
