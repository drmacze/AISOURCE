import { pgTable, serial, text, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── BLOK B: Capability Map ────────────────────────────────────────────────────
// Per-capability benchmark scores per model

export const modelBenchmarksTable = pgTable("model_benchmarks", {
  id:          serial("id").primaryKey(),
  modelName:   text("model_name").notNull(),
  capability:  text("capability").notNull(), // coding, bahasa_indonesia, reasoning, math, creative, general
  score:       real("score").notNull(),       // 0–100
  sampleCount: integer("sample_count").default(0).notNull(),
  testedAt:    timestamp("tested_at", { mode: "date" }).defaultNow().notNull(),
  notes:       text("notes"),
});

// ─── BLOK C/N: Golden Test Set ────────────────────────────────────────────────
// 200 fundamental questions that a model MUST pass

export const goldenTestSetTable = pgTable("golden_test_set", {
  id:              serial("id").primaryKey(),
  question:        text("question").notNull(),
  expectedAnswer:  text("expected_answer").notNull(),
  capability:      text("capability").notNull(),
  difficulty:      text("difficulty", { enum: ["easy", "medium", "hard"] }).default("medium").notNull(),
  active:          boolean("active").default(true).notNull(),
  createdAt:       timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── BLOK F: Model Versions ────────────────────────────────────────────────────
// Semantic version history per model

export const modelVersionsTable = pgTable("model_versions", {
  id:          serial("id").primaryKey(),
  modelId:     integer("model_id").notNull(),
  modelName:   text("model_name").notNull(),
  version:     text("version").notNull(),       // e.g. "v1.2"
  status:      text("status", { enum: ["active", "deprecated", "rolled_back"] }).default("active").notNull(),
  goldenScore: real("golden_score"),             // score on golden test set
  changelog:   text("changelog"),               // auto-generated
  trainingJobId: integer("training_job_id"),
  createdAt:   timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertModelBenchmarkSchema = createInsertSchema(modelBenchmarksTable).omit({ id: true });
export const insertGoldenTestSchema = createInsertSchema(goldenTestSetTable).omit({ id: true });
export const insertModelVersionSchema = createInsertSchema(modelVersionsTable).omit({ id: true });

export type ModelBenchmark = typeof modelBenchmarksTable.$inferSelect;
export type GoldenTest = typeof goldenTestSetTable.$inferSelect;
export type ModelVersion = typeof modelVersionsTable.$inferSelect;
export type InsertModelBenchmark = z.infer<typeof insertModelBenchmarkSchema>;
export type InsertGoldenTest = z.infer<typeof insertGoldenTestSchema>;
export type InsertModelVersion = z.infer<typeof insertModelVersionSchema>;
