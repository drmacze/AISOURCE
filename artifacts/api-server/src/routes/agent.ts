/**
 * DLavie OS — AI Developer Agent
 *
 * A ReAct (Reasoning + Acting) autonomous agent that can:
 *  - Create datasets, add training samples
 *  - Register and build AI models
 *  - Start and monitor training jobs
 *  - Search the web for AI research
 *  - Generate training data via LLM
 *  - Pull Ollama models
 *
 * Streams every thought, tool call, and result back to the client via SSE.
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
import { generateOllamaResponse } from "../ollama";
import { listOllamaModels } from "../ollama";

const router: IRouter = Router();

// ─── Tool definitions ─────────────────────────────────────────────────────────

interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

type AgentTool = {
  name: string;
  description: string;
  params: string;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};

const TOOLS: AgentTool[] = [
  {
    name: "list_datasets",
    description: "List all existing training datasets in the database.",
    params: "{}",
    async run() {
      const rows = await db
        .select()
        .from(trainingDatasetsTable)
        .orderBy(desc(trainingDatasetsTable.createdAt))
        .limit(20);
      return { ok: true, data: rows };
    },
  },
  {
    name: "create_dataset",
    description:
      'Create a new training dataset. Required: name (string), taskType (one of: "qa","generation","summarization","classification","translation"), optional: description (string).',
    params: '{"name": "...", "taskType": "...", "description": "..."}',
    async run(args) {
      const name = String(args.name || "");
      const taskType = String(args.taskType || "qa");
      const description = args.description ? String(args.description) : undefined;
      if (!name) return { ok: false, error: "name is required" };
      const validTypes = ["qa", "generation", "summarization", "classification", "translation"];
      if (!validTypes.includes(taskType))
        return { ok: false, error: `taskType must be one of: ${validTypes.join(", ")}` };
      const [row] = await db
        .insert(trainingDatasetsTable)
        .values({ name, taskType, description })
        .returning();
      return { ok: true, data: row };
    },
  },
  {
    name: "add_sample",
    description:
      "Add a training sample (input/output pair) to a dataset. Required: datasetId (number), input (string), output (string), optional: source (string).",
    params: '{"datasetId": 1, "input": "...", "output": "...", "source": "agent"}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const input = String(args.input || "");
      const output = String(args.output || "");
      if (!datasetId || !input || !output)
        return { ok: false, error: "datasetId, input, and output are required" };
      const [ds] = await db
        .select()
        .from(trainingDatasetsTable)
        .where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };
      const [row] = await db
        .insert(trainingSamplesTable)
        .values({ datasetId, input, expectedOutput: output, source: String(args.source || "agent") })
        .returning();
      return { ok: true, data: row };
    },
  },
  {
    name: "list_models",
    description: "List all registered AI models in the system.",
    params: "{}",
    async run() {
      const rows = await db
        .select()
        .from(aiModelsTable)
        .orderBy(desc(aiModelsTable.createdAt))
        .limit(20);
      return { ok: true, data: rows };
    },
  },
  {
    name: "create_model",
    description:
      "Register a new AI model. Required: name (string), type (string, e.g. 'llm','vision','embedding'), optional: description (string), architecture (base Ollama model e.g. 'tinyllama', 'llama3.2').",
    params: '{"name": "...", "type": "llm", "description": "...", "architecture": "tinyllama"}',
    async run(args) {
      const name = String(args.name || "");
      const type = String(args.type || "llm");
      const description = args.description ? String(args.description) : undefined;
      const architecture = args.architecture ? String(args.architecture) : undefined;
      if (!name) return { ok: false, error: "name is required" };
      const [row] = await db
        .insert(aiModelsTable)
        .values({ name, type, description, architecture })
        .returning();
      return { ok: true, data: row };
    },
  },
  {
    name: "list_jobs",
    description: "List recent training jobs and their status.",
    params: "{}",
    async run() {
      const rows = await db
        .select()
        .from(trainingJobsTable)
        .orderBy(desc(trainingJobsTable.createdAt))
        .limit(10);
      return { ok: true, data: rows };
    },
  },
  {
    name: "start_training",
    description:
      "Start a training job for a model on a dataset. Required: modelId (number), datasetId (number).",
    params: '{"modelId": 1, "datasetId": 1}',
    async run(args) {
      const modelId = Number(args.modelId);
      const datasetId = Number(args.datasetId);
      if (!modelId || !datasetId)
        return { ok: false, error: "modelId and datasetId are required" };
      const [model] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.id, modelId));
      if (!model) return { ok: false, error: `Model #${modelId} not found` };
      const [dataset] = await db
        .select()
        .from(trainingDatasetsTable)
        .where(eq(trainingDatasetsTable.id, datasetId));
      if (!dataset) return { ok: false, error: `Dataset #${datasetId} not found` };
      const [job] = await db
        .insert(trainingJobsTable)
        .values({
          modelId,
          datasetId,
          status: "pending",
          progress: 0,
          currentEpoch: 0,
          totalEpochs: 3,
        })
        .returning();
      // Kick off training in background (non-blocking)
      fetch(`http://127.0.0.1:${process.env.PORT || 8080}/training-jobs/${job.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
      return { ok: true, data: { job, message: `Training job #${job.id} queued for ${model.name} on dataset "${dataset.name}"` } };
    },
  },
  {
    name: "list_installed_models",
    description: "List AI models currently installed in Ollama (ready for inference).",
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
    name: "generate_samples",
    description:
      "Use the local LLM to auto-generate training sample pairs (input/output) for a dataset. Required: datasetId (number), topic (string), count (number, 1-10).",
    params: '{"datasetId": 1, "topic": "machine learning basics", "count": 5}',
    async run(args) {
      const datasetId = Number(args.datasetId);
      const topic = String(args.topic || "general AI");
      const count = Math.min(10, Math.max(1, Number(args.count) || 5));
      if (!datasetId) return { ok: false, error: "datasetId is required" };

      const [ds] = await db
        .select()
        .from(trainingDatasetsTable)
        .where(eq(trainingDatasetsTable.id, datasetId));
      if (!ds) return { ok: false, error: `Dataset #${datasetId} not found` };

      const prompt = `Generate ${count} training sample pairs about "${topic}" for a ${ds.taskType} task.
Return ONLY a JSON array like:
[{"input":"...","output":"..."},...]
No explanation, no markdown, just the JSON array.`;

      let raw = "";
      try {
        raw = await generateOllamaResponse(prompt, { timeout: 30000 });
        const jsonStart = raw.indexOf("[");
        const jsonEnd = raw.lastIndexOf("]");
        if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON array found");
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Array<{
          input: string;
          output: string;
        }>;
        const valid = parsed.filter((p) => p.input && p.output).slice(0, count);
        const inserted = [];
        for (const s of valid) {
          const [row] = await db
            .insert(trainingSamplesTable)
            .values({
              datasetId,
              input: s.input,
              expectedOutput: s.output,
              source: "agent-llm",
            })
            .returning();
          inserted.push(row);
        }
        return { ok: true, data: { generated: inserted.length, samples: inserted } };
      } catch (e) {
        return {
          ok: false,
          error: `LLM generation failed: ${String(e)}. Raw: ${raw.slice(0, 200)}`,
        };
      }
    },
  },
  {
    name: "search_web",
    description: "Search the web for AI research, papers, or model information.",
    params: '{"query": "..."}',
    async run(args) {
      const query = String(args.query || "");
      if (!query) return { ok: false, error: "query is required" };
      try {
        const res = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(8000) }
        );
        const data = (await res.json()) as {
          Abstract?: string;
          AbstractText?: string;
          RelatedTopics?: Array<{ Text?: string }>;
        };
        const summary =
          data.Abstract ||
          data.AbstractText ||
          (data.RelatedTopics || [])
            .slice(0, 3)
            .map((t) => t.Text)
            .filter(Boolean)
            .join(". ");
        return { ok: true, data: { query, summary: summary || "No results found" } };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "finish",
    description:
      "Signal that the task is complete. Required: summary (string) — a clear summary of everything accomplished.",
    params: '{"summary": "..."}',
    async run(args) {
      return { ok: true, data: { summary: String(args.summary || "Task complete.") } };
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
const TOOL_SCHEMA = TOOLS.map((t) => `- ${t.name}(${t.params}): ${t.description}`).join("\n");

// ─── ReAct system prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are DLavie Agent — an autonomous AI developer assistant inside DLavie OS.
Your job is to help build, train, and manage open-source AI models by taking real actions.

AVAILABLE TOOLS:
${TOOL_SCHEMA}

REASONING PROTOCOL (ReAct):
1. Think step-by-step about what to do next.
2. Choose ONE tool to call.
3. Observe the result.
4. Repeat until the task is fully complete, then call finish().

RESPONSE FORMAT — you MUST respond with valid JSON on every turn:
{
  "thought": "your reasoning about what to do next",
  "tool": "tool_name",
  "args": { ...tool arguments... }
}

RULES:
- Always call finish() when the task is complete.
- Never fabricate results; always use tools to get real data.
- When creating a model + training it, first create the dataset, add samples, create the model, then start_training.
- Be specific and decisive — don't ask clarifying questions, just act.
- Max 15 steps per task.`;
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

type AgentEvent =
  | { type: "thought"; content: string; step: number }
  | { type: "tool_call"; tool: string; args: Record<string, unknown>; step: number }
  | { type: "tool_result"; tool: string; ok: boolean; data: unknown; step: number }
  | { type: "done"; summary: string; steps: number }
  | { type: "error"; message: string };

function sendEvent(res: Response, event: AgentEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ─── Agent run ────────────────────────────────────────────────────────────────

router.post("/agent/run", async (req: Request, res: Response) => {
  const { task, maxSteps = 15 } = req.body as { task?: string; maxSteps?: number };

  if (!task || typeof task !== "string" || task.trim().length === 0) {
    res.status(400).json({ error: "task is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: `TASK: ${task.trim()}\n\nBegin. Respond only with valid JSON as instructed.`,
    },
  ];

  const limit = Math.min(Number(maxSteps) || 15, 20);
  let step = 0;

  try {
    while (step < limit) {
      step++;

      // Build prompt from message history
      const fullPrompt = messages
        .map((m) => {
          if (m.role === "system") return `[SYSTEM]\n${m.content}`;
          if (m.role === "user") return `[USER]\n${m.content}`;
          return `[ASSISTANT]\n${m.content}`;
        })
        .join("\n\n");

      // Call LLM
      let raw = "";
      try {
        raw = await generateOllamaResponse(fullPrompt);
      } catch (llmErr) {
        sendEvent(res, {
          type: "error",
          message: `LLM call failed: ${String(llmErr)}. Make sure Ollama is running and a model is installed.`,
        });
        break;
      }

      // Parse JSON response
      let parsed: { thought?: string; tool?: string; args?: Record<string, unknown> } = {};
      try {
        const jsonStart = raw.indexOf("{");
        const jsonEnd = raw.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("No JSON object found");
        }
      } catch {
        // Try to extract thought at least
        const thoughtMatch = raw.match(/"thought"\s*:\s*"([^"]+)"/);
        sendEvent(res, {
          type: "thought",
          content: thoughtMatch ? thoughtMatch[1] : raw.slice(0, 300),
          step,
        });
        // If we can't parse, try to recover by prompting again
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: "Your response was not valid JSON. Please respond with valid JSON only: {\"thought\":\"...\",\"tool\":\"...\",\"args\":{...}}",
        });
        continue;
      }

      const thought = String(parsed.thought || "");
      const toolName = String(parsed.tool || "");
      const toolArgs = (parsed.args || {}) as Record<string, unknown>;

      // Emit thought
      if (thought) {
        sendEvent(res, { type: "thought", content: thought, step });
      }

      // Check if tool exists
      const tool = TOOL_MAP.get(toolName);
      if (!tool) {
        const errMsg = `Unknown tool: "${toolName}". Available: ${[...TOOL_MAP.keys()].join(", ")}`;
        sendEvent(res, { type: "error", message: errMsg });
        messages.push({ role: "assistant", content: JSON.stringify(parsed) });
        messages.push({ role: "user", content: `ERROR: ${errMsg}. Pick a valid tool.` });
        continue;
      }

      // Emit tool call
      sendEvent(res, { type: "tool_call", tool: toolName, args: toolArgs, step });

      // Run tool
      let result: ToolResult;
      try {
        result = await tool.run(toolArgs);
      } catch (e) {
        result = { ok: false, error: String(e) };
      }

      // Emit tool result
      sendEvent(res, {
        type: "tool_result",
        tool: toolName,
        ok: result.ok,
        data: result.ok ? result.data : result.error,
        step,
      });

      // If finish(), wrap up
      if (toolName === "finish") {
        const summary = result.ok
          ? String((result.data as { summary: string }).summary)
          : "Task complete.";
        sendEvent(res, { type: "done", summary, steps: step });
        break;
      }

      // Feed result back to LLM
      const observationText = result.ok
        ? `OBSERVATION (${toolName}): ${JSON.stringify(result.data)}`
        : `ERROR (${toolName}): ${result.error}`;

      messages.push({ role: "assistant", content: JSON.stringify(parsed) });
      messages.push({ role: "user", content: `${observationText}\n\nContinue. What is your next action? Respond with JSON only.` });
    }

    if (step >= limit) {
      sendEvent(res, {
        type: "done",
        summary: `Reached maximum step limit (${limit}). Partial work may have been completed.`,
        steps: step,
      });
    }
  } catch (err) {
    sendEvent(res, { type: "error", message: String(err) });
  } finally {
    res.end();
  }
});

// ─── Agent tools info ─────────────────────────────────────────────────────────

router.get("/agent/tools", (_req, res) => {
  res.json(
    TOOLS.map((t) => ({ name: t.name, description: t.description, params: t.params }))
  );
});

// ─── Agent quick-status ───────────────────────────────────────────────────────

router.get("/agent/status", async (_req, res) => {
  const [datasets, models, jobs] = await Promise.all([
    db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt)).limit(5),
    db.select().from(aiModelsTable).orderBy(desc(aiModelsTable.createdAt)).limit(5),
    db.select().from(trainingJobsTable).orderBy(desc(trainingJobsTable.createdAt)).limit(5),
  ]);
  let installedModels: unknown[] = [];
  try {
    installedModels = await listOllamaModels();
  } catch {}
  res.json({ datasets, models, jobs, installedModels });
});

export default router;
