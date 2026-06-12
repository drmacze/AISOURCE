import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Agent Mail (inter-agent messaging + boss inbox) ─────────────────────────

export const agentMailTable = pgTable("agent_mail", {
  id:         serial("id").primaryKey(),
  fromAgent:  text("from_agent").notNull(),          // e.g. "training", "model", "orchestrator"
  toAgent:    text("to_agent").notNull().default("boss"), // "boss" = human inbox
  subject:    text("subject").notNull(),
  body:       text("body").notNull(),
  priority:   text("priority", { enum: ["low", "normal", "high", "critical"] }).notNull().default("normal"),
  read:       boolean("read").notNull().default(false),
  metadata:   jsonb("metadata"),                     // extra structured data (ticket id, model name, etc.)
  createdAt:  timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Tasks (task queue each agent processes) ────────────────────────────

export const agentTasksTable = pgTable("agent_tasks", {
  id:          serial("id").primaryKey(),
  agentId:     text("agent_id").notNull(),            // which agent owns this task
  taskType:    text("task_type").notNull(),            // e.g. "fetch_training_data", "benchmark_model"
  payload:     jsonb("payload"),                      // task input data
  status:      text("status", { enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
  result:      jsonb("result"),                       // task output
  error:       text("error"),
  startedAt:   timestamp("started_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  createdAt:   timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Heartbeat (each agent updates its status every tick) ───────────────

export const agentStatusTable = pgTable("agent_status", {
  id:          serial("id").primaryKey(),
  agentId:     text("agent_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  status:      text("status", { enum: ["idle", "working", "sleeping", "error"] }).notNull().default("idle"),
  currentTask: text("current_task"),
  lastSeen:    timestamp("last_seen", { mode: "date" }).defaultNow().notNull(),
  tickCount:   integer("tick_count").notNull().default(0),
  metadata:    jsonb("metadata"),
  createdAt:   timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Metrics (quality scores, benchmark results) ───────────────────────

export const agentMetricsTable = pgTable("agent_metrics", {
  id:         serial("id").primaryKey(),
  agentId:    text("agent_id").notNull(),
  metricType: text("metric_type").notNull(),          // "quality_score", "model_bench", "ticket_resolved"
  value:      text("value").notNull(),                // numeric or JSON string
  label:      text("label"),
  metadata:   jsonb("metadata"),
  createdAt:  timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertAgentMailSchema  = createInsertSchema(agentMailTable).omit({ id: true, createdAt: true });
export const insertAgentTaskSchema  = createInsertSchema(agentTasksTable).omit({ id: true, createdAt: true });
export const insertAgentStatusSchema = createInsertSchema(agentStatusTable).omit({ id: true, createdAt: true });
export const insertAgentMetricSchema = createInsertSchema(agentMetricsTable).omit({ id: true, createdAt: true });

export type AgentMail    = typeof agentMailTable.$inferSelect;
export type AgentTask    = typeof agentTasksTable.$inferSelect;
export type AgentStatus  = typeof agentStatusTable.$inferSelect;
export type AgentMetric  = typeof agentMetricsTable.$inferSelect;
export type InsertAgentMail    = z.infer<typeof insertAgentMailSchema>;
export type InsertAgentTask    = z.infer<typeof insertAgentTaskSchema>;
export type InsertAgentMetric  = z.infer<typeof insertAgentMetricSchema>;
