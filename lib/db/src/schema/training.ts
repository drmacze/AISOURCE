import { pgTable, serial, text, integer, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trainingDatasetsTable = pgTable("training_datasets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  taskType: text("task_type", { enum: ["classification", "generation", "summarization", "qa", "translation"] }).notNull(),
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
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const trainingJobsTable = pgTable("training_jobs", {
  id: serial("id").primaryKey(),
  modelId: integer("model_id").notNull(),
  datasetId: integer("dataset_id").notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).default("pending").notNull(),
  progress: real("progress").default(0).notNull(),
  epochs: integer("epochs").default(1).notNull(),
  currentEpoch: integer("current_epoch").default(0).notNull(),
  loss: real("loss"),
  accuracy: real("accuracy"),
  startedAt: timestamp("started_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  error: text("error"),
  hyperparameters: text("hyperparameters"),
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
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertTrainingDatasetSchema = createInsertSchema(trainingDatasetsTable).omit({ id: true, sampleCount: true, createdAt: true, updatedAt: true });
export const insertTrainingSampleSchema = createInsertSchema(trainingSamplesTable).omit({ id: true, createdAt: true });
export const insertTrainingJobSchema = createInsertSchema(trainingJobsTable).omit({ id: true, startedAt: true, completedAt: true, error: true, loss: true, accuracy: true });
export const insertAiModelSchema = createInsertSchema(aiModelsTable).omit({ id: true, createdAt: true, updatedAt: true, status: true });

export type InsertTrainingDataset = z.infer<typeof insertTrainingDatasetSchema>;
export type InsertTrainingSample = z.infer<typeof insertTrainingSampleSchema>;
export type InsertTrainingJob = z.infer<typeof insertTrainingJobSchema>;
export type InsertAiModel = z.infer<typeof insertAiModelSchema>;

export type TrainingDataset = typeof trainingDatasetsTable.$inferSelect;
export type TrainingSample = typeof trainingSamplesTable.$inferSelect;
export type TrainingJob = typeof trainingJobsTable.$inferSelect;
export type AiModel = typeof aiModelsTable.$inferSelect;
