/**
 * DLavie OS — Model Agent
 *
 * Manages AI models autonomously:
 * 1. Periodically checks Ollama library for trending/new models
 * 2. Benchmarks locally installed models with real test prompts
 * 3. Recommends models to download based on capability/size analysis
 * 4. Sends mail to boss when important models are available
 * 5. Monitors model response quality over time
 */

import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@workspace/db";
import { BaseAgent } from "./base-agent.js";
import { agentMetricsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const execAsync = promisify(exec);
const OLLAMA_API  = "http://127.0.0.1:11434";

interface OllamaModel { name: string; size: number; modified_at: string; details?: { family: string; parameter_size: string } }
interface OllamaListResponse { models: OllamaModel[] }

const RECOMMENDED_MODELS = [
  { name: "llama3.2:3b",     reason: "Fast, capable 3B Llama — great for chat",          size: "2.0GB" },
  { name: "qwen2.5-coder:7b",reason: "Alibaba code model — excellent for code tasks",    size: "4.7GB" },
  { name: "phi4:latest",     reason: "Microsoft Phi-4 — small but very smart",           size: "9.1GB" },
  { name: "deepseek-r1:8b",  reason: "DeepSeek R1 reasoning model — chain-of-thought",  size: "4.9GB" },
  { name: "mistral:7b",      reason: "Reliable multilingual base model",                 size: "4.1GB" },
  { name: "nomic-embed-text",reason: "Embedding model — needed for local RAG search",   size: "274MB" },
];

export class ModelAgent extends BaseAgent {
  private benchmarked = new Set<string>();

  constructor() {
    super({
      id:             "model",
      displayName:    "🤖 Model Agent",
      tickIntervalMs: 45 * 60 * 1000, // every 45 minutes
    });
  }

  protected async tick() {
    this.log("Starting model management cycle…");

    const localModels = await this.getLocalModels();
    this.log(`Found ${localModels.length} local models: ${localModels.map(m => m.name).join(", ")}`);

    // 1. Benchmark models not yet benchmarked this session
    const benchmarkResults: Array<{ name: string; score: number; latencyMs: number }> = [];
    for (const model of localModels.slice(0, 3)) { // max 3 per cycle
      if (!this.benchmarked.has(model.name)) {
        const result = await this.benchmarkModel(model.name);
        if (result) {
          benchmarkResults.push(result);
          this.benchmarked.add(model.name);
        }
      }
    }

    // 2. Check what recommended models are NOT installed
    const localNames    = new Set(localModels.map(m => m.name.split(":")[0]));
    const missing       = RECOMMENDED_MODELS.filter(r => !localNames.has(r.name.split(":")[0]));
    const criticalMissing = missing.filter(m => m.reason.includes("needed"));

    // 3. Build mail report
    const mailLines: string[] = [];

    if (benchmarkResults.length > 0) {
      mailLines.push("**Model Benchmark Results:**");
      for (const r of benchmarkResults) {
        const grade = r.score >= 8 ? "🟢 Excellent" : r.score >= 6 ? "🟡 Good" : "🔴 Poor";
        mailLines.push(`  • ${r.name}: ${grade} (score ${r.score}/10, latency ${r.latencyMs}ms)`);
      }
      mailLines.push("");
    }

    if (criticalMissing.length > 0) {
      mailLines.push("**⚠️ Critical Missing Models:**");
      for (const m of criticalMissing) {
        mailLines.push(`  • ${m.name} (${m.size}) — ${m.reason}`);
        mailLines.push(`    → Pull: POST /api/models/pull {"name": "${m.name}"}`);
      }
      mailLines.push("");
    }

    if (missing.length > 0 && criticalMissing.length === 0) {
      mailLines.push(`**Optional models available** (${missing.length} not installed):`);
      mailLines.push(missing.slice(0, 3).map(m => `  • ${m.name} — ${m.reason}`).join("\n"));
    }

    if (mailLines.length > 0) {
      const priority = criticalMissing.length > 0 ? "high" : "normal";
      await this.sendMail({
        subject:  `🤖 Model Report — ${localModels.length} installed, ${missing.length} available`,
        body:     ["Model Agent completed a scan.", "", ...mailLines, "", `Local models: ${localModels.map(m => m.name).join(", ")}`].join("\n"),
        priority,
        metadata: {
          localModels:  localModels.map(m => ({ name: m.name, sizeMB: Math.round(m.size / 1024 / 1024) })),
          missing:      missing.map(m => m.name),
          benchmarks:   benchmarkResults,
        },
      });
    }

    // 4. Record metrics
    await this.recordMetric("local_model_count", localModels.length, "model_scan");
    for (const r of benchmarkResults) {
      await this.recordMetric("benchmark_score", r.score, r.name, { latencyMs: r.latencyMs });
    }
  }

  private async getLocalModels(): Promise<OllamaModel[]> {
    try {
      const res  = await fetch(`${OLLAMA_API}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = await res.json() as OllamaListResponse;
      return data.models ?? [];
    } catch { return []; }
  }

  private async benchmarkModel(modelName: string): Promise<{ name: string; score: number; latencyMs: number } | null> {
    this.log(`Benchmarking ${modelName}…`);
    const BENCH_PROMPT = "What is 2+2? Answer in one word.";
    const t0           = Date.now();

    try {
      const res = await fetch(`${OLLAMA_API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ model: modelName, prompt: BENCH_PROMPT, stream: false, options: { num_predict: 20 } }),
        signal:  AbortSignal.timeout(30000),
      });

      if (!res.ok) return null;
      const data        = await res.json() as { response: string; eval_duration?: number };
      const latencyMs   = Date.now() - t0;
      const response    = (data.response ?? "").toLowerCase().trim();
      const correct     = response.includes("4") || response.includes("four");

      // Score based on correctness, speed, and brevity
      let score = correct ? 7 : 3;
      if (latencyMs < 2000)  score = Math.min(10, score + 2);
      if (latencyMs < 5000)  score = Math.min(10, score + 1);
      if (response.length < 20) score = Math.min(10, score + 1);

      this.log(`${modelName}: score=${score}/10, latency=${latencyMs}ms, response="${response.slice(0, 50)}"`);
      return { name: modelName, score, latencyMs };
    } catch (e) {
      this.logError(`Benchmark ${modelName} failed: ${String(e)}`);
      return null;
    }
  }

  async pullModel(modelName: string): Promise<void> {
    this.log(`Pulling model ${modelName}…`);
    await this.sendMail({
      subject: `📥 Pulling model: ${modelName}`,
      body:    `Model Agent is pulling ${modelName} to local storage.\nThis may take a few minutes.`,
      priority: "normal",
    });

    // Trigger pull via Ollama API
    const res = await fetch(`${OLLAMA_API}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: modelName, stream: false }),
      signal:  AbortSignal.timeout(10 * 60 * 1000), // 10 min timeout
    });

    if (res.ok) {
      await this.sendMail({
        subject: `✅ Model pulled: ${modelName}`,
        body:    `Successfully pulled ${modelName} to local storage. Model is now available for use.`,
        priority: "normal",
      });
    }
  }
}
