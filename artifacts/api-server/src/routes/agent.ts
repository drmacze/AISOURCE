/**
 * DLavie OS — AI Developer Agent (Background Session Engine)
 *
 * Model: Qwen/Qwen2.5-Coder-32B-Instruct (primary) → Llama-3.3-70B → Mistral-7B
 *        All models run on HuggingFace GPU servers — ZERO local RAM consumed.
 *        Falls back to local Ollama only if HF_TOKEN is missing.
 *
 * - Sessions run as background Promises (survive page navigation)
 * - Autonomous mode: periodic self-directed tasks every 10 minutes
 * - SSE streaming: clients can stream events live, or poll /api/agent/sessions/:id
 * - No confirmation required — agent acts immediately and reports results
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  trainingDatasetsTable,
  trainingSamplesTable,
  trainingJobsTable,
  aiModelsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { generateOllamaResponse, listOllamaModels, pullOllamaModel, isOllamaOnline } from "../ollama";
import {
  chatCompletionHFWithFallback,
  isHFConfigured,
  listHFModels,
  HF_AGENT_MODELS,
  type ChatMessage,
} from "../huggingface";
import crypto from "crypto";
import { execSync } from "child_process";

const router: IRouter = Router();

// ─── LLM backend selection ────────────────────────────────────────────────────
// HF (heavy models on remote GPU) is primary; Ollama phi4/tinyllama is fallback.

async function agentLLMCall(
  messages: ChatMessage[]
): Promise<{ text: string; model: string }> {
  if (isHFConfigured()) {
    try {
      const result = await chatCompletionHFWithFallback(messages, { maxTokens: 2048, temperature: 0.2 });
      console.log(`[Agent] HF response — model: ${result.model}, chars: ${result.text.length}`);
      return result;
    } catch (e) {
      console.warn("[Agent] All HF models failed — falling back to local Ollama:", String(e).slice(0, 400));
    }
  } else {
    console.warn("[Agent] HF not configured — using local Ollama");
  }

  // Ollama fallback — try phi4:14b first (if loaded), then tinyllama
  const prompt = messages
    .map((m) => {
      if (m.role === "system") return `SYSTEM: ${m.content}`;
      if (m.role === "user") return `USER: ${m.content}`;
      return `ASSISTANT: ${m.content}`;
    })
    .join("\n\n");

  // Try phi4:14b if it's already loaded in memory (no RAM cost if cached)
  try {
    const text = await generateOllamaResponse(prompt, "phi4:14b");
    return { text, model: "phi4:14b (local)" };
  } catch {
    // phi4:14b not loaded — use tinyllama
  }
  const text = await generateOllamaResponse(prompt, "tinyllama");
  return { text, model: "tinyllama (local fallback)" };
}

// ─── Session store ────────────────────────────────────────────────────────────
export interface AgentEvent {
  type: "thought" | "tool_call" | "tool_result" | "done" | "error" | "info";
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
  createdAt: Date;
  updatedAt: Date;
}

const sessions = new Map<string, AgentSession>();
const MAX_SESSIONS = 50;

function newSession(task: string, autonomous = false): AgentSession {
  const id = crypto.randomUUID();
  const session: AgentSession = {
    id, task, status: "running", events: [], summary: "",
    totalSteps: 0, model: HF_AGENT_MODELS[0],
    autonomous, createdAt: new Date(), updatedAt: new Date(),
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

// ─── Tool definitions ─────────────────────────────────────────────────────────
interface ToolResult { ok: boolean; data?: unknown; error?: string; }
type AgentTool = { name: string; description: string; params: string; run: (args: Record<string, unknown>) => Promise<ToolResult>; };

const TOOLS: AgentTool[] = [
  // ── Dataset tools ──
  {
    name: "list_datasets",
    description: "List all training datasets in the system.",
    params: "{}",
    async run() {
      const rows = await db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt)).limit(20);
      return { ok: true, data: rows };
    },
  },
  {
    name: "create_dataset",
    description: "Create a new training dataset. Required: name, taskType (qa/generation/summarization/classification/translation).",
    params: '{"name":"...","taskType":"qa","description":"..."}',
    async run(args) {
      const name = String(args.name || "");
      const taskType = String(args.taskType || "qa");
      const description = args.description ? String(args.description) : undefined;
      if (!name) return { ok: false, error: "name required" };
      const valid = ["qa", "generation", "summarization", "classification", "translation"];
      if (!valid.includes(taskType)) return { ok: false, error: `taskType must be one of: ${valid.join(", ")}` };
      const [row] = await db.insert(trainingDatasetsTable).values({ name, taskType, description }).returning();
      return { ok: true, data: row };
    },
  },
  {
    name: "add_sample",
    description: "Add a training sample to a dataset. Required: datasetId (number), input, output.",
    params: '{"datasetId":1,"input":"...","output":"..."}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const input = String(args.input || "");
      const output = String(args.output || "");
      if (!datasetId || !input || !output) return { ok: false, error: "datasetId, input, output required" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };
      const [row] = await db.insert(trainingSamplesTable).values({
        datasetId, input, expectedOutput: output, source: String(args.source || "agent"),
      }).returning();
      return { ok: true, data: row };
    },
  },
  {
    name: "generate_samples",
    description: "Use the AI model to generate high-quality training samples. Required: datasetId, topic, count (1-20).",
    params: '{"datasetId":1,"topic":"transformer attention mechanisms","count":5}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const topic = String(args.topic || "AI");
      const count = Math.min(20, Math.max(1, Number(args.count) || 5));
      if (!datasetId) return { ok: false, error: "datasetId required" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: "You are an expert AI training data generator. Produce precise, diverse, educational Q&A pairs. Return ONLY a valid JSON array, no markdown, no explanation.",
        },
        {
          role: "user",
          content: `Create exactly ${count} high-quality training examples about "${topic}" for a ${ds.taskType} task.
Return ONLY a JSON array like: [{"input":"question or prompt","output":"detailed answer"}]
Make each pair unique, specific, and educational. No duplicate topics.`,
        },
      ];

      let raw = "";
      try {
        const result = await agentLLMCall(messages);
        raw = result.text;
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start === -1 || end === -1) throw new Error("no JSON array in response");
        const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ input: string; output: string }>;
        const valid = parsed.filter((p) => p.input && p.output).slice(0, count);
        const inserted = [];
        for (const s of valid) {
          const [row] = await db.insert(trainingSamplesTable).values({
            datasetId, input: s.input, expectedOutput: s.output, source: "agent-hf",
          }).returning();
          inserted.push(row);
        }
        return { ok: true, data: { generated: inserted.length, model: result.model, samples: inserted } };
      } catch (e) {
        return { ok: false, error: `Generation failed: ${String(e)}. Raw: ${raw.slice(0, 200)}` };
      }
    },
  },
  {
    name: "analyze_dataset",
    description: "Analyze a dataset for quality, diversity, and suggest improvements. Required: datasetId.",
    params: '{"datasetId":1}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      if (!datasetId) return { ok: false, error: "datasetId required" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };
      const samples = await db.select().from(trainingSamplesTable)
        .where(eq(trainingSamplesTable.datasetId, datasetId))
        .orderBy(desc(trainingSamplesTable.createdAt)).limit(50);

      const avgInputLen = samples.reduce((s, r) => s + r.input.length, 0) / Math.max(1, samples.length);
      const avgOutputLen = samples.reduce((s, r) => s + (r.expectedOutput || "").length, 0) / Math.max(1, samples.length);
      const sources = [...new Set(samples.map((s) => s.source))];
      const shortOutputs = samples.filter((s) => (s.expectedOutput || "").length < 20).length;

      const messages: ChatMessage[] = [
        { role: "system", content: "You are an ML training data quality expert. Give concrete, actionable feedback." },
        {
          role: "user",
          content: `Analyze this training dataset and give quality assessment + 3 specific improvement suggestions:
Dataset: "${ds.name}" | Task: ${ds.taskType} | Samples: ${samples.length}
Avg input length: ${Math.round(avgInputLen)} chars | Avg output length: ${Math.round(avgOutputLen)} chars
Sources: ${sources.join(", ")} | Short outputs (<20 chars): ${shortOutputs}
First 3 samples: ${JSON.stringify(samples.slice(0, 3).map((s) => ({ input: s.input.slice(0, 100), output: (s.expectedOutput || "").slice(0, 100) })))}`,
        },
      ];

      try {
        const result = await agentLLMCall(messages);
        return {
          ok: true,
          data: {
            stats: { totalSamples: samples.length, avgInputLen: Math.round(avgInputLen), avgOutputLen: Math.round(avgOutputLen), sources, shortOutputs },
            analysis: result.text,
            model: result.model,
          },
        };
      } catch (e) {
        return { ok: true, data: { stats: { totalSamples: samples.length, avgInputLen: Math.round(avgInputLen), avgOutputLen: Math.round(avgOutputLen) } } };
      }
    },
  },
  // ── Model tools ──
  {
    name: "list_models",
    description: "List all registered AI models in the system.",
    params: "{}",
    async run() {
      const rows = await db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.createdAt)).limit(20);
      return { ok: true, data: rows };
    },
  },
  {
    name: "create_model",
    description: "Register a new AI model. Required: name, type (llm/vision/embedding). Optional: architecture, description.",
    params: '{"name":"MyModel-7B","type":"llm","architecture":"qwen2.5","description":"..."}',
    async run(args) {
      const name = String(args.name || "");
      const type = String(args.type || "llm");
      const description = args.description ? String(args.description) : undefined;
      const architecture = args.architecture ? String(args.architecture) : "qwen2.5";
      if (!name) return { ok: false, error: "name required" };
      const [row] = await db.insert(aiModelsTable).values({ name, type, description, architecture }).returning();
      return { ok: true, data: row };
    },
  },
  {
    name: "search_hf_models",
    description: "Search HuggingFace Hub for models by task or keyword. Optional: task, search query, limit.",
    params: '{"task":"text-generation","search":"coder","limit":10}',
    async run(args) {
      const task = String(args.task || "text-generation");
      const search = args.search ? String(args.search) : undefined;
      const limit = Math.min(20, Number(args.limit) || 10);
      try {
        const models = await listHFModels({ task, search, limit });
        return { ok: true, data: { count: models.length, models: models.slice(0, limit) } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "pull_ollama_model",
    description: "Download and install a model into Ollama for local inference. Required: model (e.g. qwen2.5:3b, llama3.2:3b, deepseek-r1:1.5b).",
    params: '{"model":"qwen2.5:3b"}',
    async run(args) {
      const model = String(args.model || "").trim();
      if (!model) return { ok: false, error: "model name required" };
      const chunks: string[] = [];
      try {
        const stream = await pullOllamaModel(model);
        for await (const chunk of stream) {
          chunks.push(chunk);
          if (chunks.length > 20) break; // Don't buffer too much
        }
        return { ok: true, data: { model, status: "pulling", log: chunks.slice(-3).join("") } };
      } catch (e) {
        return { ok: false, error: `Pull failed for "${model}": ${String(e)}` };
      }
    },
  },
  {
    name: "list_installed_models",
    description: "List all Ollama models installed locally and ready for inference.",
    params: "{}",
    async run() {
      try {
        const models = await listOllamaModels();
        const online = await isOllamaOnline();
        return { ok: true, data: { online, localModels: models } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  // ── Training tools ──
  {
    name: "list_jobs",
    description: "List recent training jobs and their status.",
    params: "{}",
    async run() {
      const rows = await db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(10);
      return { ok: true, data: rows };
    },
  },
  {
    name: "start_training",
    description: "Start a training job for a registered model on a dataset. Required: modelId, datasetId.",
    params: '{"modelId":1,"datasetId":1}',
    async run(args) {
      const modelId = Number(args.modelId);
      const datasetId = Number(args.datasetId);
      if (!modelId || !datasetId) return { ok: false, error: "modelId and datasetId required" };
      const [model] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.id, modelId));
      if (!model) return { ok: false, error: `Model #${modelId} not found` };
      const [dataset] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!dataset) return { ok: false, error: `Dataset #${datasetId} not found` };
      const [job] = await db.insert(trainingJobsTable).values({
        modelId, datasetId, status: "pending", progress: 0, currentEpoch: 0, totalEpochs: 3,
      }).returning();
      fetch(`http://127.0.0.1:${process.env.PORT || 8080}/training-jobs/${job.id}/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
      }).catch(() => {});
      return { ok: true, data: { job, message: `Training job #${job.id} started: "${model.name}" × "${dataset.name}"` } };
    },
  },
  // ── AI dev tools ──
  {
    name: "generate_code",
    description: "Generate Python or JavaScript code for an AI/ML task. Required: task description. Optional: language (python/javascript).",
    params: '{"task":"Write a data preprocessing pipeline for NLP training data","language":"python"}',
    async run(args) {
      const task = String(args.task || "");
      const language = String(args.language || "python");
      if (!task) return { ok: false, error: "task description required" };

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `You are an expert ${language} developer specializing in AI/ML. Write clean, production-ready code with comments. Include error handling and best practices.`,
        },
        {
          role: "user",
          content: `Write ${language} code for: ${task}\n\nProvide complete, runnable code with brief explanation.`,
        },
      ];

      try {
        const result = await agentLLMCall(messages);
        return { ok: true, data: { language, code: result.text, model: result.model } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "plan_architecture",
    description: "Design an AI model architecture or ML pipeline for a given use case. Required: useCase.",
    params: '{"useCase":"Build a sentiment analysis model for customer reviews"}',
    async run(args) {
      const useCase = String(args.useCase || "");
      if (!useCase) return { ok: false, error: "useCase required" };

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: "You are a senior ML architect. Provide detailed, actionable architecture plans with specific model choices, training strategies, and evaluation metrics.",
        },
        {
          role: "user",
          content: `Design a complete AI/ML architecture for: ${useCase}
Include: model choice, dataset requirements, training approach, evaluation metrics, deployment strategy. Be specific and practical.`,
        },
      ];

      try {
        const result = await agentLLMCall(messages);
        return { ok: true, data: { plan: result.text, model: result.model } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "get_system_stats",
    description: "Get current system stats: RAM usage, disk, running models, HF status.",
    params: "{}",
    async run() {
      let memInfo = "";
      let diskInfo = "";
      try { memInfo = execSync("free -h 2>/dev/null || echo 'N/A'", { timeout: 3000 }).toString().trim(); } catch {}
      try { diskInfo = execSync("df -h / 2>/dev/null | tail -1 || echo 'N/A'", { timeout: 3000 }).toString().trim(); } catch {}

      let localModels: unknown[] = [];
      let ollamaOnline = false;
      try { localModels = await listOllamaModels(); ollamaOnline = true; } catch {}

      return {
        ok: true,
        data: {
          memory: memInfo,
          disk: diskInfo,
          ollama: { online: ollamaOnline, models: localModels },
          hf: { configured: isHFConfigured(), agentModels: HF_AGENT_MODELS },
          note: "Heavy models (7B-70B) run on HF GPU servers — they don't use local RAM",
        },
      };
    },
  },
  // ── Web & knowledge tools ──
  {
    name: "search_web",
    description: "Search the web for AI/ML information. Required: query.",
    params: '{"query":"latest advances in LLM fine-tuning 2024"}',
    async run(args) {
      const query = String(args.query || "");
      if (!query) return { ok: false, error: "query required" };
      try {
        const res = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(8000) }
        );
        const data = await res.json() as { Abstract?: string; AbstractText?: string; RelatedTopics?: Array<{ Text?: string }> };
        const summary = data.Abstract || data.AbstractText ||
          (data.RelatedTopics || []).slice(0, 5).map((t) => t.Text).filter(Boolean).join(". ");
        return { ok: true, data: { query, summary: summary || "No results found" } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "reason",
    description: "Think deeply about a complex AI/ML problem, research question, or design decision. Required: question.",
    params: '{"question":"What are the tradeoffs between LoRA and full fine-tuning for a 7B parameter model?"}',
    async run(args) {
      const question = String(args.question || "");
      if (!question) return { ok: false, error: "question required" };

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: "You are a world-class AI researcher. Think step by step, consider multiple angles, cite concrete examples, and give a definitive recommendation.",
        },
        { role: "user", content: question },
      ];

      try {
        const result = await agentLLMCall(messages);
        return { ok: true, data: { answer: result.text, model: result.model } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  // ── Control tools ──
  {
    name: "finish",
    description: "Signal that the task is complete. Required: summary of what was accomplished.",
    params: '{"summary":"Created dataset X with 10 samples covering transformer attention mechanisms."}',
    async run(args) {
      return { ok: true, data: { summary: String(args.summary || "Task complete.") } };
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ─── System prompt (optimized for large models) ───────────────────────────────
function buildSystemPrompt(): string {
  const toolList = TOOLS.map((t) => `- **${t.name}**(${t.params}): ${t.description}`).join("\n");
  return `You are NEXUS Agent — an autonomous AI developer assistant running inside the NEXUS_OS AI Command Center.
You have access to real database operations, model training, code generation, and HuggingFace Hub.

AVAILABLE TOOLS:
${toolList}

RESPONSE FORMAT — respond ONLY with valid JSON every turn:
{
  "thought": "your reasoning about the current state and next action",
  "tool": "tool_name",
  "args": { ...tool arguments... }
}

RULES:
- Always act decisively. No questions, no waiting for confirmation.
- Complete the task fully in up to 20 steps.
- When the task is done, call finish() with a detailed summary.
- If a tool fails, try an alternative approach.
- For dataset work: analyze first, then generate high-quality samples.
- For model work: check system stats, search HF for best available models.`;
}

// ─── Background ReAct execution loop ─────────────────────────────────────────
async function executeSession(session: AgentSession): Promise<void> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: `TASK: ${session.task}\n\nBegin immediately. Respond with JSON.` },
  ];

  const MAX_STEPS = 20;
  let step = 0;

  try {
    while (step < MAX_STEPS && session.status === "running") {
      step++;

      // Keep last 16 messages to avoid context overflow (system + recent history)
      const contextMessages: ChatMessage[] = [
        messages[0], // always keep system prompt
        ...messages.slice(Math.max(1, messages.length - 15)),
      ];

      // LLM call — uses HF 32B/70B model
      let raw = "";
      let usedModel = session.model;
      try {
        const result = await agentLLMCall(contextMessages);
        raw = result.text;
        usedModel = result.model;
        session.model = usedModel;
      } catch (e) {
        addEvent(session, { type: "error", message: `LLM error: ${String(e)}`, step });
        session.status = "error";
        break;
      }

      // Parse JSON response
      let parsed: { thought?: string; tool?: string; args?: Record<string, unknown> } = {};
      let parseOk = false;

      try {
        // Extract JSON from code blocks if model wraps it
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          parsed = JSON.parse(cleaned.slice(start, end + 1));
          parseOk = true;
        }
      } catch { /* fallback below */ }

      if (!parseOk) {
        const toolNames = [...TOOL_MAP.keys()].join("|");
        const toolMatch = raw.match(new RegExp(`\\b(${toolNames})\\b`, "i"));
        const detectedTool = toolMatch?.[1]?.toLowerCase() ?? "finish";
        parsed = {
          thought: raw.slice(0, 500),
          tool: detectedTool,
          args: detectedTool === "finish" ? { summary: "Task complete." } : {},
        };
      }

      const thought = String(parsed.thought || "");
      const toolName = String(parsed.tool || "finish").toLowerCase().trim();
      const toolArgs = (parsed.args || {}) as Record<string, unknown>;

      if (thought) {
        addEvent(session, { type: "thought", content: thought, step, model: usedModel });
      }

      const tool = TOOL_MAP.get(toolName);
      if (!tool) {
        const available = [...TOOL_MAP.keys()].join(", ");
        addEvent(session, { type: "error", message: `Unknown tool "${toolName}". Available: ${available}`, step });
        messages.push({ role: "assistant", content: JSON.stringify(parsed) });
        messages.push({ role: "user", content: `ERROR: Unknown tool "${toolName}". You must use one of: ${available}. Respond with valid JSON.` });
        continue;
      }

      addEvent(session, { type: "tool_call", tool: toolName, args: toolArgs, step });

      let result: ToolResult;
      try {
        result = await tool.run(toolArgs);
      } catch (e) {
        result = { ok: false, error: String(e) };
      }

      addEvent(session, {
        type: "tool_result", tool: toolName,
        ok: result.ok, data: result.ok ? result.data : result.error,
        step,
      });

      if (toolName === "finish") {
        const summary = result.ok
          ? String((result.data as { summary: string }).summary)
          : "Task complete.";
        session.summary = summary;
        session.totalSteps = step;
        addEvent(session, { type: "done", summary, steps: step, model: usedModel });
        session.status = "done";
        break;
      }

      // Feed observation back as user message
      const obs = result.ok
        ? `Tool "${toolName}" succeeded:\n${JSON.stringify(result.data).slice(0, 800)}`
        : `Tool "${toolName}" failed: ${result.error}\nTry a different approach.`;

      messages.push({ role: "assistant", content: JSON.stringify({ thought, tool: toolName, args: toolArgs }) });
      messages.push({ role: "user", content: `${obs}\n\nStep ${step}/${MAX_STEPS} complete. Continue with next action. Respond with JSON.` });
    }

    if (step >= MAX_STEPS && session.status === "running") {
      const summary = `Completed ${step} steps. Task may be partially done — review results above.`;
      session.summary = summary;
      session.totalSteps = step;
      addEvent(session, { type: "done", summary, steps: step });
      session.status = "done";
    }
  } catch (e) {
    addEvent(session, { type: "error", message: String(e) });
    session.status = "error";
  }
}

// ─── Autonomous CO-Developer Mode ─────────────────────────────────────────────
// Runs every 10 minutes, self-directs work based on system state.

let autonomousInterval: ReturnType<typeof setInterval> | null = null;
export let autonomousEnabled = false;
const AUTONOMOUS_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function generateAutonomousTask(): Promise<string | null> {
  try {
    const [datasets, models, jobs] = await Promise.all([
      db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt)).limit(10),
      db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.createdAt)).limit(10),
      db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(5),
    ]);

    const lastJob = jobs[0];
    const lastJobMs = lastJob ? Date.now() - new Date(lastJob.createdAt).getTime() : Infinity;
    const lastJobHours = lastJobMs / 3600000;
    const lastJobMins = lastJobMs / 60000;

    // Priority 1: models registered but never trained
    const trainedModelIds = new Set(jobs.map((j) => j.modelId));
    const untrained = models.filter((m) => !trainedModelIds.has(m.id));
    if (untrained.length > 0 && datasets.length > 0) {
      const m = untrained[0];
      const ds = datasets[0];
      return `Model "${m.name}" (id: ${m.id}) has no training jobs. Analyze dataset "${ds.name}" (id: ${ds.id}) quality, then start training this model on it.`;
    }

    // Priority 2: recently created dataset with few samples → generate more
    const recentDs = datasets[0];
    if (recentDs) {
      const sampleCount = await db.select().from(trainingSamplesTable)
        .where(eq(trainingSamplesTable.datasetId, recentDs.id));
      if (sampleCount.length < 10) {
        return `Dataset "${recentDs.name}" (id: ${recentDs.id}) only has ${sampleCount.length} samples. Generate 8 more high-quality training samples about the most relevant AI/ML topics for its task type: ${recentDs.taskType}.`;
      }
    }

    // Priority 3: no training activity in 30+ minutes → audit and improve
    if (lastJobMins > 30 && datasets.length > 0) {
      const ds = datasets[Math.floor(Math.random() * Math.min(3, datasets.length))];
      return `Audit the system: check dataset "${ds.name}" quality, generate 5 new diverse training samples about advanced ${ds.taskType} techniques, and provide recommendations for model improvement.`;
    }

    // Priority 4: no datasets → create foundation
    if (datasets.length === 0) {
      return `The system has no training datasets. Create a comprehensive "AI Development QA" dataset, then generate 10 high-quality samples covering: transformer architecture, fine-tuning strategies, prompt engineering, evaluation metrics, and deployment best practices.`;
    }

    // Priority 5: periodic architecture research
    const topics = [
      "LoRA vs full fine-tuning tradeoffs for production deployment",
      "optimal learning rate scheduling for language model fine-tuning",
      "data quality vs data quantity in training small language models",
      "efficient inference techniques: quantization, distillation, pruning",
      "evaluation strategies for generative AI models",
    ];
    const topic = topics[Math.floor(Date.now() / AUTONOMOUS_INTERVAL_MS) % topics.length];
    return `Research and reason deeply about: "${topic}". Then generate 5 training samples based on the insights into the most relevant dataset.`;
  } catch (e) {
    console.error("[Agent] autonomous task generation error:", e);
    return null;
  }
}

export function startAutonomousMode(): void {
  if (autonomousInterval) return;
  autonomousEnabled = true;
  console.log("[Agent] Autonomous CO-Developer mode ON — every 10 min, model:", HF_AGENT_MODELS[0]);

  const run = async () => {
    if (!autonomousEnabled) return;
    const task = await generateAutonomousTask();
    if (task) {
      console.log("[Agent] Autonomous task:", task.slice(0, 100));
      const session = newSession(task, true);
      executeSession(session).catch(console.error);
    }
  };

  // First run after 90 seconds
  setTimeout(run, 90_000);
  autonomousInterval = setInterval(run, AUTONOMOUS_INTERVAL_MS);
}

export function stopAutonomousMode(): void {
  if (autonomousInterval) { clearInterval(autonomousInterval); autonomousInterval = null; }
  autonomousEnabled = false;
  console.log("[Agent] Autonomous mode OFF");
}

// ─── REST Endpoints ───────────────────────────────────────────────────────────

// POST /api/agent/sessions — start background session
router.post("/agent/sessions", async (req: Request, res: Response) => {
  const { task } = req.body as { task?: string };
  if (!task?.trim()) { res.status(400).json({ error: "task required" }); return; }
  const session = newSession(task.trim());
  executeSession(session).catch((e) => {
    session.status = "error";
    addEvent(session, { type: "error", message: String(e) });
  });
  res.status(201).json({
    id: session.id, status: session.status, task: session.task,
    model: session.model, note: "Model runs on HuggingFace GPU servers",
  });
});

// GET /api/agent/sessions — list all sessions
router.get("/agent/sessions", (_req: Request, res: Response) => {
  const list = [...sessions.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((s) => ({
      id: s.id, task: s.task, status: s.status, totalSteps: s.totalSteps,
      summary: s.summary, model: s.model, autonomous: s.autonomous,
      eventCount: s.events.length, createdAt: s.createdAt, updatedAt: s.updatedAt,
    }));
  res.json(list);
});

// GET /api/agent/sessions/:id — full session with events
router.get("/agent/sessions/:id", (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  res.json(session);
});

// POST /api/agent/sessions/:id/stop — stop a running session
router.post("/agent/sessions/:id/stop", (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status === "running") {
    session.status = "stopped";
    session.summary = "Stopped by user.";
    addEvent(session, { type: "done", summary: "Stopped by user.", steps: session.totalSteps });
  }
  res.json({ id: session.id, status: session.status });
});

// DELETE /api/agent/sessions/:id — remove session
router.delete("/agent/sessions/:id", (req: Request, res: Response) => {
  const deleted = sessions.delete(req.params.id);
  res.json({ deleted });
});

// GET /api/agent/sessions/:id/stream — SSE live stream from a session
router.get("/agent/sessions/:id/stream", (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let lastIdx = parseInt((req.query.offset as string) || "0", 10);

  const flush = (): boolean => {
    const newEvents = session.events.slice(lastIdx);
    for (const ev of newEvents) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    lastIdx = session.events.length;
    if (session.status !== "running") { res.end(); return true; }
    return false;
  };

  if (flush()) return;
  const interval = setInterval(() => { if (flush()) clearInterval(interval); }, 400);
  req.on("close", () => clearInterval(interval));
});

// GET /api/agent/autonomous — get autonomous mode status
router.get("/agent/autonomous", (_req: Request, res: Response) => {
  res.json({
    enabled: autonomousEnabled,
    intervalMinutes: 10,
    primaryModel: HF_AGENT_MODELS[0],
    fallbackModels: HF_AGENT_MODELS.slice(1),
    hfConfigured: isHFConfigured(),
    note: "Models run on HuggingFace GPU servers — no local RAM consumed",
  });
});

// POST /api/agent/autonomous — enable or disable autonomous mode
router.post("/agent/autonomous", (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (enabled) startAutonomousMode(); else stopAutonomousMode();
  res.json({ enabled: autonomousEnabled, model: HF_AGENT_MODELS[0] });
});

// GET /api/agent/tools — list available tools
router.get("/agent/tools", (_req: Request, res: Response) => {
  res.json(TOOLS.map((t) => ({ name: t.name, description: t.description, params: t.params })));
});

// GET /api/agent/status — quick system status
router.get("/agent/status", async (_req: Request, res: Response) => {
  const [datasets, models, jobs] = await Promise.all([
    db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt)).limit(5),
    db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.createdAt)).limit(5),
    db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(5),
  ]);
  let installedModels: unknown[] = [];
  try { installedModels = await listOllamaModels(); } catch {}
  const activeCount = [...sessions.values()].filter((s) => s.status === "running").length;
  res.json({
    datasets, models, jobs, installedModels,
    autonomousEnabled, activeSessions: activeCount,
    agentModel: HF_AGENT_MODELS[0],
    hfConfigured: isHFConfigured(),
  });
});

// POST /api/agent/run — legacy SSE endpoint (backward compat)
router.post("/agent/run", async (req: Request, res: Response) => {
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
    const newEvents = session.events.slice(lastIdx);
    for (const ev of newEvents) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    lastIdx = session.events.length;
    if (session.status !== "running") { res.end(); return true; }
    return false;
  };

  if (flush()) return;
  const interval = setInterval(() => { if (flush()) clearInterval(interval); }, 400);
  req.on("close", () => clearInterval(interval));
});

export default router;
