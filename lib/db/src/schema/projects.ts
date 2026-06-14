import { pgTable, serial, text, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── BLOK D: Agent Project System ─────────────────────────────────────────────
// Goal-to-execution project management for AI training goals

export const agentProjectsTable = pgTable("agent_projects", {
  id:                   serial("id").primaryKey(),
  title:                text("title").notNull(),
  description:          text("description"),
  targetCapabilities:   jsonb("target_capabilities"),   // e.g. ["coding", "math"]
  status:               text("status", { enum: ["pending", "running", "completed", "failed", "paused"] }).default("pending").notNull(),
  progress:             real("progress").default(0).notNull(),  // 0–100
  estimatedCompletion:  timestamp("estimated_completion", { mode: "date" }),
  createdAt:            timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  completedAt:          timestamp("completed_at", { mode: "date" }),
  updatedAt:            timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── BLOK G: System Events ─────────────────────────────────────────────────────
// Event bus audit log — all agent events stored here

export const systemEventsTable = pgTable("system_events", {
  id:        serial("id").primaryKey(),
  eventType: text("event_type").notNull(),  // feedback_received, model_created, quality_drop_detected, etc.
  source:    text("source").notNull(),       // which agent or system emitted it
  payload:   jsonb("payload"),               // event data
  handled:   text("handled").default("no").notNull(), // no, processing, yes
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── BLOK O: Agent Performance Tracking ───────────────────────────────────────
// Track each agent's success/fail rate per task type for specialization evolution

export const agentPerformanceTable = pgTable("agent_performance", {
  id:             serial("id").primaryKey(),
  agentId:        text("agent_id").notNull(),
  taskType:       text("task_type").notNull(),
  successCount:   integer("success_count").default(0).notNull(),
  failCount:      integer("fail_count").default(0).notNull(),
  avgLatencyMs:   real("avg_latency_ms").default(0).notNull(),
  lastTestedAt:   timestamp("last_tested_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertAgentProjectSchema = createInsertSchema(agentProjectsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, completedAt: true });
export const insertSystemEventSchema = createInsertSchema(systemEventsTable)
  .omit({ id: true, createdAt: true });
export const insertAgentPerformanceSchema = createInsertSchema(agentPerformanceTable)
  .omit({ id: true });

export type AgentProject = typeof agentProjectsTable.$inferSelect;
export type SystemEvent = typeof systemEventsTable.$inferSelect;
export type AgentPerformance = typeof agentPerformanceTable.$inferSelect;
export type InsertAgentProject = z.infer<typeof insertAgentProjectSchema>;
export type InsertSystemEvent = z.infer<typeof insertSystemEventSchema>;
export type InsertAgentPerformance = z.infer<typeof insertAgentPerformanceSchema>;
