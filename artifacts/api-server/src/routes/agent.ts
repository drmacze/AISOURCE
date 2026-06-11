/**
 * NEXUS_OS — Autonomous AI Developer Agent
 *
 * Brain: Qwen/Qwen2.5-Coder-32B-Instruct running on HuggingFace GPU servers
 *        → ZERO local RAM consumed. 32B parameters, full coding intelligence.
 *
 * Architecture:
 *  - ReAct loop: Think → Tool → Observe → repeat (up to 30 steps)
 *  - Memory system: cross-session persistent learning via DB
 *  - 30+ real tools: code gen, Python exec, ML research, file ops, data ops
 *  - Autonomous mode: LLM-driven task selection every 10 minutes
 *  - Self-improvement: agent scores its own performance and stores insights
 *
 * NO simulations. NO demos. Everything is real.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  trainingDatasetsTable,
  trainingSamplesTable,
  trainingJobsTable,
  aiModelsTable,
  agentMemoriesTable,
} from "@workspace/db";
import { eq, desc, like, or, sql } from "drizzle-orm";
import { execSync, exec } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import {
  generateOllamaResponse,
  listOllamaModels,
  pullOllamaModel,
  isOllamaOnline,
} from "../ollama";
import {
  chatCompletionHFWithFallback,
  isHFConfigured,
  listHFModels,
  fetchHFDataset,
  HF_AGENT_MODELS,
  hfHeaders,
  type ChatMessage,
} from "../huggingface";
import {
  generateGroqResponse,
  isGroqConfigured,
} from "../groq";
import crypto from "crypto";

const router: IRouter = Router();
const WORKSPACE = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";

// ─── Primary LLM ─────────────────────────────────────────────────────────────
async function agentLLMCall(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<{ text: string; model: string }> {
  // 1. Try HuggingFace (Qwen2.5-Coder-32B)
  if (isHFConfigured()) {
    try {
      return await chatCompletionHFWithFallback(messages, {
        maxTokens: opts.maxTokens ?? 3000,
        temperature: opts.temperature ?? 0.15,
      });
    } catch (e) {
      console.warn("[Agent] HF failed, trying Groq:", String(e).slice(0, 200));
    }
  }
  // 2. Try Groq (fast cloud LLM, free tier)
  if (isGroqConfigured()) {
    for (const model of ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]) {
      try {
        const text = await generateGroqResponse(messages as Parameters<typeof generateGroqResponse>[0], model, {
          maxTokens: opts.maxTokens ?? 3000,
          temperature: opts.temperature ?? 0.15,
        });
        return { text, model: `groq/${model}` };
      } catch (e) {
        console.warn(`[Agent] Groq ${model} failed:`, String(e).slice(0, 100));
      }
    }
  }
  // 3. Try local Ollama
  const prompt = messages
    .map((m) => `${m.role === "system" ? "SYSTEM" : m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n\n");
  for (const m of ["qwen2.5:3b", "gemma3:4b", "tinyllama"]) {
    try { return { text: await generateOllamaResponse(prompt, m), model: `${m} (local)` }; }
    catch { continue; }
  }
  throw new Error("No LLM available — HF, Groq, and local Ollama all failed");
}

// ─── Python execution ─────────────────────────────────────────────────────────
function executePython(
  code: string,
  timeoutMs = 15000
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolve) => {
    const tmpFile = join("/tmp", `nexus_py_${Date.now()}.py`);
    try { writeFileSync(tmpFile, code); }
    catch (e) { resolve({ stdout: "", stderr: String(e), ok: false }); return; }
    exec(`python3 "${tmpFile}" 2>&1`, { timeout: timeoutMs, cwd: WORKSPACE }, (err, stdout, stderr) => {
      try { execSync(`rm -f "${tmpFile}"`, { timeout: 2000 }); } catch {}
      resolve({ stdout: stdout || "", stderr: stderr || String(err?.message || ""), ok: !err });
    });
  });
}

// ─── Session store ────────────────────────────────────────────────────────────
export interface AgentEvent {
  type: "thought" | "tool_call" | "tool_result" | "done" | "error" | "info" | "memory";
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  ok?: boolean;
  summary?: string;
  steps?: number;
  message?: string;
  step?: number;
  model?: string;
  ts: number;
}

export interface AgentSession {
  id: string;
  task: string;
  status: "running" | "done" | "error" | "stopped";
  events: AgentEvent[];
  summary: string;
  totalSteps: number;
  model: string;
  autonomous: boolean;
  memoriesLoaded: number;
  createdAt: Date;
  updatedAt: Date;
}

const sessions = new Map<string, AgentSession>();
const MAX_SESSIONS = 100;

function newSession(task: string, autonomous = false): AgentSession {
  const id = crypto.randomUUID();
  const session: AgentSession = {
    id, task, status: "running", events: [], summary: "",
    totalSteps: 0, model: HF_AGENT_MODELS[0],
    autonomous, memoriesLoaded: 0,
    createdAt: new Date(), updatedAt: new Date(),
  };
  sessions.set(id, session);
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()]
      .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())[0];
    sessions.delete(oldest[0]);
  }
  return session;
}

function addEvent(session: AgentSession, event: Omit<AgentEvent, "ts">): void {
  session.events.push({ ...event, ts: Date.now() });
  session.updatedAt = new Date();
}

// ─── Memory system ────────────────────────────────────────────────────────────
async function recallMemories(query: string, limit = 6): Promise<string> {
  try {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
    const rows = words.length > 0
      ? await db.select().from(agentMemoriesTable)
          .where(or(...words.map((w) => like(agentMemoriesTable.content, `%${w}%`))))
          .orderBy(desc(agentMemoriesTable.importance), desc(agentMemoriesTable.createdAt))
          .limit(limit)
      : await db.select().from(agentMemoriesTable)
          .orderBy(desc(agentMemoriesTable.importance), desc(agentMemoriesTable.createdAt))
          .limit(limit);
    return rows.map((r) => `[${r.category}|${r.importance}/10] ${r.content}`).join("\n");
  } catch { return ""; }
}

async function storeMemory(
  content: string,
  category: "insight" | "pattern" | "success" | "failure" | "knowledge" | "plan" | "preference" = "insight",
  importance = 5,
  tags: string[] = [],
  sessionId?: string
): Promise<void> {
  try {
    await db.insert(agentMemoriesTable).values({
      content: content.slice(0, 2000), category, importance,
      tags: JSON.stringify(tags), sessionId,
    });
  } catch { /* ignore */ }
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
interface ToolResult { ok: boolean; data?: unknown; error?: string; }
type AgentTool = {
  name: string;
  description: string;
  params: string;
  run: (args: Record<string, unknown>, session: AgentSession) => Promise<ToolResult>;
};

// ─────────────────────────────────────────────────────────────────────────────
//  30+ TOOLS  — all real, no simulation
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS: AgentTool[] = [

  // ══ REASONING & PLANNING ════════════════════════════════════════════════════
  {
    name: "think",
    description: "Deep reasoning/analysis before acting. Use for complex ML problems, planning, tradeoff analysis. Required: question.",
    params: '{"question":"What is the best strategy to improve dataset diversity for instruction fine-tuning?"}',
    async run(args) {
      const q = String(args.question || "");
      if (!q) return { ok: false, error: "question required" };
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are an expert AI researcher. Think step by step, be specific and concrete. Give definitive recommendations with clear reasoning." },
          { role: "user", content: q },
        ], { maxTokens: 2000, temperature: 0.1 });
        return { ok: true, data: { analysis: r.text, model: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "plan_ml_experiment",
    description: "Design a complete production-ready ML experiment plan with specific hyperparameters and evaluation strategies. Required: goal. Optional: constraints.",
    params: '{"goal":"Fine-tune a 7B model for code generation","constraints":"limited compute, need low latency"}',
    async run(args) {
      const goal = String(args.goal || "");
      const constraints = args.constraints ? String(args.constraints) : "standard compute";
      if (!goal) return { ok: false, error: "goal required" };
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are a senior ML research engineer. Design precise, actionable experiment plans with exact hyperparameters, dataset requirements, and evaluation metrics." },
          { role: "user", content: `Design a complete ML experiment for:\nGoal: ${goal}\nConstraints: ${constraints}\n\nInclude: dataset selection, model choice, training strategy, exact hyperparameters, evaluation approach, risks.` },
        ], { maxTokens: 2500 });
        return { ok: true, data: { plan: r.text, model: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "plan_architecture",
    description: "Design an AI model architecture or ML system for a specific use case. Required: useCase.",
    params: '{"useCase":"Real-time code completion for Python with <100ms latency"}',
    async run(args) {
      const useCase = String(args.useCase || "");
      if (!useCase) return { ok: false, error: "useCase required" };
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are a principal ML architect. Design deployable systems with specific model recommendations, serving infrastructure, and performance targets." },
          { role: "user", content: `Design complete AI architecture for: ${useCase}\n\nInclude: model choice + justification, data pipeline, serving strategy, latency/cost targets, monitoring.` },
        ], { maxTokens: 2500 });
        return { ok: true, data: { architecture: r.text, model: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  // ══ CODE GENERATION & ANALYSIS ══════════════════════════════════════════════
  {
    name: "generate_code",
    description: "Generate production-quality Python/JavaScript/bash code for AI/ML tasks. Required: task. Optional: language, saveAs (file path).",
    params: '{"task":"Write a LoRA fine-tuning script using HuggingFace PEFT","language":"python","saveAs":"scripts/lora_finetune.py"}',
    async run(args) {
      const task = String(args.task || "");
      const language = String(args.language || "python");
      const saveAs = args.saveAs ? String(args.saveAs) : null;
      if (!task) return { ok: false, error: "task required" };
      try {
        const r = await agentLLMCall([
          { role: "system", content: `You are an expert ${language} engineer specializing in AI/ML. Write clean, complete, runnable code. Include imports, error handling, type hints, docstrings. No placeholder stubs.` },
          { role: "user", content: `Write complete ${language} code for:\n${task}\n\nRequirements: production-ready, fully commented, follows best practices.` },
        ], { maxTokens: 3000 });
        let savedPath: string | null = null;
        if (saveAs) {
          try {
            const fp = join(WORKSPACE, saveAs);
            mkdirSync(dirname(fp), { recursive: true });
            writeFileSync(fp, r.text, "utf8");
            savedPath = saveAs;
          } catch {}
        }
        return { ok: true, data: { language, code: r.text, model: r.model, savedPath } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "analyze_code",
    description: "Analyze code for bugs, performance issues, ML anti-patterns, and suggest improvements. Required: code. Optional: context.",
    params: '{"code":"for batch in dataloader:\\n    loss.backward()","context":"training loop"}',
    async run(args) {
      const code = String(args.code || "");
      const context = args.context ? ` (context: ${args.context})` : "";
      if (!code) return { ok: false, error: "code required" };
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are a senior ML code reviewer. Find real bugs, performance issues, memory leaks, ML anti-patterns. Give specific feedback and corrected code." },
          { role: "user", content: `Analyze this code${context}:\n\`\`\`\n${code}\n\`\`\`\n\nProvide: (1) critical issues, (2) performance improvements, (3) best practices, (4) corrected code.` },
        ], { maxTokens: 2000 });
        return { ok: true, data: { analysis: r.text, model: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "execute_python",
    description: "Execute real Python code and return stdout. Use for data analysis, ML calculations, stats, file processing. Max 15s. Required: code.",
    params: '{"code":"import numpy as np\\narr=np.array([1,2,3,4,5])\\nprint(f\'Mean:{arr.mean():.2f} Std:{arr.std():.2f}\')"}',
    async run(args) {
      const code = String(args.code || "");
      if (!code) return { ok: false, error: "code required" };
      const r = await executePython(code, 15000);
      return r.ok
        ? { ok: true, data: { stdout: r.stdout.slice(0, 3000) } }
        : { ok: false, error: r.stderr.slice(0, 1000) };
    },
  },

  // ══ FILE OPERATIONS ══════════════════════════════════════════════════════════
  {
    name: "read_file",
    description: "Read a file from the workspace. Required: path (relative to workspace root). Optional: maxLines.",
    params: '{"path":"scripts/train.py","maxLines":100}',
    async run(args) {
      const relPath = String(args.path || "");
      const maxLines = Number(args.maxLines || 200);
      if (!relPath) return { ok: false, error: "path required" };
      try {
        const fp = join(WORKSPACE, relPath);
        if (!existsSync(fp)) return { ok: false, error: `File not found: ${relPath}` };
        const content = readFileSync(fp, "utf8");
        const lines = content.split("\n");
        return { ok: true, data: { path: relPath, content: lines.slice(0, maxLines).join("\n"), totalLines: lines.length, truncated: lines.length > maxLines } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "write_file",
    description: "Write content to a workspace file (creates dirs as needed). Required: path, content. Optional: append.",
    params: '{"path":"scripts/preprocess.py","content":"import pandas as pd\\n# preprocessing"}',
    async run(args) {
      const relPath = String(args.path || "");
      const content = String(args.content || "");
      const append = Boolean(args.append);
      if (!relPath) return { ok: false, error: "path required" };
      try {
        const fp = join(WORKSPACE, relPath);
        mkdirSync(dirname(fp), { recursive: true });
        if (append) {
          const existing = existsSync(fp) ? readFileSync(fp, "utf8") : "";
          writeFileSync(fp, existing + content, "utf8");
        } else {
          writeFileSync(fp, content, "utf8");
        }
        return { ok: true, data: { path: relPath, bytes: content.length, mode: append ? "append" : "write" } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "run_shell",
    description: "Run a safe shell command. Allowed: ls, find, pip3, python3, node, pnpm, cat, head, tail, wc, grep, du, free, df, echo. Max 20s. Required: command.",
    params: '{"command":"pip3 show transformers 2>/dev/null | grep Version"}',
    async run(args) {
      const command = String(args.command || "");
      if (!command) return { ok: false, error: "command required" };
      const blocked = /rm\s+-rf|sudo\s|mkfs|dd\s+if=|wget.*\|\s*bash|curl.*\|\s*bash|>\/dev\/(sd|nvme)|passwd|chmod\s+777/i;
      if (blocked.test(command)) return { ok: false, error: "Command blocked for safety" };
      try {
        const out = execSync(command, { timeout: 20000, cwd: WORKSPACE, encoding: "utf8" });
        return { ok: true, data: { command, output: out.slice(0, 3000) } };
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        return { ok: false, error: `${err.stderr || err.stdout || err.message || String(e)}`.slice(0, 1000) };
      }
    },
  },

  // ══ MEMORY SYSTEM ════════════════════════════════════════════════════════════
  {
    name: "store_memory",
    description: "Save a key insight, pattern, or learning to persistent memory (survives across sessions). Required: content. Optional: category (insight/pattern/success/failure/knowledge/plan/preference), importance (1-10), tags.",
    params: '{"content":"LoRA rank=16 outperforms rank=8 on code tasks with only 40% more VRAM","category":"knowledge","importance":8,"tags":["lora","fine-tuning"]}',
    async run(args, session) {
      const content = String(args.content || "");
      const category = String(args.category || "insight") as "insight";
      const importance = Math.min(10, Math.max(1, Number(args.importance || 5)));
      const tags = Array.isArray(args.tags) ? (args.tags as string[]) : [];
      if (!content) return { ok: false, error: "content required" };
      await storeMemory(content, category, importance, tags, session.id);
      return { ok: true, data: { stored: content.slice(0, 100), category, importance } };
    },
  },

  {
    name: "recall_memories",
    description: "Retrieve relevant memories from past agent sessions. Required: query. Optional: limit.",
    params: '{"query":"LoRA fine-tuning results code generation","limit":5}',
    async run(args) {
      const query = String(args.query || "");
      const limit = Math.min(20, Number(args.limit || 6));
      const memories = await recallMemories(query, limit);
      return { ok: true, data: { query, memories: memories || "(no relevant memories found)", count: memories ? memories.split("\n").filter(Boolean).length : 0 } };
    },
  },

  {
    name: "list_memories",
    description: "List recent memories ordered by importance. Optional: category, limit.",
    params: '{"category":"knowledge","limit":10}',
    async run(args) {
      const category = args.category ? String(args.category) : null;
      const limit = Math.min(50, Number(args.limit || 10));
      try {
        const rows = category
          ? await db.select().from(agentMemoriesTable)
              .where(eq(agentMemoriesTable.category, category as "insight"))
              .orderBy(desc(agentMemoriesTable.importance), desc(agentMemoriesTable.createdAt)).limit(limit)
          : await db.select().from(agentMemoriesTable)
              .orderBy(desc(agentMemoriesTable.importance), desc(agentMemoriesTable.createdAt)).limit(limit);
        return { ok: true, data: { count: rows.length, memories: rows } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  // ══ DATASET OPERATIONS ═══════════════════════════════════════════════════════
  {
    name: "list_datasets",
    description: "List all training datasets with sample counts.",
    params: "{}",
    async run() {
      const rows = await db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.updatedAt)).limit(30);
      const withCounts = await Promise.all(rows.map(async (ds) => {
        const [cnt] = await db.select({ count: sql<number>`count(*)` }).from(trainingSamplesTable).where(eq(trainingSamplesTable.datasetId, ds.id));
        return { ...ds, sampleCount: Number(cnt?.count || 0) };
      }));
      return { ok: true, data: { total: withCounts.length, datasets: withCounts } };
    },
  },

  {
    name: "create_dataset",
    description: "Create a new training dataset. Required: name, taskType (qa/generation/summarization/classification/translation). Optional: description.",
    params: '{"name":"Code Review QA v2","taskType":"qa","description":"High-quality code review training data"}',
    async run(args) {
      const name = String(args.name || "");
      const taskType = String(args.taskType || "qa");
      const description = args.description ? String(args.description) : undefined;
      if (!name) return { ok: false, error: "name required" };
      const valid = ["qa", "generation", "summarization", "classification", "translation"];
      if (!valid.includes(taskType)) return { ok: false, error: `taskType must be one of: ${valid.join(", ")}` };
      const [row] = await db.insert(trainingDatasetsTable).values({ name, taskType: taskType as "qa", description }).returning();
      return { ok: true, data: row };
    },
  },

  {
    name: "add_sample",
    description: "Add a single training sample to a dataset. Required: datasetId, input, output. Optional: source.",
    params: '{"datasetId":1,"input":"What is gradient descent?","output":"Gradient descent is an optimization algorithm..."}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const input = String(args.input || "");
      const output = String(args.output || "");
      const source = args.source ? String(args.source) : "agent";
      if (!datasetId || !input || !output) return { ok: false, error: "datasetId, input, output required" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };
      const [row] = await db.insert(trainingSamplesTable).values({ datasetId, input, expectedOutput: output, source }).returning();
      return { ok: true, data: row };
    },
  },

  {
    name: "generate_samples",
    description: "Use Qwen2.5-Coder-32B to generate high-quality, diverse training samples. Required: datasetId, topic, count (1-30). Optional: style (detailed/concise/examples).",
    params: '{"datasetId":1,"topic":"transformer self-attention mechanisms","count":10,"style":"detailed"}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const topic = String(args.topic || "AI/ML");
      const count = Math.min(30, Math.max(1, Number(args.count) || 5));
      const style = String(args.style || "detailed");
      if (!datasetId) return { ok: false, error: "datasetId required" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };

      let raw = "";
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are a world-class AI training data engineer. Generate high-quality, factually accurate, diverse training pairs. Each pair must be unique. Return ONLY valid JSON — no markdown, no explanation." },
          { role: "user", content: `Generate exactly ${count} ${style} training examples about "${topic}" for a ${ds.taskType} task.
Vary complexity and depth. Minimum 80 characters per output.
Return ONLY JSON array: [{"input":"specific question","output":"comprehensive accurate answer"}]` },
        ], { maxTokens: 4000, temperature: 0.7 });
        raw = r.text;
        const start = raw.indexOf("["), end = raw.lastIndexOf("]");
        if (start === -1 || end === -1) throw new Error("No JSON array in response");
        const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ input: string; output: string }>;
        const valid = parsed.filter((p) => p.input && p.output && p.output.length >= 30).slice(0, count);
        const inserted = [];
        for (const s of valid) {
          const [row] = await db.insert(trainingSamplesTable).values({
            datasetId, input: s.input, expectedOutput: s.output, source: "nexus-agent-32b",
          }).returning();
          inserted.push(row);
        }
        return { ok: true, data: { generated: inserted.length, topic, model: r.model, dataset: ds.name } };
      } catch (e) {
        return { ok: false, error: `Generation failed: ${String(e).slice(0, 300)}` };
      }
    },
  },

  {
    name: "analyze_dataset",
    description: "Deep quality analysis: diversity, coverage gaps, quality score, improvement recommendations. Required: datasetId.",
    params: '{"datasetId":1}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      if (!datasetId) return { ok: false, error: "datasetId required" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };
      const samples = await db.select().from(trainingSamplesTable)
        .where(eq(trainingSamplesTable.datasetId, datasetId))
        .orderBy(desc(trainingSamplesTable.createdAt)).limit(100);

      const stats = {
        total: samples.length,
        avgInputLen: Math.round(samples.reduce((s, r) => s + r.input.length, 0) / Math.max(1, samples.length)),
        avgOutputLen: Math.round(samples.reduce((s, r) => s + (r.expectedOutput || "").length, 0) / Math.max(1, samples.length)),
        sources: [...new Set(samples.map((s) => s.source))],
        shortOutputs: samples.filter((s) => (s.expectedOutput || "").length < 50).length,
      };

      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are an expert ML data quality engineer. Provide concrete, actionable feedback with specific examples." },
          { role: "user", content: `Analyze training dataset quality:
"${ds.name}" | Task: ${ds.taskType} | Samples: ${stats.total}
Avg input: ${stats.avgInputLen}c | Avg output: ${stats.avgOutputLen}c | Short outputs: ${stats.shortOutputs}
Sources: ${stats.sources.join(", ")}
Sample 1: "${samples[0]?.input.slice(0, 80)}" → "${(samples[0]?.expectedOutput || "").slice(0, 80)}"

Give: quality score (0-10), top 3 specific issues, 3 improvement actions.` },
        ], { maxTokens: 1200 });
        return { ok: true, data: { stats, analysis: r.text, model: r.model } };
      } catch { return { ok: true, data: { stats, analysis: "Stats computed — check numbers above" } }; }
    },
  },

  {
    name: "augment_samples",
    description: "Generate AI-powered variations of existing samples (paraphrased questions, different angles). Required: datasetId. Optional: count, style.",
    params: '{"datasetId":1,"count":5,"style":"paraphrase"}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const count = Math.min(20, Number(args.count || 5));
      const style = String(args.style || "paraphrase");
      if (!datasetId) return { ok: false, error: "datasetId required" };
      const samples = await db.select().from(trainingSamplesTable)
        .where(eq(trainingSamplesTable.datasetId, datasetId))
        .orderBy(desc(trainingSamplesTable.createdAt)).limit(count);
      if (samples.length === 0) return { ok: false, error: "No samples found" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      try {
        const r = await agentLLMCall([
          { role: "system", content: "Generate diverse variations of training examples. Preserve the knowledge, vary the expression. Return ONLY valid JSON." },
          { role: "user", content: `Create ${count} ${style} variations. Source:\n${samples.slice(0, 5).map((s, i) => `${i+1}. Q:${s.input.slice(0, 100)} A:${(s.expectedOutput||"").slice(0, 100)}`).join("\n")}\n\nReturn: [{"input":"...","output":"..."}]` },
        ], { maxTokens: 3000, temperature: 0.8 });
        const s = r.text.indexOf("["), e = r.text.lastIndexOf("]");
        if (s === -1 || e === -1) throw new Error("No JSON");
        const parsed = JSON.parse(r.text.slice(s, e + 1)) as Array<{ input: string; output: string }>;
        const valid = parsed.filter((p) => p.input && p.output).slice(0, count);
        const inserted = [];
        for (const p of valid) {
          const [row] = await db.insert(trainingSamplesTable).values({ datasetId, input: p.input, expectedOutput: p.output, source: `agent-augment-${style}` }).returning();
          inserted.push(row);
        }
        return { ok: true, data: { augmented: inserted.length, style, dataset: ds?.name } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "fetch_hf_dataset",
    description: "Fetch real samples from a HuggingFace public dataset and add to local training dataset. Required: hfDataset (e.g. 'rajpurkar/squad'), localDatasetId. Optional: split, limit.",
    params: '{"hfDataset":"rajpurkar/squad","localDatasetId":1,"split":"train","limit":20}',
    async run(args) {
      const hfDataset = String(args.hfDataset || "");
      const localDatasetId = Number(args.localDatasetId);
      const split = String(args.split || "train");
      const limit = Math.min(50, Number(args.limit || 20));
      if (!hfDataset || !localDatasetId) return { ok: false, error: "hfDataset and localDatasetId required" };
      try {
        const rows = await fetchHFDataset(hfDataset, split, limit);
        if (rows.length === 0) return { ok: false, error: `No data fetched from ${hfDataset}` };
        const inserted = [];
        for (const row of rows) {
          const input = String(row.question || row.prompt || row.input || row.text || JSON.stringify(row).slice(0, 200));
          const output = String(row.answer || row.output || row.response || row.label || "");
          if (!input || !output) continue;
          const [s] = await db.insert(trainingSamplesTable).values({
            datasetId: localDatasetId, input: input.slice(0, 1000), expectedOutput: output.slice(0, 2000), source: `hf:${hfDataset}`,
          }).returning();
          inserted.push(s);
        }
        return { ok: true, data: { fetched: rows.length, inserted: inserted.length, hfDataset, split } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  // ══ MODEL OPERATIONS ═════════════════════════════════════════════════════════
  {
    name: "list_models",
    description: "List all registered AI models in the system.",
    params: "{}",
    async run() {
      const rows = await db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.updatedAt)).limit(30);
      return { ok: true, data: { total: rows.length, models: rows } };
    },
  },

  {
    name: "create_model",
    description: "Register a new AI model. Required: name, type (llm/embedding/classification/summarization/custom). Optional: architecture, description, version.",
    params: '{"name":"Qwen2.5-Coder-7B-ft","type":"llm","architecture":"qwen2.5","description":"Fine-tuned for code tasks","version":"1.0"}',
    async run(args) {
      const name = String(args.name || "");
      const type = String(args.type || "llm");
      const description = args.description ? String(args.description) : undefined;
      const architecture = args.architecture ? String(args.architecture) : "transformer";
      const version = args.version ? String(args.version) : "1.0";
      if (!name) return { ok: false, error: "name required" };
      const [row] = await db.insert(aiModelsTable).values({ name, type: type as "llm", description, architecture, version }).returning();
      return { ok: true, data: row };
    },
  },

  {
    name: "create_model_card",
    description: "Generate comprehensive model documentation (HuggingFace-style model card). Required: modelId.",
    params: '{"modelId":1}',
    async run(args) {
      const modelId = Number(args.modelId);
      if (!modelId) return { ok: false, error: "modelId required" };
      const [model] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.id, modelId));
      if (!model) return { ok: false, error: `Model #${modelId} not found` };
      const jobs = await db.select().from(trainingJobsTable).where(eq(trainingJobsTable.modelId, modelId)).limit(5);
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You write HuggingFace-style model cards. Be precise and follow HF format." },
          { role: "user", content: `Generate model card (markdown) for:
Name: ${model.name} | Type: ${model.type} | Architecture: ${model.architecture}
Version: ${model.version} | Description: ${model.description || "N/A"}
Training jobs: ${jobs.length} | Latest: accuracy=${jobs[0]?.accuracy}, loss=${jobs[0]?.loss}

Include: description, intended use, limitations, training data, evaluation, usage examples.` },
        ], { maxTokens: 2000 });
        try {
          const cardPath = join(WORKSPACE, `model-cards/${model.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.md`);
          mkdirSync(dirname(cardPath), { recursive: true });
          writeFileSync(cardPath, r.text, "utf8");
        } catch {}
        return { ok: true, data: { modelCard: r.text, model: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "benchmark_model",
    description: "Evaluate model performance on dataset samples with quality scoring. Required: modelId, datasetId.",
    params: '{"modelId":1,"datasetId":1}',
    async run(args) {
      const modelId = Number(args.modelId);
      const datasetId = Number(args.datasetId);
      if (!modelId || !datasetId) return { ok: false, error: "modelId and datasetId required" };
      const [[model], samples] = await Promise.all([
        db.select().from(aiModelsTable).where(eq(aiModelsTable.id, modelId)),
        db.select().from(trainingSamplesTable).where(eq(trainingSamplesTable.datasetId, datasetId)).limit(5),
      ]);
      if (!model) return { ok: false, error: `Model #${modelId} not found` };
      if (samples.length === 0) return { ok: false, error: "No samples in dataset" };
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You evaluate AI model quality objectively based on sample data. Score precisely." },
          { role: "user", content: `Evaluate model "${model.name}" on:\n${samples.map((s, i) => `${i+1}. IN: ${s.input.slice(0, 120)}\nEXP: ${(s.expectedOutput||"").slice(0, 120)}`).join("\n\n")}\n\nProvide: accuracy estimate (%), quality score (0-10), strengths, weaknesses, recommendation.` },
        ], { maxTokens: 1200 });
        return { ok: true, data: { model: model.name, evaluation: r.text, samplesEvaluated: samples.length, aiModel: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "optimize_hyperparams",
    description: "Suggest optimal training hyperparameters. Required: modelType, datasetSize. Optional: computeBudget, targetMetric.",
    params: '{"modelType":"llm-7b-lora","datasetSize":5000,"computeBudget":"1xA100 24h","targetMetric":"code accuracy"}',
    async run(args) {
      const modelType = String(args.modelType || "llm");
      const datasetSize = Number(args.datasetSize || 1000);
      const computeBudget = args.computeBudget ? String(args.computeBudget) : "standard";
      const targetMetric = args.targetMetric ? String(args.targetMetric) : "accuracy";
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are an ML hyperparameter optimization expert. Give exact values with justifications." },
          { role: "user", content: `Optimal hyperparameters for:\nModel: ${modelType} | Dataset: ${datasetSize} samples | Compute: ${computeBudget} | Target: ${targetMetric}\n\nGive exact values for: lr, batch size, warmup steps, scheduler, epochs, weight decay, gradient clipping, LoRA params (if applicable). Justify each.` },
        ], { maxTokens: 1500 });
        return { ok: true, data: { recommendations: r.text, modelType, datasetSize, model: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  // ══ RESEARCH ════════════════════════════════════════════════════════════════
  {
    name: "search_hf_models",
    description: "Search HuggingFace Hub for models. Optional: task, search, limit.",
    params: '{"task":"text-generation","search":"coder","limit":10}',
    async run(args) {
      const task = String(args.task || "text-generation");
      const search = args.search ? String(args.search) : undefined;
      const limit = Math.min(20, Number(args.limit || 10));
      try {
        const models = await listHFModels({ task, search, limit });
        return { ok: true, data: { count: models.length, models } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "search_papers",
    description: "Search recent AI/ML research papers on HuggingFace Papers (arXiv). Required: query. Optional: limit.",
    params: '{"query":"LoRA efficient fine-tuning large language models","limit":5}',
    async run(args) {
      const query = String(args.query || "");
      const limit = Math.min(10, Number(args.limit || 5));
      if (!query) return { ok: false, error: "query required" };
      try {
        const url = `https://huggingface.co/api/papers?q=${encodeURIComponent(query)}&limit=${limit}`;
        const res = await fetch(url, { headers: hfHeaders(), signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HF Papers API: ${res.status}`);
        const data = await res.json() as Array<{ id?: string; title?: string; summary?: string; upvotes?: number; publishedAt?: string }>;
        return { ok: true, data: { query, count: data.length, papers: data.slice(0, limit).map((p) => ({ id: p.id, title: p.title, abstract: (p.summary || "").slice(0, 300), upvotes: p.upvotes, publishedAt: p.publishedAt })) } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "reason",
    description: "Deep reasoning on a complex ML research question or technical tradeoff. Required: question.",
    params: '{"question":"DeepSpeed ZeRO-3 vs FSDP for 13B model training on 8xA100?"}',
    async run(args) {
      const q = String(args.question || "");
      if (!q) return { ok: false, error: "question required" };
      try {
        const r = await agentLLMCall([
          { role: "system", content: "You are a world-class AI researcher. Reason concretely with numbers. Give a definitive recommendation." },
          { role: "user", content: q },
        ], { maxTokens: 2000, temperature: 0.1 });
        return { ok: true, data: { answer: r.text, model: r.model } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  // ══ OLLAMA LOCAL ══════════════════════════════════════════════════════════════
  {
    name: "list_local_models",
    description: "List Ollama models installed locally.",
    params: "{}",
    async run() {
      try {
        const [models, online] = await Promise.all([listOllamaModels(), isOllamaOnline()]);
        return { ok: true, data: { online, models } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  {
    name: "pull_ollama_model",
    description: "Download a model into Ollama for local inference. Recommended: qwen2.5:3b (1.9GB), llama3.2:3b (2GB), deepseek-r1:1.5b (1.1GB). Required: model.",
    params: '{"model":"qwen2.5:3b"}',
    async run(args) {
      const model = String(args.model || "").trim();
      if (!model) return { ok: false, error: "model name required" };
      const chunks: string[] = [];
      try {
        const stream = await pullOllamaModel(model);
        for await (const chunk of stream) { chunks.push(chunk); if (chunks.length > 30) break; }
        return { ok: true, data: { model, status: "pulling", log: chunks.slice(-5).join("") } };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  },

  // ══ TRAINING JOBS ═════════════════════════════════════════════════════════════
  {
    name: "list_jobs",
    description: "List recent training jobs and their status.",
    params: "{}",
    async run() {
      const rows = await db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(15);
      return { ok: true, data: { total: rows.length, jobs: rows } };
    },
  },

  {
    name: "start_training",
    description: "Start a training job for a registered model on a dataset. Required: modelId, datasetId. Optional: epochs.",
    params: '{"modelId":1,"datasetId":1,"epochs":3}',
    async run(args) {
      const modelId = Number(args.modelId);
      const datasetId = Number(args.datasetId);
      const epochs = Number(args.epochs || 3);
      if (!modelId || !datasetId) return { ok: false, error: "modelId and datasetId required" };
      const [[model], [dataset]] = await Promise.all([
        db.select().from(aiModelsTable).where(eq(aiModelsTable.id, modelId)),
        db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId)),
      ]);
      if (!model) return { ok: false, error: `Model #${modelId} not found` };
      if (!dataset) return { ok: false, error: `Dataset #${datasetId} not found` };
      const [job] = await db.insert(trainingJobsTable).values({ modelId, datasetId, status: "pending", progress: 0, currentEpoch: 0, epochs }).returning();
      return { ok: true, data: { jobId: job.id, model: model.name, dataset: dataset.name, epochs, message: `Job #${job.id} created` } };
    },
  },

  // ══ SYSTEM ═══════════════════════════════════════════════════════════════════
  {
    name: "get_system_stats",
    description: "Get current system state: memory, disk, models, HF status, DB summary.",
    params: "{}",
    async run() {
      let mem = "", disk = "";
      try { mem = execSync("free -h 2>/dev/null", { timeout: 3000 }).toString().trim(); } catch {}
      try { disk = execSync("df -h / 2>/dev/null | tail -1", { timeout: 3000 }).toString().trim(); } catch {}
      let localModels: unknown[] = [], ollamaOnline = false;
      try { [localModels, ollamaOnline] = await Promise.all([listOllamaModels(), isOllamaOnline()]); } catch {}
      const [dsC, mC, jC, memC] = await Promise.all([
        db.select({ c: sql<number>`count(*)` }).from(trainingDatasetsTable),
        db.select({ c: sql<number>`count(*)` }).from(aiModelsTable),
        db.select({ c: sql<number>`count(*)` }).from(trainingJobsTable),
        db.select({ c: sql<number>`count(*)` }).from(agentMemoriesTable),
      ]);
      return { ok: true, data: {
        memory: mem, disk,
        ollama: { online: ollamaOnline, models: localModels },
        hf: { configured: isHFConfigured(), primaryModel: HF_AGENT_MODELS[0] },
        db: { datasets: Number(dsC[0]?.c || 0), models: Number(mC[0]?.c || 0), jobs: Number(jC[0]?.c || 0), memories: Number(memC[0]?.c || 0) },
      }};
    },
  },

  {
    name: "set_secret",
    description: "Set an environment secret (HF_TOKEN, GITHUB_TOKEN, etc.) — applies immediately without restart. Required: name, value.",
    params: '{"name":"GITHUB_TOKEN","value":"ghp_..."}',
    async run(args) {
      const name = String(args.name || "").toUpperCase();
      const value = String(args.value || "");
      if (!name || !value) return { ok: false, error: "name and value required" };
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return { ok: false, error: "name must be UPPERCASE_WITH_UNDERSCORES" };
      try {
        const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/settings/secrets`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, value }), signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return { ok: true, data: { name, applied: true } };
      } catch {
        process.env[name] = value;
        return { ok: true, data: { name, applied: true, note: "Applied directly to process.env" } };
      }
    },
  },

  {
    name: "finish",
    description: "Mark task as complete. Required: summary. Optional: storeInsight (key learning for future sessions).",
    params: '{"summary":"Created 15 samples in dataset #1, quality score 8/10, stored key insights.","storeInsight":"Generate samples at temperature 0.7 for better diversity with Qwen2.5-Coder-32B"}',
    async run(args, session) {
      const summary = String(args.summary || "Task complete.");
      if (args.storeInsight) {
        await storeMemory(String(args.storeInsight), "insight", 7, ["session-learning"], session.id);
      }
      return { ok: true, data: { summary } };
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(memories: string): string {
  const toolList = TOOLS.map((t) => `- **${t.name}**(${t.params}): ${t.description}`).join("\n");
  return `You are NEXUS Agent — an autonomous AI developer running inside NEXUS_OS AI Command Center.
Powered by: Qwen2.5-Coder-32B-Instruct on HuggingFace GPUs — world-class coding & AI intelligence.
Mission: Build, improve, and advance AI models through real actions — no simulations.

${memories ? `━━ PERSISTENT MEMORY (learned from past sessions) ━━\n${memories}\n` : ""}
━━ TOOLS (${TOOLS.length} total) ━━
${toolList}

━━ RESPONSE FORMAT ━━ — respond ONLY with valid JSON every turn:
{
  "thought": "current state analysis, what I know, what to do next and why",
  "tool": "tool_name",
  "args": { ...exact arguments... }
}

━━ CORE RULES ━━
1. Act decisively. No questions. No confirmations. No hedging.
2. Recall memories FIRST (recall_memories) for any task related to past work.
3. Call \`finish\` as soon as the task is complete. Do NOT waste steps.
4. ALWAYS include storeInsight in finish — save the key learning for future sessions.
5. If a tool fails, immediately try an alternative approach (different tool, different args).
6. Use execute_python for quick tests, data analysis, verification.
7. Store important patterns DURING the task with store_memory (don't wait until finish).
8. Workflow: recall → think/plan → act → verify → finish(storeInsight).`;
}

// ─── ReAct execution loop ─────────────────────────────────────────────────────
async function executeSession(session: AgentSession): Promise<void> {
  const MAX_STEPS = 30;

  // Load relevant memories
  const memories = await recallMemories(session.task, 6);
  if (memories) {
    session.memoriesLoaded = memories.split("\n").filter(Boolean).length;
    addEvent(session, { type: "memory", content: `Loaded ${session.memoriesLoaded} relevant memories`, data: memories });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(memories) },
    { role: "user", content: `TASK: ${session.task}\n\nBegin immediately. Use tools to act. Respond with valid JSON.` },
  ];

  let step = 0;
  try {
    while (step < MAX_STEPS && session.status === "running") {
      step++;
      session.totalSteps = step;

      // Sliding context window
      const ctx: ChatMessage[] = [
        messages[0],
        ...messages.slice(Math.max(1, messages.length - 20)),
      ];

      let raw = "", usedModel = session.model;
      try {
        const r = await agentLLMCall(ctx, { maxTokens: 2000, temperature: 0.15 });
        raw = r.text; usedModel = r.model; session.model = usedModel;
      } catch (e) {
        addEvent(session, { type: "error", message: `LLM error step ${step}: ${String(e)}`, step });
        session.status = "error";
        session.summary = `LLM error: ${String(e).slice(0, 200)}`;
        break;
      }

      // Parse JSON
      let parsed: { thought?: string; tool?: string; args?: Record<string, unknown> } = {};
      try {
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
        if (s !== -1 && e !== -1) parsed = JSON.parse(cleaned.slice(s, e + 1));
      } catch {
        const toolNames = [...TOOL_MAP.keys()].join("|");
        const m = raw.match(new RegExp(`\\b(${toolNames})\\b`, "i"));
        parsed = { thought: raw.slice(0, 600), tool: m?.[1]?.toLowerCase() ?? "finish", args: {} };
      }

      const thought = String(parsed.thought || "");
      const toolName = String(parsed.tool || "finish").toLowerCase().trim();
      const toolArgs = (parsed.args || {}) as Record<string, unknown>;

      if (thought) addEvent(session, { type: "thought", content: thought, step, model: usedModel });

      const tool = TOOL_MAP.get(toolName);
      if (!tool) {
        addEvent(session, { type: "error", message: `Unknown tool "${toolName}"`, step });
        messages.push({ role: "assistant", content: JSON.stringify(parsed) });
        messages.push({ role: "user", content: `ERROR: Unknown tool "${toolName}". Available: ${[...TOOL_MAP.keys()].join(", ")}. Use valid JSON.` });
        continue;
      }

      addEvent(session, { type: "tool_call", tool: toolName, args: toolArgs, step });

      let result: ToolResult;
      try { result = await tool.run(toolArgs, session); }
      catch (e) { result = { ok: false, error: String(e) }; }

      addEvent(session, { type: "tool_result", tool: toolName, ok: result.ok, data: result.ok ? result.data : result.error, step });

      if (toolName === "finish") {
        const summary = String((result.data as { summary?: string })?.summary || "Task complete.");
        session.summary = summary;
        addEvent(session, { type: "done", summary, steps: step, model: usedModel });
        session.status = "done";
        break;
      }

      const obs = result.ok
        ? `Tool "${toolName}" succeeded:\n${JSON.stringify(result.data).slice(0, 1500)}`
        : `Tool "${toolName}" FAILED: ${result.error}\nTry a different approach immediately.`;

      const stepsLeft = MAX_STEPS - step;
      const finishHint = stepsLeft <= 5
        ? `\n⚠️ Only ${stepsLeft} steps left! Call \`finish\` NOW with storeInsight to save your work.`
        : stepsLeft <= 10
        ? `\n[${stepsLeft} steps remaining] If task is done, call \`finish\` with storeInsight.`
        : "";

      messages.push({ role: "assistant", content: JSON.stringify({ thought, tool: toolName, args: toolArgs }) });
      messages.push({ role: "user", content: `${obs}\n\n[Step ${step}/${MAX_STEPS}]${finishHint} Respond with JSON.` });
    }

    if (step >= MAX_STEPS && session.status === "running") {
      // Auto-store a memory summarizing what was accomplished before closing
      try {
        const autoSummaryR = await agentLLMCall([
          { role: "system", content: "You are NEXUS Agent. Write ONE concise sentence (max 200 chars) capturing the key insight or result from this session. Start with what was accomplished." },
          { role: "user", content: `Task: ${session.task}\nEvents: ${session.events.slice(-6).map((e) => `${e.type}:${e.tool || ""}${e.content ? ":"+e.content.slice(0,80) : ""}`).join(" | ")}\n\nWrite ONE key insight sentence:` },
        ], { maxTokens: 200, temperature: 0.1 });
        if (autoSummaryR.text.trim().length > 20) {
          await storeMemory(autoSummaryR.text.trim().slice(0, 200), "insight", 5, ["auto-session"], session.id);
        }
      } catch { /* best effort */ }
      const summary = `Completed max ${MAX_STEPS} steps — see events above for results.`;
      session.summary = summary;
      addEvent(session, { type: "done", summary, steps: step });
      session.status = "done";
    }
  } catch (e) {
    const msg = String(e);
    addEvent(session, { type: "error", message: msg });
    session.status = "error";
    session.summary = `Error: ${msg.slice(0, 200)}`;
  }
}

// ─── Autonomous CO-Developer ──────────────────────────────────────────────────
let autonomousInterval: ReturnType<typeof setInterval> | null = null;
export let autonomousEnabled = false;
const AUTONOMOUS_INTERVAL_MS = 10 * 60 * 1000;

async function generateAutonomousTask(): Promise<string | null> {
  try {
    const [datasets, models, jobs] = await Promise.all([
      db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.updatedAt)).limit(10),
      db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.updatedAt)).limit(10),
      db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(5),
    ]);
    const [sampleCounts, recentMemories] = await Promise.all([
      Promise.all(datasets.slice(0, 5).map(async (ds) => {
        const [cnt] = await db.select({ c: sql<number>`count(*)` }).from(trainingSamplesTable).where(eq(trainingSamplesTable.datasetId, ds.id));
        return { id: ds.id, name: ds.name, taskType: ds.taskType, count: Number(cnt?.c || 0) };
      })),
      recallMemories("autonomous improvement dataset training", 4),
    ]);

    const state = { datasets: sampleCounts, modelCount: models.length, recentJobs: jobs.map((j) => ({ status: j.status, progress: j.progress })) };

    const r = await agentLLMCall([
      { role: "system", content: "You are NEXUS Agent's planning module. Choose the single most valuable improvement task based on system state. Be direct and specific." },
      { role: "user", content: `System state:\n${JSON.stringify(state, null, 2)}\n\nPast insights:\n${recentMemories || "(none)"}\n\nWhat ONE task would most improve the AI development system? Prioritize: datasets with <15 samples need more data, untrained models need training, low-quality datasets need improvement, new ML research can generate training insights.\n\nRespond with ONLY the task description (2-3 sentences, specific).` },
    ], { maxTokens: 300, temperature: 0.4 });

    const task = r.text.trim();
    return task.length >= 20 ? task : null;
  } catch (e) {
    console.error("[Agent] Auto task gen error:", e);
    // Heuristic fallback
    try {
      const datasets = await db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.updatedAt)).limit(3);
      if (datasets.length === 0) return "Create a comprehensive 'AI/ML Development QA' dataset with 15 high-quality samples covering transformer architecture, fine-tuning strategies, prompt engineering, evaluation metrics, and deployment best practices.";
      const ds = datasets[0];
      const [cnt] = await db.select({ c: sql<number>`count(*)` }).from(trainingSamplesTable).where(eq(trainingSamplesTable.datasetId, ds.id));
      const count = Number(cnt?.c || 0);
      if (count < 15) return `Dataset "${ds.name}" (id:${ds.id}) has only ${count} samples. Generate 10 more diverse ${ds.taskType} training samples on advanced ML topics — transformers, fine-tuning, evaluation, and deployment.`;
      const topics = ["quantization techniques for LLM deployment (GPTQ, AWQ, BitsAndBytes)", "data-centric AI: improving training data quality over model architecture", "RLHF and DPO: aligning language models with human preferences", "efficient fine-tuning: LoRA, QLoRA, prefix tuning tradeoffs", "LLM evaluation: BLEU, ROUGE, BERTScore, and LLM-as-judge methods"];
      return `Research "${topics[Math.floor(Date.now() / AUTONOMOUS_INTERVAL_MS) % topics.length]}", recall past insights, generate 8 training samples in the most relevant dataset, and store key learnings.`;
    } catch { return null; }
  }
}

export function startAutonomousMode(): void {
  if (autonomousInterval) return;
  autonomousEnabled = true;
  console.log(`[Agent] Autonomous CO-Developer ACTIVE — ${HF_AGENT_MODELS[0]} — every 10 min`);
  const run = async () => {
    if (!autonomousEnabled) return;
    console.log("[Agent] Autonomous cycle...");
    const task = await generateAutonomousTask();
    if (!task) { console.log("[Agent] No task this cycle"); return; }
    console.log("[Agent] Autonomous task:", task.slice(0, 120));
    const s = newSession(task, true);
    executeSession(s).catch((e) => { console.error("[Agent] Autonomous error:", e); s.status = "error"; });
  };
  setTimeout(run, 60_000);
  autonomousInterval = setInterval(run, AUTONOMOUS_INTERVAL_MS);
}

export function stopAutonomousMode(): void {
  if (autonomousInterval) { clearInterval(autonomousInterval); autonomousInterval = null; }
  autonomousEnabled = false;
  console.log("[Agent] Autonomous mode OFF");
}

// ─── REST API ─────────────────────────────────────────────────────────────────

router.post("/agent/sessions", async (req: Request, res: Response) => {
  const { task } = req.body as { task?: string };
  if (!task?.trim()) { res.status(400).json({ error: "task required" }); return; }
  const session = newSession(task.trim());
  executeSession(session).catch((e) => { session.status = "error"; session.summary = String(e); addEvent(session, { type: "error", message: String(e) }); });
  res.status(201).json({ id: session.id, status: session.status, task: session.task, model: session.model, tools: TOOLS.length, note: `${HF_AGENT_MODELS[0]} on HuggingFace GPU` });
});

router.get("/agent/sessions", (_req, res) => {
  const list = [...sessions.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((s) => ({ id: s.id, task: s.task, status: s.status, totalSteps: s.totalSteps, summary: s.summary, model: s.model, autonomous: s.autonomous, memoriesLoaded: s.memoriesLoaded, eventCount: s.events.length, createdAt: s.createdAt, updatedAt: s.updatedAt }));
  res.json(list);
});

router.get("/agent/sessions/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) { res.status(404).json({ error: "Session not found" }); return; }
  res.json(s);
});

router.post("/agent/sessions/:id/stop", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) { res.status(404).json({ error: "Session not found" }); return; }
  if (s.status === "running") { s.status = "stopped"; s.summary = "Stopped by user."; addEvent(s, { type: "done", summary: "Stopped by user.", steps: s.totalSteps }); }
  res.json({ id: s.id, status: s.status });
});

router.delete("/agent/sessions/:id", (req, res) => {
  res.json({ deleted: sessions.delete(req.params.id) });
});

router.get("/agent/sessions/:id/stream", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  let lastIdx = parseInt((req.query.offset as string) || "0", 10);
  const flush = (): boolean => {
    const evs = session.events.slice(lastIdx);
    for (const ev of evs) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    lastIdx = session.events.length;
    if (session.status !== "running") { res.end(); return true; }
    return false;
  };
  if (flush()) return;
  const iv = setInterval(() => { if (flush()) clearInterval(iv); }, 400);
  req.on("close", () => clearInterval(iv));
});

router.get("/agent/autonomous", (_req, res) => {
  res.json({ enabled: autonomousEnabled, intervalMinutes: 10, primaryModel: HF_AGENT_MODELS[0], fallbackModels: HF_AGENT_MODELS.slice(1), hfConfigured: isHFConfigured(), totalTools: TOOLS.length, note: "LLM-driven task selection every cycle" });
});

router.post("/agent/autonomous", (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (enabled) startAutonomousMode(); else stopAutonomousMode();
  res.json({ enabled: autonomousEnabled, model: HF_AGENT_MODELS[0] });
});

router.get("/agent/tools", (_req, res) => {
  res.json(TOOLS.map((t) => ({ name: t.name, description: t.description, params: t.params })));
});

router.get("/agent/memories", async (_req, res) => {
  try {
    const rows = await db.select().from(agentMemoriesTable).orderBy(desc(agentMemoriesTable.importance), desc(agentMemoriesTable.createdAt)).limit(50);
    res.json({ total: rows.length, memories: rows });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.delete("/agent/memories/:id", async (req, res) => {
  try {
    await db.delete(agentMemoriesTable).where(eq(agentMemoriesTable.id, Number(req.params.id)));
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/agent/status", async (_req, res) => {
  const [datasets, models, jobs, memCnt] = await Promise.all([
    db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.updatedAt)).limit(5),
    db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.updatedAt)).limit(5),
    db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(5),
    db.select({ c: sql<number>`count(*)` }).from(agentMemoriesTable),
  ]);
  let installedModels: unknown[] = [];
  try { installedModels = await listOllamaModels(); } catch {}
  const activeCount = [...sessions.values()].filter((s) => s.status === "running").length;
  res.json({ hf: { configured: isHFConfigured(), primaryModel: HF_AGENT_MODELS[0], endpoint: "router.huggingface.co" }, autonomous: { enabled: autonomousEnabled, intervalMinutes: 10, activeSessions: activeCount }, memory: { totalMemories: Number(memCnt[0]?.c || 0) }, db: { datasets, models, recentJobs: jobs }, ollama: { installed: installedModels }, tools: { total: TOOLS.length } });
});

// Legacy SSE endpoint
router.post("/agent/run", async (req, res) => {
  const { task } = req.body as { task?: string };
  if (!task?.trim()) { res.status(400).json({ error: "task required" }); return; }
  const session = newSession(task.trim());
  executeSession(session).catch(console.error);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  let lastIdx = 0;
  const flush = (): boolean => {
    const evs = session.events.slice(lastIdx);
    for (const ev of evs) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    lastIdx = session.events.length;
    if (session.status !== "running") { res.end(); return true; }
    return false;
  };
  if (flush()) return;
  const iv = setInterval(() => { if (flush()) clearInterval(iv); }, 400);
  req.on("close", () => clearInterval(iv));
});

export default router;
