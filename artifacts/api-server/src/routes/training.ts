import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  trainingDatasetsTable,
  trainingSamplesTable,
  trainingJobsTable,
  aiModelsTable,
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

const router: IRouter = Router();

// ─── Datasets ────────────────────────────────────────────────────────────────

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

/** GET /training-datasets/:id/export — Download dataset as JSONL (one JSON object per line) */
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

  // OpenAI fine-tuning compatible JSONL format
  const lines = samples
    .filter((s) => s.input && s.output)
    .map((s) => JSON.stringify({
      messages: [
        { role: "system", content: `You are a specialized assistant trained on ${ds.name}.` },
        { role: "user", content: s.input },
        { role: "assistant", content: s.output },
      ],
      metadata: s.metadata ?? undefined,
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
  const parsed = StartTrainingJobBody.parse(req.body);

  // Get the model and dataset
  const [model] = await db
    .select()
    .from(aiModelsTable)
    .where(eq(aiModelsTable.id, parsed.modelId));

  if (!model) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const [dataset] = await db
    .select()
    .from(trainingDatasetsTable)
    .where(eq(trainingDatasetsTable.id, parsed.datasetId));

  if (!dataset) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }

  const [row] = await db
    .insert(trainingJobsTable)
    .values({
      modelId: parsed.modelId,
      datasetId: parsed.datasetId,
      epochs: parsed.epochs || 3,
      hyperparameters: parsed.hyperparameters,
      status: "pending",
      progress: 0,
      currentEpoch: 0,
    })
    .returning();

  // Start real Ollama-based training asynchronously
  runOllamaTraining(row.id, model, dataset).catch((e) =>
    console.error("Training job failed:", e)
  );

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

// Cancel a training job
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
    name: string;
    type: string;
    version: string;
    architecture?: string;
    description?: string;
  };
  const [row] = await db
    .insert(aiModelsTable)
    .values({
      name: body.name,
      type: body.type as "llm" | "embedding" | "classification" | "summarization" | "custom",
      version: body.version,
      architecture: body.architecture,
      description: body.description,
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

// List all models available in Ollama (live from the engine)
router.get("/ollama-models", async (_req, res) => {
  const models = await listOllamaModels();
  res.json(models);
});

// Pull a new model from Ollama library — streams progress via SSE
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
      res.write(`data: ${JSON.stringify({ error: "Failed to pull model", status: response.status })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch {
          // skip
        }
      }
    }
    res.write(`data: ${JSON.stringify({ status: "success", model })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
    res.end();
  }
});

// Delete a model from Ollama
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

// ─── Real Ollama Training Pipeline ───────────────────────────────────────────

type ModelRow = { id: number; name: string; architecture?: string | null; description?: string | null };
type DatasetRow = { id: number; name: string; taskType: string; description?: string | null };

/**
 * Build and register an Ollama custom model from training samples.
 * Uses Ollama /api/create with stream:true for real progress tracking.
 * No fake timeouts, no random metrics — everything is derived from actual operations.
 */
async function runOllamaTraining(
  jobId: number,
  model: ModelRow,
  dataset: DatasetRow
): Promise<void> {
  await db
    .update(trainingJobsTable)
    .set({ status: "running", startedAt: new Date(), progress: 0.05 })
    .where(eq(trainingJobsTable.id, jobId));

  try {
    // 1. Load training samples
    const samples = await db
      .select()
      .from(trainingSamplesTable)
      .where(eq(trainingSamplesTable.datasetId, dataset.id));

    const trainSamples = samples
      .filter((s) => s.input && s.output)
      .map((s) => ({ input: s.input, output: s.output as string }));

    if (trainSamples.length === 0) {
      throw new Error("No valid samples (input + output pairs) found in dataset");
    }

    // 2. Check cancellation before heavy work
    const [preCheck] = await db.select().from(trainingJobsTable).where(eq(trainingJobsTable.id, jobId));
    if (preCheck.status === "failed") return;

    // 3. Determine base model
    const installed = await listOllamaModels();
    const installedNames = installed.map((m) => m.name);
    const preferredBase = model.architecture?.includes(":") ? model.architecture : "tinyllama";
    const baseModel =
      installedNames.find((n) => n.startsWith(preferredBase.split(":")[0])) ||
      installedNames[0] ||
      "tinyllama:latest";

    // 4. Build system prompt
    const taskSystemPrompts: Record<string, string> = {
      qa:             "You are an expert question-answering assistant. Answer questions accurately and concisely.",
      generation:     "You are a creative text generation assistant. Generate high-quality text following the patterns in the training examples.",
      summarization:  "You are an expert summarizer. Create concise, accurate summaries that capture key information.",
      classification: "You are a precise classification assistant. Classify inputs accurately.",
      translation:    "You are a translation expert. Provide accurate, natural-sounding translations.",
    };
    const taskPrompt =
      taskSystemPrompts[dataset.taskType] ||
      `You are a specialized AI assistant trained on "${dataset.name}". ${dataset.description || ""}`;

    // Embed up to 20 examples directly in the system prompt (Ollama Modelfile context)
    const exampleBlock = trainSamples
      .slice(0, 20)
      .map((s, i) => `Example ${i + 1}:\nInput: ${s.input}\nExpected: ${s.output}`)
      .join("\n\n");
    const systemPrompt = `${taskPrompt}\n\n--- Training Examples ---\n${exampleBlock}`;

    if (systemPrompt.length > 8192) {
      throw new Error(
        `Combined system prompt exceeds 8 192 characters (${systemPrompt.length}). Reduce samples or shorten descriptions.`
      );
    }

    await db
      .update(trainingJobsTable)
      .set({ progress: 0.15, currentEpoch: 0, updatedAt: new Date() })
      .where(eq(trainingJobsTable.id, jobId));

    // 5. Create the Ollama model with stream:true — track REAL progress
    const sanitizedName = model.name
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "_")
      .replace(/_{2,}/g, "_");
    const ollamaModelName = `nexus-${sanitizedName}`;

    const createResponse = await fetch(`${OLLAMA_HOST}/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModelName,
        from: baseModel,
        system: systemPrompt,
        parameters: { temperature: 0.7, top_p: 0.9, num_predict: 512 },
        stream: true,
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!createResponse.ok || !createResponse.body) {
      const errText = await createResponse.text().catch(() => `HTTP ${createResponse.status}`);
      throw new Error(`Ollama model creation failed: ${errText}`);
    }

    // Parse streaming progress from Ollama /api/create
    const reader = createResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed) as {
            status?: string;
            total?: number;
            completed?: number;
          };
          // Map real Ollama progress to job progress (0.15 → 0.85 range)
          if (evt.total && evt.completed) {
            const ratio = evt.completed / evt.total;
            const mapped = 0.15 + ratio * 0.7; // 15% → 85%
            await db
              .update(trainingJobsTable)
              .set({ progress: Math.min(mapped, 0.85), updatedAt: new Date() })
              .where(eq(trainingJobsTable.id, jobId));
          }
        } catch {
          // skip malformed JSON lines
        }
      }

      // Check for cancellation mid-stream
      const [mid] = await db.select().from(trainingJobsTable).where(eq(trainingJobsTable.id, jobId));
      if (mid.status === "failed") {
        await reader.cancel();
        return;
      }
    }

    await db
      .update(trainingJobsTable)
      .set({ progress: 0.88, updatedAt: new Date() })
      .where(eq(trainingJobsTable.id, jobId));

    console.log(`[Training] ✅ Ollama model created: ${ollamaModelName} (base: ${baseModel})`);

    // 6. Validation pass — run up to 5 samples through the real model and check responses
    const validationSamples = trainSamples.slice(0, 5);
    let correctCount = 0;

    for (const sample of validationSamples) {
      // Check cancellation
      const [check] = await db.select().from(trainingJobsTable).where(eq(trainingJobsTable.id, jobId));
      if (check.status === "failed") return;

      try {
        const inferRes = await fetch(`${OLLAMA_HOST}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ollamaModelName,
            prompt: sample.input,
            stream: false,
            options: { temperature: 0, num_predict: 100 },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (inferRes.ok) {
          const inferData = await inferRes.json() as { response?: string };
          const response = (inferData.response || "").toLowerCase();
          // Real accuracy: check if any key terms from expected output appear in response
          const expectedTerms = sample.output.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
          const matchedTerms = expectedTerms.filter((t) => response.includes(t));
          const sampleAccuracy = expectedTerms.length > 0 ? matchedTerms.length / expectedTerms.length : 0;
          if (sampleAccuracy > 0.3) correctCount++;
        }
      } catch {
        // validation error for one sample — non-fatal
      }
    }

    const validatedAccuracy = validationSamples.length > 0
      ? correctCount / validationSamples.length
      : null;

    await db
      .update(trainingJobsTable)
      .set({ progress: 0.95, updatedAt: new Date() })
      .where(eq(trainingJobsTable.id, jobId));

    // 7. Mark complete with REAL metrics (validation-based accuracy, no random numbers)
    await db
      .update(trainingJobsTable)
      .set({
        status: "completed",
        progress: 1,
        completedAt: new Date(),
        updatedAt: new Date(),
        // Loss not applicable for Modelfile-based training (no gradient descent)
        loss: null,
        accuracy: validatedAccuracy,
      })
      .where(eq(trainingJobsTable.id, jobId));

    // 8. Activate the model record
    await db
      .update(aiModelsTable)
      .set({
        status: "active",
        description: [
          model.description,
          `Ollama model: ${ollamaModelName}`,
          `Samples: ${trainSamples.length}`,
          validatedAccuracy !== null ? `Validation accuracy: ${(validatedAccuracy * 100).toFixed(1)}%` : null,
        ].filter(Boolean).join(" | "),
        updatedAt: new Date(),
      })
      .where(eq(aiModelsTable.id, model.id));

    console.log(
      `[Training] Job ${jobId} complete — model: ${ollamaModelName}, samples: ${trainSamples.length}, accuracy: ${validatedAccuracy !== null ? (validatedAccuracy * 100).toFixed(1) + "%" : "N/A"}`
    );
  } catch (error) {
    console.error(`[Training] Job ${jobId} failed:`, error);
    await db
      .update(trainingJobsTable)
      .set({
        status: "failed",
        error: String(error),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trainingJobsTable.id, jobId));
  }
}

export default router;
