import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  trainingDatasetsTable,
  trainingSamplesTable,
  trainingJobsTable,
  aiModelsTable,
  TASK_TYPES,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  CreateTrainingDatasetBody,
  AddTrainingSampleParams,
  AddTrainingSampleBody,
  StartTrainingJobBody,
  GetTrainingDatasetParams,
  GetTrainingJobParams,
} from "@workspace/api-zod";
import { OLLAMA_HOST, listOllamaModels } from "../ollama";
import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const router: IRouter = Router();

// ─── Model family auto-detection ─────────────────────────────────────────────

type ModelFamilyInfo = {
  family: string;
  chatTemplate: string;
  recommendedTaskTypes: string[];
  notes: string;
};

function detectModelFamily(modelName: string): ModelFamilyInfo {
  const m = modelName.toLowerCase();

  if (m.includes("qwen2.5-coder") || m.includes("deepseek-coder") || m.includes("codellama") || m.includes("starcoder")) {
    return {
      family: "code",
      chatTemplate: "chatml",
      recommendedTaskTypes: ["code_generation", "code_review", "text_to_sql", "function_calling", "reasoning"],
      notes: "Code model: optimized for code generation, review, SQL, and tool calling.",
    };
  }
  if (m.includes("qwen2.5") || m.includes("qwen2") || m.includes("qwen")) {
    return {
      family: "qwen",
      chatTemplate: "chatml",
      recommendedTaskTypes: ["instruction_following", "chat", "multilingual", "reasoning", "math", "function_calling"],
      notes: "Qwen model: excellent multilingual, math, and reasoning capabilities.",
    };
  }
  if (m.includes("deepseek-r1") || m.includes("deepseek")) {
    return {
      family: "deepseek",
      chatTemplate: "chatml",
      recommendedTaskTypes: ["reasoning", "math", "chain_of_thought", "code_generation", "instruction_following"],
      notes: "DeepSeek-R1: specialized for chain-of-thought reasoning and math.",
    };
  }
  if (m.includes("llama3") || m.includes("llama-3") || m.includes("llama3.2") || m.includes("llama3.1")) {
    return {
      family: "llama3",
      chatTemplate: "llama3",
      recommendedTaskTypes: ["instruction_following", "chat", "reasoning", "summarization", "qa", "creative_writing"],
      notes: "Llama 3: strong general-purpose model with excellent instruction following.",
    };
  }
  if (m.includes("llama2") || m.includes("llama-2")) {
    return {
      family: "llama2",
      chatTemplate: "llama2",
      recommendedTaskTypes: ["instruction_following", "chat", "summarization", "qa", "translation"],
      notes: "Llama 2: reliable general-purpose model.",
    };
  }
  if (m.includes("mistral") || m.includes("mixtral")) {
    return {
      family: "mistral",
      chatTemplate: "mistral",
      recommendedTaskTypes: ["instruction_following", "chat", "reasoning", "multilingual", "summarization"],
      notes: "Mistral: fast, efficient model with strong multilingual support.",
    };
  }
  if (m.includes("phi4") || m.includes("phi3") || m.includes("phi-")) {
    return {
      family: "phi",
      chatTemplate: "chatml",
      recommendedTaskTypes: ["reasoning", "math", "code_generation", "instruction_following", "chain_of_thought"],
      notes: "Phi model: Microsoft's compact but powerful reasoning model.",
    };
  }
  if (m.includes("gemma")) {
    return {
      family: "gemma",
      chatTemplate: "gemma",
      recommendedTaskTypes: ["instruction_following", "chat", "summarization", "qa", "creative_writing"],
      notes: "Gemma: Google's open model, strong at following instructions.",
    };
  }
  if (m.includes("tinyllama") || m.includes("smollm") || m.includes("small")) {
    return {
      family: "small",
      chatTemplate: "alpaca",
      recommendedTaskTypes: ["instruction_following", "qa", "classification", "sentiment", "ner"],
      notes: "Small model: best for simple tasks. LoRA fine-tuning will be fast on CPU.",
    };
  }

  return {
    family: "general",
    chatTemplate: "alpaca",
    recommendedTaskTypes: ["instruction_following", "chat", "qa", "summarization", "generation"],
    notes: "General-purpose model.",
  };
}

// ─── Datasets ─────────────────────────────────────────────────────────────────

router.get("/training-datasets", async (_req, res) => {
  const rows = await db
    .select()
    .from(trainingDatasetsTable)
    .orderBy(desc(trainingDatasetsTable.createdAt));
  res.json(rows);
});

router.post("/training-datasets", async (req, res) => {
  const parsed = CreateTrainingDatasetBody.parse(req.body);
  const [row] = await db
    .insert(trainingDatasetsTable)
    .values({
      name: parsed.name,
      description: parsed.description,
      taskType: parsed.taskType,
    })
    .returning();
  res.status(201).json(row);
});

router.get("/training-datasets/:id", async (req, res) => {
  const { id } = GetTrainingDatasetParams.parse(req.params);
  const [ds] = await db
    .select()
    .from(trainingDatasetsTable)
    .where(eq(trainingDatasetsTable.id, id));
  if (!ds) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }
  const samples = await db
    .select()
    .from(trainingSamplesTable)
    .where(eq(trainingSamplesTable.datasetId, id))
    .orderBy(trainingSamplesTable.createdAt);
  res.json({ ...ds, samples });
});

// ─── Auto-config endpoint ─────────────────────────────────────────────────────

router.get("/training-datasets/:id/auto-config", async (req: Request, res: Response) => {
  const modelName = (req.query.modelName as string) || "tinyllama";
  const info = detectModelFamily(modelName);
  const baseName = modelName.split(":")[0].replace(/[^a-z0-9]/gi, "_");
  res.json({
    modelName,
    modelFamily: info.family,
    recommendedTaskTypes: info.recommendedTaskTypes,
    chatTemplate: info.chatTemplate,
    suggestedDatasetName: `${baseName}_${info.family}_dataset`,
    notes: info.notes,
  });
});

router.get("/training-datasets/:id/export", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid dataset id" }); return; }

  const [ds] = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, id));
  if (!ds) { res.status(404).json({ error: "Dataset not found" }); return; }

  const samples = await db
    .select()
    .from(trainingSamplesTable)
    .where(eq(trainingSamplesTable.datasetId, id))
    .orderBy(trainingSamplesTable.createdAt);

  const lines = samples
    .filter((s) => s.input && s.output)
    .map((s) => JSON.stringify({
      messages: [
        { role: "system", content: `You are a specialized assistant trained on ${ds.name}.` },
        { role: "user", content: s.input },
        { role: "assistant", content: s.output },
      ],
    }));

  const filename = `${ds.name.replace(/[^a-z0-9_-]/gi, "_")}_${id}.jsonl`;
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n") + "\n");
});

router.post("/training-datasets/:id/samples", async (req, res) => {
  const { id } = AddTrainingSampleParams.parse(req.params);
  const parsed = AddTrainingSampleBody.parse(req.body);
  const [row] = await db
    .insert(trainingSamplesTable)
    .values({
      datasetId: id,
      input: parsed.input,
      output: parsed.output,
      label: parsed.label,
      metadata: parsed.metadata,
    })
    .returning();

  const count = await db
    .select()
    .from(trainingSamplesTable)
    .where(eq(trainingSamplesTable.datasetId, id));
  await db
    .update(trainingDatasetsTable)
    .set({ sampleCount: count.length, updatedAt: new Date() })
    .where(eq(trainingDatasetsTable.id, id));

  res.status(201).json(row);
});

// ─── Training Jobs ────────────────────────────────────────────────────────────

router.get("/training-jobs", async (_req, res) => {
  const rows = await db
    .select()
    .from(trainingJobsTable)
    .orderBy(desc(trainingJobsTable.createdAt));
  res.json(rows);
});

router.post("/training-jobs", async (req, res) => {
  const body = req.body as {
    modelId: number;
    datasetId: number;
    epochs?: number;
    hyperparameters?: string;
    trainingBackend?: "hf_api" | "local_cpu";
    loraRank?: number;
    learningRate?: number;
    batchSize?: number;
    maxSeqLength?: number;
  };

  const [model] = await db
    .select()
    .from(aiModelsTable)
    .where(eq(aiModelsTable.id, body.modelId));

  if (!model) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const [dataset] = await db
    .select()
    .from(trainingDatasetsTable)
    .where(eq(trainingDatasetsTable.id, body.datasetId));

  if (!dataset) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }

  const backend = body.trainingBackend || "local_cpu";
  const loraRank = body.loraRank || 16;
  const learningRate = body.learningRate || 0.0002;
  const epochs = body.epochs || 3;

  const [row] = await db
    .insert(trainingJobsTable)
    .values({
      modelId: body.modelId,
      datasetId: body.datasetId,
      epochs,
      hyperparameters: body.hyperparameters,
      status: "pending",
      progress: 0,
      currentEpoch: 0,
      trainingBackend: backend,
      loraRank,
      learningRate,
      baseModelName: model.ollamaName || model.architecture || "tinyllama",
    })
    .returning();

  runRealFineTuning(row.id, model, dataset, {
    backend,
    epochs,
    loraRank,
    learningRate,
    batchSize: body.batchSize || 2,
    maxSeqLength: body.maxSeqLength || 512,
  }).catch((e) => console.error("[Training] Job failed:", e));

  res.status(201).json(row);
});

router.get("/training-jobs/:id", async (req, res) => {
  const { id } = GetTrainingJobParams.parse(req.params);
  const [row] = await db
    .select()
    .from(trainingJobsTable)
    .where(eq(trainingJobsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(row);
});

router.post("/training-jobs/:id/cancel", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select()
    .from(trainingJobsTable)
    .where(eq(trainingJobsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (row.status !== "running" && row.status !== "pending") {
    res.status(400).json({ error: `Job is ${row.status}, cannot cancel` });
    return;
  }
  const [updated] = await db
    .update(trainingJobsTable)
    .set({ status: "failed", error: "Cancelled by user", completedAt: new Date() })
    .where(eq(trainingJobsTable.id, id))
    .returning();

  // Kill the associated Python process if running
  const pid = activePythonJobs.get(id);
  if (pid) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
    activePythonJobs.delete(id);
  }
  res.json(updated);
});

// ─── AI Models ────────────────────────────────────────────────────────────────

router.get("/ai-models", async (_req, res) => {
  const rows = await db
    .select()
    .from(aiModelsTable)
    .orderBy(desc(aiModelsTable.createdAt));
  res.json(rows);
});

router.post("/ai-models", async (req, res) => {
  const body = req.body as {
    name: string; type: string; version: string;
    architecture?: string; description?: string;
    ollamaName?: string; baseOllamaModel?: string;
    parameterCount?: string; quantization?: string;
  };
  const [row] = await db
    .insert(aiModelsTable)
    .values({
      name: body.name,
      type: body.type as "llm" | "embedding" | "classification" | "summarization" | "custom",
      version: body.version,
      architecture: body.architecture,
      description: body.description,
      ollamaName: body.ollamaName,
      baseOllamaModel: body.baseOllamaModel,
      parameterCount: body.parameterCount,
      quantization: body.quantization,
      status: "inactive",
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/ai-models/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .delete(aiModelsTable)
    .where(eq(aiModelsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Model not found" });
    return;
  }
  res.status(204).send();
});

// ─── Ollama Live Models ───────────────────────────────────────────────────────

router.get("/ollama-models", async (_req, res) => {
  const models = await listOllamaModels();
  res.json(models);
});

router.post("/ollama-models/pull", async (req, res) => {
  const { model } = req.body as { model?: string };
  if (!model || typeof model !== "string") {
    res.status(400).json({ error: "model name required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const response = await fetch("http://127.0.0.1:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(600000),
    });

    if (!response.ok || !response.body) {
      res.write(`data: ${JSON.stringify({ error: "Failed to pull model" })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n").filter((l) => l.trim())) {
        try {
          const parsed = JSON.parse(line);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch { /* skip */ }
      }
    }
    res.write(`data: ${JSON.stringify({ status: "success", model })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
    res.end();
  }
});

router.delete("/ollama-models/:name", async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  try {
    const response = await fetch("http://127.0.0.1:11434/api/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const err = await response.text();
      res.status(400).json({ error: err });
      return;
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ─── Samples endpoint ─────────────────────────────────────────────────────────

router.get("/training-datasets/:id/samples", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid dataset id" }); return; }

  const { source, minLength, search, limit = "200", offset = "0" } = req.query as Record<string, string>;

  let samples = await db.select().from(trainingSamplesTable)
    .where(eq(trainingSamplesTable.datasetId, id))
    .orderBy(desc(trainingSamplesTable.createdAt));

  if (source && source !== "all") {
    samples = samples.filter((s) => s.source === source);
  }
  if (minLength) {
    const min = parseInt(minLength, 10);
    samples = samples.filter((s) => (s.input?.length || 0) + (s.output?.length || 0) >= min);
  }
  if (search) {
    const q = search.toLowerCase();
    samples = samples.filter((s) =>
      s.input?.toLowerCase().includes(q) || s.output?.toLowerCase().includes(q)
    );
  }

  const total = samples.length;
  const lim = parseInt(limit, 10) || 200;
  const off = parseInt(offset, 10) || 0;
  const page = samples.slice(off, off + lim);

  const scored = page.map((s) => {
    const inputLen = s.input?.length || 0;
    const outputLen = s.output?.length || 0;
    const ratio = outputLen > 0 ? Math.min(outputLen / Math.max(inputLen, 1), 5) : 0;
    const quality = Math.min(
      0.3 * Math.min(inputLen / 100, 1) +
      0.3 * Math.min(outputLen / 200, 1) +
      0.2 * (ratio > 0.2 && ratio < 10 ? 1 : 0) +
      0.2 * (s.source ? 1 : 0),
      1
    );
    return { ...s, qualityScore: Math.round(quality * 100) };
  });

  res.json({ total, limit: lim, offset: off, samples: scored });
});

router.post("/training-datasets/:id/deduplicate", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid dataset id" }); return; }

  const samples = await db.select().from(trainingSamplesTable)
    .where(eq(trainingSamplesTable.datasetId, id))
    .orderBy(trainingSamplesTable.createdAt);

  const seen = new Set<string>();
  const duplicateIds: number[] = [];

  for (const s of samples) {
    const key = (s.input || "").trim().toLowerCase().slice(0, 200);
    if (seen.has(key)) {
      duplicateIds.push(s.id);
    } else {
      seen.add(key);
    }
  }

  if (duplicateIds.length === 0) {
    res.json({ removed: 0, message: "No duplicates found" });
    return;
  }

  for (const dupId of duplicateIds) {
    await db.delete(trainingSamplesTable).where(eq(trainingSamplesTable.id, dupId));
  }

  const remaining = await db.select().from(trainingSamplesTable).where(eq(trainingSamplesTable.datasetId, id));
  await db.update(trainingDatasetsTable)
    .set({ sampleCount: remaining.length, updatedAt: new Date() })
    .where(eq(trainingDatasetsTable.id, id));

  res.json({ removed: duplicateIds.length, remaining: remaining.length });
});

// ─── Real LoRA Fine-Tuning Pipeline ──────────────────────────────────────────

type ModelRow = { id: number; name: string; architecture?: string | null; description?: string | null; ollamaName?: string | null; baseOllamaModel?: string | null };
type DatasetRow = { id: number; name: string; taskType: string; description?: string | null };

const activePythonJobs = new Map<number, number>(); // jobId → PID

export async function runRealFineTuning(
  jobId: number,
  model: ModelRow,
  dataset: DatasetRow,
  opts: {
    backend: "hf_api" | "local_cpu";
    epochs: number;
    loraRank: number;
    learningRate: number;
    batchSize: number;
    maxSeqLength: number;
  }
): Promise<void> {
  await db
    .update(trainingJobsTable)
    .set({ status: "running", startedAt: new Date(), progress: 0.02 })
    .where(eq(trainingJobsTable.id, jobId));

  await db
    .update(aiModelsTable)
    .set({ status: "training", updatedAt: new Date() })
    .where(eq(aiModelsTable.id, model.id));

  try {
    // 1. Load samples
    const samples = await db
      .select()
      .from(trainingSamplesTable)
      .where(eq(trainingSamplesTable.datasetId, dataset.id));

    const validSamples = samples.filter((s) => s.input && s.output);
    if (validSamples.length === 0) {
      throw new Error("No valid samples (need input + output pairs). Add samples to the dataset first.");
    }

    // 2. Check cancellation
    const [preCheck] = await db.select().from(trainingJobsTable).where(eq(trainingJobsTable.id, jobId));
    if (preCheck.status === "failed") return;

    // 3. Export dataset to JSONL
    const WORKSPACE = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
    const jobDir = join(WORKSPACE, ".training-artifacts", `job-${jobId}`);
    const datasetPath = join(jobDir, "dataset.jsonl");
    const outputDir = join(jobDir, "output");

    mkdirSync(jobDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const jsonlLines = validSamples.map((s) =>
      JSON.stringify({
        input: s.input,
        output: s.output,
        source: s.source,
        label: s.label,
      })
    );
    writeFileSync(datasetPath, jsonlLines.join("\n") + "\n", "utf8");

    console.log(`[Training] Job ${jobId}: exported ${validSamples.length} samples to ${datasetPath}`);

    await db
      .update(trainingJobsTable)
      .set({ progress: 0.05 })
      .where(eq(trainingJobsTable.id, jobId));

    // 4. Determine base model
    const baseModel = model.ollamaName || model.baseOllamaModel || model.architecture || "tinyllama";
    const outputName = model.name.toLowerCase().replace(/[^a-z0-9]/g, "_");

    // 5. Spawn Python fine-tuning process
    const scriptPath = join(WORKSPACE, "scripts", "finetune_lora.py");
    const hfToken = process.env.HF_TOKEN || "";

    const pythonArgs = [
      scriptPath,
      "--job-id", String(jobId),
      "--dataset-path", datasetPath,
      "--output-dir", outputDir,
      "--base-model", baseModel,
      "--output-name", outputName,
      "--epochs", String(opts.epochs),
      "--lora-rank", String(opts.loraRank),
      "--learning-rate", String(opts.learningRate),
      "--batch-size", String(opts.batchSize),
      "--max-seq-length", String(opts.maxSeqLength),
      "--task-type", dataset.taskType,
      "--backend", opts.backend,
      ...(hfToken ? ["--hf-token", hfToken] : []),
    ];

    console.log(`[Training] Job ${jobId}: spawning Python LoRA fine-tuning (backend: ${opts.backend})`);

    const lossHistory: Array<{ step: number; epoch: number; loss: number }> = [];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("python3", pythonArgs, {
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      activePythonJobs.set(jobId, proc.pid!);

      let stderrBuf = "";
      proc.stderr?.on("data", (data: Buffer) => {
        stderrBuf += data.toString();
        // Log warnings/errors from Python
        const lines = stderrBuf.split("\n");
        stderrBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) console.log(`[Training:stderr] ${line}`);
        }
      });

      let stdoutBuf = "";
      proc.stdout?.on("data", async (data: Buffer) => {
        stdoutBuf += data.toString();
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed) as {
              type: string;
              progress?: number;
              epoch?: number;
              step?: number;
              loss?: number;
              lr?: number;
              accuracy?: number;
              message?: string;
              output_dir?: string;
              ollama_name?: string;
              total_epochs?: number;
              avg_loss?: number;
            };

            console.log(`[Training:${jobId}] ${JSON.stringify(evt)}`);

            // Check for cancellation
            const [check] = await db.select().from(trainingJobsTable).where(eq(trainingJobsTable.id, jobId));
            if (check.status === "failed") {
              proc.kill("SIGTERM");
              return;
            }

            if (evt.type === "progress" && evt.progress !== undefined) {
              if (evt.step && evt.epoch && evt.loss !== undefined) {
                lossHistory.push({ step: evt.step, epoch: evt.epoch, loss: evt.loss });
              }
              await db.update(trainingJobsTable).set({
                progress: Math.min(0.1 + evt.progress * 0.85, 0.95),
                currentEpoch: evt.epoch || 0,
                loss: evt.loss,
                lossHistory: JSON.stringify(lossHistory.slice(-200)),
                updatedAt: new Date(),
              }).where(eq(trainingJobsTable.id, jobId));
            } else if (evt.type === "epoch_done") {
              await db.update(trainingJobsTable).set({
                currentEpoch: evt.epoch || 0,
                loss: evt.avg_loss,
                updatedAt: new Date(),
              }).where(eq(trainingJobsTable.id, jobId));
            } else if (evt.type === "status" || evt.type === "init") {
              await db.update(trainingJobsTable).set({ updatedAt: new Date() }).where(eq(trainingJobsTable.id, jobId));
            } else if (evt.type === "validation_done") {
              await db.update(trainingJobsTable).set({
                accuracy: evt.accuracy ?? null,
                updatedAt: new Date(),
              }).where(eq(trainingJobsTable.id, jobId));
            } else if (evt.type === "done") {
              // Final: update model and job
              await db.update(aiModelsTable).set({
                status: "active",
                ollamaName: evt.ollama_name || undefined,
                description: [
                  model.description,
                  `LoRA fine-tuned | samples: ${validSamples.length}`,
                  `backend: ${opts.backend}`,
                  evt.accuracy !== null && evt.accuracy !== undefined ? `val_accuracy: ${(evt.accuracy * 100).toFixed(1)}%` : null,
                  lossHistory.length > 0 ? `final_loss: ${lossHistory[lossHistory.length - 1]?.loss?.toFixed(4)}` : null,
                ].filter(Boolean).join(" | "),
                updatedAt: new Date(),
              }).where(eq(aiModelsTable.id, model.id));
            } else if (evt.type === "error") {
              console.error(`[Training:${jobId}] Python error: ${evt.message}`);
            }
          } catch { /* skip malformed lines */ }
        }
      });

      proc.on("close", async (code) => {
        activePythonJobs.delete(jobId);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Python process exited with code ${code}. Check logs.`));
        }
      });

      proc.on("error", (err) => {
        activePythonJobs.delete(jobId);
        reject(new Error(`Failed to spawn Python: ${err.message}. Ensure python3 is available.`));
      });
    });

    // 6. Mark complete
    const [finalJob] = await db.select().from(trainingJobsTable).where(eq(trainingJobsTable.id, jobId));
    await db.update(trainingJobsTable).set({
      status: "completed",
      progress: 1,
      completedAt: new Date(),
      updatedAt: new Date(),
      lossHistory: JSON.stringify(lossHistory.slice(-200)),
      outputModelPath: outputDir,
    }).where(eq(trainingJobsTable.id, jobId));

    console.log(`[Training] Job ${jobId} COMPLETED — ${validSamples.length} samples, ${opts.epochs} epochs, LoRA rank ${opts.loraRank}`);

    // Fire webhooks
    try {
      const { fireWebhooks } = await import("./training-advanced");
      await fireWebhooks("job.completed", {
        jobId,
        modelId: model.id,
        modelName: model.name,
        samples: validSamples.length,
        epochs: opts.epochs,
      });
    } catch { /* webhook errors must not fail training */ }

  } catch (error) {
    console.error(`[Training] Job ${jobId} FAILED:`, error);
    activePythonJobs.delete(jobId);
    await db.update(trainingJobsTable).set({
      status: "failed",
      error: String(error),
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(trainingJobsTable.id, jobId));
    await db.update(aiModelsTable).set({
      status: "inactive",
      updatedAt: new Date(),
    }).where(eq(aiModelsTable.id, model.id));

    // Fire failure webhook
    try {
      const { fireWebhooks } = await import("./training-advanced");
      await fireWebhooks("job.failed", { jobId, modelId: model.id, error: String(error) });
    } catch { /* ignore */ }
  }
}

export default router;
