/**
 * DLavie OS — AI Developer Agent (Background Session Engine)
 *
 * - Sessions run as background Promises (survive page navigation)
 * - Always uses AGENT_MODEL = "tinyllama" (RAM-safe)
 * - Autonomous mode: periodic self-directed tasks every 30 min
 * - Polling-based: clients poll /api/agent/sessions/:id for updates
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
import { generateOllamaResponse, listOllamaModels } from "../ollama";
import crypto from "crypto";

const router: IRouter = Router();

// ─── Agent model — always tinyllama (fits in RAM) ─────────────────────────────
const AGENT_MODEL = "tinyllama";

// ─── Session store ────────────────────────────────────────────────────────────
export interface AgentEvent {
  type: "thought" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  ok?: boolean;
  summary?: string;
  steps?: number;
  message?: string;
  step?: number;
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
const MAX_SESSIONS = 30;

function newSession(task: string, autonomous = false): AgentSession {
  const id = crypto.randomUUID();
  const session: AgentSession = {
    id, task, status: "running", events: [], summary: "",
    totalSteps: 0, model: AGENT_MODEL, autonomous,
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

// ─── Tool definitions ─────────────────────────────────────────────────────────
interface ToolResult { ok: boolean; data?: unknown; error?: string; }
type AgentTool = { name: string; description: string; params: string; run: (args: Record<string, unknown>) => Promise<ToolResult>; };

const TOOLS: AgentTool[] = [
  {
    name: "list_datasets",
    description: "List all training datasets.",
    params: "{}",
    async run() {
      const rows = await db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt)).limit(20);
      return { ok: true, data: rows };
    },
  },
  {
    name: "create_dataset",
    description: "Create dataset. Required: name, taskType (qa/generation/summarization/classification/translation).",
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
    description: "Add training sample. Required: datasetId, input, output.",
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
    description: "Generate training samples via LLM. Required: datasetId, topic, count (1-8).",
    params: '{"datasetId":1,"topic":"machine learning","count":3}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const topic = String(args.topic || "AI");
      const count = Math.min(8, Math.max(1, Number(args.count) || 3));
      if (!datasetId) return { ok: false, error: "datasetId required" };
      const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };

      const prompt = `Create ${count} Q&A training examples about "${topic}".
Return ONLY a JSON array: [{"input":"question","output":"answer"},...]
No text outside the JSON array.`;

      let raw = "";
      try {
        raw = await generateOllamaResponse(prompt, AGENT_MODEL);
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start === -1 || end === -1) throw new Error("no JSON array");
        const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ input: string; output: string }>;
        const valid = parsed.filter((p) => p.input && p.output).slice(0, count);
        const inserted = [];
        for (const s of valid) {
          const [row] = await db.insert(trainingSamplesTable).values({
            datasetId, input: s.input, expectedOutput: s.output, source: "agent-llm",
          }).returning();
          inserted.push(row);
        }
        return { ok: true, data: { generated: inserted.length, samples: inserted } };
      } catch (e) {
        return { ok: false, error: `Generation failed: ${String(e)}. Raw: ${raw.slice(0, 200)}` };
      }
    },
  },
  {
    name: "list_models",
    description: "List all registered AI models.",
    params: "{}",
    async run() {
      const rows = await db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.createdAt)).limit(20);
      return { ok: true, data: rows };
    },
  },
  {
    name: "create_model",
    description: "Register a new AI model. Required: name, type (llm/vision/embedding). Optional: architecture (tinyllama).",
    params: '{"name":"...","type":"llm","architecture":"tinyllama","description":"..."}',
    async run(args) {
      const name = String(args.name || "");
      const type = String(args.type || "llm");
      const description = args.description ? String(args.description) : undefined;
      const architecture = args.architecture ? String(args.architecture) : "tinyllama";
      if (!name) return { ok: false, error: "name required" };
      const [row] = await db.insert(aiModelsTable).values({ name, type, description, architecture }).returning();
      return { ok: true, data: row };
    },
  },
  {
    name: "list_jobs",
    description: "List recent training jobs.",
    params: "{}",
    async run() {
      const rows = await db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(10);
      return { ok: true, data: rows };
    },
  },
  {
    name: "start_training",
    description: "Start a training job. Required: modelId, datasetId.",
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
      return { ok: true, data: { job, message: `Training job #${job.id} queued for "${model.name}" on "${dataset.name}"` } };
    },
  },
  {
    name: "list_installed_models",
    description: "List Ollama models currently installed and ready for inference.",
    params: "{}",
    async run() {
      try {
        const models = await listOllamaModels();
        return { ok: true, data: models };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "search_web",
    description: "Search the web. Required: query.",
    params: '{"query":"..."}',
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
          (data.RelatedTopics || []).slice(0, 3).map((t) => t.Text).filter(Boolean).join(". ");
        return { ok: true, data: { query, summary: summary || "No results" } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "finish",
    description: "Signal task complete. Required: summary of what was accomplished.",
    params: '{"summary":"..."}',
    async run(args) {
      return { ok: true, data: { summary: String(args.summary || "Task complete.") } };
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ─── Compact system prompt (fits TinyLlama's 2048-token context) ──────────────
function buildSystemPrompt(): string {
  const toolList = TOOLS.map((t) => `${t.name}(${t.params}): ${t.description.split(".")[0]}`).join("\n");
  return `You are DLavie Agent — an AI developer assistant. Execute the task using tools.

TOOLS:
${toolList}

Respond ONLY with valid JSON every turn:
{"thought":"your reasoning","tool":"tool_name","args":{...}}

Rules: Be decisive. No questions. Call finish() when task is complete. Max 12 steps.`;
}

// ─── Background ReAct execution loop ─────────────────────────────────────────
async function executeSession(session: AgentSession): Promise<void> {
  // Sliding window history (keep last 4 messages to stay within context)
  const history: Array<{ role: string; content: string }> = [];

  const SYSTEM = buildSystemPrompt();
  const limit = 12;
  let step = 0;

  try {
    // Initial user message
    history.push({ role: "user", content: `TASK: ${session.task}\n\nRespond with JSON only.` });

    while (step < limit && session.status === "running") {
      step++;

      // Build prompt: system + last 4 messages
      const recentHistory = history.slice(-4);
      const fullPrompt = [
        SYSTEM,
        ...recentHistory.map((m) =>
          m.role === "user" ? `\nUser: ${m.content}` : `\nAssistant: ${m.content}`
        ),
      ].join("");

      // LLM call
      let raw = "";
      try {
        raw = await generateOllamaResponse(fullPrompt, AGENT_MODEL);
      } catch (e) {
        addEvent(session, { type: "error", message: `LLM error: ${String(e)}`, step });
        session.status = "error";
        break;
      }

      // Parse JSON response (TinyLlama may not always produce perfect JSON)
      let parsed: { thought?: string; tool?: string; args?: Record<string, unknown> } = {};
      let parseOk = false;

      try {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          parsed = JSON.parse(raw.slice(start, end + 1));
          parseOk = true;
        }
      } catch { /* fallback below */ }

      if (!parseOk) {
        // TinyLlama fallback: extract tool name from text using pattern matching
        const toolNames = [...TOOL_MAP.keys()].join("|");
        const toolMatch = raw.match(new RegExp(`\\b(${toolNames})\\b`, "i"));
        const detectedTool = toolMatch?.[1]?.toLowerCase() ?? "finish";
        parsed = {
          thought: raw.slice(0, 300),
          tool: detectedTool,
          args: detectedTool === "finish" ? { summary: "Task attempted. Check results above." } : {},
        };
      }

      const thought = String(parsed.thought || "");
      const toolName = String(parsed.tool || "finish").toLowerCase().trim();
      const toolArgs = (parsed.args || {}) as Record<string, unknown>;

      if (thought) {
        addEvent(session, { type: "thought", content: thought, step });
      }

      const tool = TOOL_MAP.get(toolName);
      if (!tool) {
        const available = [...TOOL_MAP.keys()].join(", ");
        addEvent(session, { type: "error", message: `Unknown tool "${toolName}". Available: ${available}`, step });
        history.push({ role: "assistant", content: JSON.stringify(parsed) });
        history.push({ role: "user", content: `Unknown tool. Use one of: ${available}. JSON only.` });
        continue;
      }

      // Emit tool call event
      addEvent(session, { type: "tool_call", tool: toolName, args: toolArgs, step });

      // Execute tool (real action)
      let result: ToolResult;
      try {
        result = await tool.run(toolArgs);
      } catch (e) {
        result = { ok: false, error: String(e) };
      }

      // Emit tool result event
      addEvent(session, {
        type: "tool_result", tool: toolName,
        ok: result.ok, data: result.ok ? result.data : result.error,
        step,
      });

      // Finish
      if (toolName === "finish") {
        const summary = result.ok
          ? String((result.data as { summary: string }).summary)
          : "Task complete.";
        session.summary = summary;
        session.totalSteps = step;
        addEvent(session, { type: "done", summary, steps: step });
        session.status = "done";
        break;
      }

      // Feed observation back (keep messages short for TinyLlama)
      const obs = result.ok
        ? `OK(${toolName}): ${JSON.stringify(result.data).slice(0, 300)}`
        : `ERR(${toolName}): ${result.error}`;

      history.push({ role: "assistant", content: JSON.stringify({ thought, tool: toolName, args: toolArgs }) });
      history.push({ role: "user", content: `${obs}\n\nNext step? JSON only.` });
    }

    if (step >= limit && session.status === "running") {
      const summary = `Completed ${step} steps. Task may be partially done — check results above.`;
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
let autonomousInterval: ReturnType<typeof setInterval> | null = null;
export let autonomousEnabled = false;
const AUTONOMOUS_INTERVAL_MS = 30 * 60 * 1000; // 30 min

async function generateAutonomousTask(): Promise<string | null> {
  try {
    const [datasets, models, jobs] = await Promise.all([
      db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt)).limit(10),
      db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.createdAt)).limit(10),
      db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(3),
    ]);

    const lastJob = jobs[0];
    const lastJobMs = lastJob ? Date.now() - new Date(lastJob.createdAt).getTime() : Infinity;
    const lastJobHours = lastJobMs / 3600000;

    // Priority 1: models registered but never trained
    const trainedModelIds = new Set(jobs.map((j) => j.modelId));
    const untrained = models.filter((m) => !trainedModelIds.has(m.id));
    if (untrained.length > 0 && datasets.length > 0) {
      const m = untrained[0];
      const ds = datasets[0];
      return `Check model "${m.name}" (id: ${m.id}). It has no training jobs. Start training it using dataset "${ds.name}" (id: ${ds.id}).`;
    }

    // Priority 2: no training activity in 2+ hours → generate new samples
    if (lastJobHours > 2 && datasets.length > 0) {
      const ds = datasets[0];
      return `Generate 3 new training samples for dataset "${ds.name}" (id: ${ds.id}) about "effective AI model training techniques".`;
    }

    // Priority 3: no datasets at all → create one
    if (datasets.length === 0) {
      return `Create a dataset named "Foundation QA" (task type: qa) and generate 5 samples about "AI fundamentals".`;
    }

    // Priority 4: periodic system audit
    return `Audit the system: list all datasets, models, and recent training jobs. Summarize what has been built so far.`;
  } catch (e) {
    console.error("[Agent] autonomous task generation error:", e);
    return null;
  }
}

export function startAutonomousMode(): void {
  if (autonomousInterval) return;
  autonomousEnabled = true;
  console.log("[Agent] Autonomous mode ON — every 30 min");

  const run = async () => {
    if (!autonomousEnabled) return;
    const task = await generateAutonomousTask();
    if (task) {
      console.log("[Agent] Autonomous task:", task.slice(0, 80));
      const session = newSession(task, true);
      executeSession(session).catch(console.error);
    }
  };

  // First run after 2 minutes (not immediately)
  setTimeout(run, 2 * 60 * 1000);
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
    id: session.id, status: session.status, task: session.task, model: session.model,
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
  res.json({ enabled: autonomousEnabled, intervalMinutes: 30, model: AGENT_MODEL });
});

// POST /api/agent/autonomous — enable or disable autonomous mode
router.post("/agent/autonomous", (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (enabled) startAutonomousMode(); else stopAutonomousMode();
  res.json({ enabled: autonomousEnabled });
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
  res.json({ datasets, models, jobs, installedModels, autonomousEnabled, activeSessions: activeCount });
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
