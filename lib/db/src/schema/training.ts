import { pgTable, serial, text, integer, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const TASK_TYPES = [
  "instruction_following", "chat", "multilingual",
  "code_generation", "code_review", "text_to_sql",
  "reasoning", "math", "chain_of_thought",
  "ner", "sentiment", "data_extraction",
  "creative_writing", "question_generation",
  "function_calling",
  "classification", "generation", "summarization", "qa", "translation",
] as const;

export type TaskType = typeof TASK_TYPES[number];

export const TRAINING_BACKENDS = ["hf_api", "local_cpu"] as const;
export type TrainingBackend = typeof TRAINING_BACKENDS[number];

// ─── Core Training Tables ──────────────────────────────────────────────────────

export const trainingDatasetsTable = pgTable("training_datasets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  taskType: text("task_type").notNull(),
  sampleCount: integer("sample_count").default(0).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const trainingSamplesTable = pgTable("training_samples", {
  id: serial("id").primaryKey(),
  datasetId: integer("dataset_id").notNull(),
  input: text("input").notNull(),
  output: text("output"),
  label: text("label"),
  metadata: text("metadata"),
  source: text("source"),
  // ── Feature 1: Quality Scorer ──
  qualityScore: real("quality_score"),
  // ── Feature 9: Curriculum Learning ──
  difficulty: text("difficulty", { enum: ["easy", "medium", "hard"] }),
  // ── Feature 2: Augmentation ──
  augmentedFrom: integer("augmented_from"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const trainingJobsTable = pgTable("training_jobs", {
  id: serial("id").primaryKey(),
  modelId: integer("model_id").notNull(),
  datasetId: integer("dataset_id").notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).default("pending").notNull(),
  progress: real("progress").default(0).notNull(),
  epochs: integer("epochs").default(3).notNull(),
  currentEpoch: integer("current_epoch").default(0).notNull(),
  loss: real("loss"),
  accuracy: real("accuracy"),
  startedAt: timestamp("started_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  error: text("error"),
  hyperparameters: text("hyperparameters"),
  trainingBackend: text("training_backend").default("local_cpu").notNull(),
  loraRank: integer("lora_rank").default(16),
  learningRate: real("learning_rate").default(0.0002),
  baseModelName: text("base_model_name"),
  lossHistory: text("loss_history"),
  outputModelPath: text("output_model_path"),
  hfJobId: text("hf_job_id"),
  // ── Feature 8: Job Queue ──
  priority: integer("priority").default(5),
  // ── Feature 10: Early Stopping ──
  earlyStopPatience: integer("early_stop_patience").default(0),
  // ── Feature 11: Gradient Checkpointing ──
  gradientCheckpointing: boolean("gradient_checkpointing").default(false),
  // ── Feature 9: Curriculum Learning ──
  curriculumEnabled: boolean("curriculum_enabled").default(false),
  // ── Feature 7: HP Sweep ──
  sweepId: integer("sweep_id"),
  // ── Feature 14 & 15: Eval Metrics ──
  perplexity: real("perplexity"),
  bleuScore: real("bleu_score"),
  rougeScore: real("rouge_score"),
  // ── Batch config ──
  batchSize: integer("batch_size").default(2),
  maxSeqLength: integer("max_seq_length").default(512),
  // ── Feature 35: Multi-task ──
  multiTaskConfig: text("multi_task_config"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const aiModelsTable = pgTable("ai_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["llm", "embedding", "classification", "summarization", "custom"] }).notNull(),
  status: text("status", { enum: ["active", "training", "inactive"] }).default("inactive").notNull(),
  version: text("version").notNull(),
  architecture: text("architecture"),
  description: text("description"),
  ollamaName: text("ollama_name"),
  baseOllamaModel: text("base_ollama_model"),
  parameterCount: text("parameter_count"),
  quantization: text("quantization"),
  // ── Feature 17: Model Card ──
  modelCard: text("model_card"),
  // ── Feature 18: Model Merging ──
  mergedFrom: text("merged_from"),
  // ── Feature 16: Export ──
  exportPaths: text("export_paths"),
  // ── Feature 19: Checkpoints ──
  checkpointPath: text("checkpoint_path"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Feature 5: Dataset Snapshots (Version Control) ─────────────────────────

export const datasetSnapshotsTable = pgTable("dataset_snapshots", {
  id: serial("id").primaryKey(),
  datasetId: integer("dataset_id").notNull(),
  version: integer("version").notNull(),
  notes: text("notes"),
  sampleCount: integer("sample_count").notNull(),
  storageKey: text("storage_key"),
  snapshotData: text("snapshot_data"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Feature 19: Training Checkpoints ───────────────────────────────────────

export const trainingCheckpointsTable = pgTable("training_checkpoints", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  epoch: integer("epoch").notNull(),
  step: integer("step"),
  loss: real("loss"),
  accuracy: real("accuracy"),
  checkpointPath: text("checkpoint_path"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Features 20–22: RLHF Preference Data ───────────────────────────────────

export const preferenceDataTable = pgTable("preference_data", {
  id: serial("id").primaryKey(),
  input: text("input").notNull(),
  chosenResponse: text("chosen_response").notNull(),
  rejectedResponse: text("rejected_response"),
  feedback: text("feedback", { enum: ["thumbs_up", "thumbs_down", "neutral"] }).default("neutral"),
  rating: integer("rating"),
  source: text("source").default("manual"),
  model: text("model"),
  conversationId: integer("conversation_id"),
  messageId: integer("message_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Features 12–15: Benchmark Results ──────────────────────────────────────

export const benchmarkResultsTable = pgTable("benchmark_results", {
  id: serial("id").primaryKey(),
  modelName: text("model_name").notNull(),
  suiteName: text("suite_name").notNull().default("standard"),
  results: text("results").notNull(),
  accuracy: real("accuracy"),
  avgLatencyMs: real("avg_latency_ms"),
  totalTokens: integer("total_tokens"),
  grade: text("grade"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Feature 7: Hyperparameter Sweeps ───────────────────────────────────────

export const hpSweepsTable = pgTable("hp_sweeps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  modelId: integer("model_id").notNull(),
  datasetId: integer("dataset_id").notNull(),
  searchSpace: text("search_space").notNull(),
  runs: text("runs"),
  bestConfig: text("best_config"),
  bestLoss: real("best_loss"),
  totalRuns: integer("total_runs").default(0),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).default("pending"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Feature 32: Training Webhooks ──────────────────────────────────────────

export const trainingWebhooksTable = pgTable("training_webhooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: text("events").notNull().default('["job.completed","job.failed"]'),
  secret: text("secret"),
  active: boolean("active").default(true).notNull(),
  lastTriggeredAt: timestamp("last_triggered_at", { mode: "date" }),
  failureCount: integer("failure_count").default(0),
  lastStatus: integer("last_status"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Feature 29: Training Recipes ───────────────────────────────────────────
// (Stored as system_config keys — no new table needed, recipes are hardcoded)

// ─── Drizzle-Zod Schemas ─────────────────────────────────────────────────────

export const insertTrainingDatasetSchema = createInsertSchema(trainingDatasetsTable)
  .omit({ id: true, sampleCount: true, createdAt: true, updatedAt: true });
export const insertTrainingSampleSchema = createInsertSchema(trainingSamplesTable)
  .omit({ id: true, createdAt: true });
export const insertTrainingJobSchema = createInsertSchema(trainingJobsTable)
  .omit({ id: true, startedAt: true, completedAt: true, error: true, loss: true, accuracy: true, lossHistory: true, hfJobId: true, outputModelPath: true, perplexity: true, bleuScore: true, rougeScore: true });
export const insertAiModelSchema = createInsertSchema(aiModelsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, status: true });

export type InsertTrainingDataset = z.infer<typeof insertTrainingDatasetSchema>;
export type InsertTrainingSample = z.infer<typeof insertTrainingSampleSchema>;
export type InsertTrainingJob = z.infer<typeof insertTrainingJobSchema>;
export type InsertAiModel = z.infer<typeof insertAiModelSchema>;

export type TrainingDataset = typeof trainingDatasetsTable.$inferSelect;
export type TrainingSample = typeof trainingSamplesTable.$inferSelect;
export type TrainingJob = typeof trainingJobsTable.$inferSelect;
export type AiModel = typeof aiModelsTable.$inferSelect;
export type DatasetSnapshot = typeof datasetSnapshotsTable.$inferSelect;
export type TrainingCheckpoint = typeof trainingCheckpointsTable.$inferSelect;
export type PreferenceData = typeof preferenceDataTable.$inferSelect;
export type BenchmarkResult = typeof benchmarkResultsTable.$inferSelect;
export type HpSweep = typeof hpSweepsTable.$inferSelect;
export type TrainingWebhook = typeof trainingWebhooksTable.$inferSelect;
