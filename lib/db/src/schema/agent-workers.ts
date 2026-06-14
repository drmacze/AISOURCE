import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Agent Mail (inter-agent messaging + boss inbox) ─────────────────────────

export const agentMailTable = pgTable("agent_mail", {
  id:         serial("id").primaryKey(),
  fromAgent:  text("from_agent").notNull(),
  toAgent:    text("to_agent").notNull().default("boss"),
  subject:    text("subject").notNull(),
  body:       text("body").notNull(),
  priority:   text("priority", { enum: ["low", "normal", "high", "critical"] }).notNull().default("normal"),
  read:       boolean("read").notNull().default(false),
  metadata:   jsonb("metadata"),
  createdAt:  timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Tasks (task queue each agent processes) ────────────────────────────

export const agentTasksTable = pgTable("agent_tasks", {
  id:          serial("id").primaryKey(),
  agentId:     text("agent_id").notNull(),
  taskType:    text("task_type").notNull(),
  payload:     jsonb("payload"),
  status:      text("status", { enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
  result:      jsonb("result"),
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
  metricType: text("metric_type").notNull(),
  value:      text("value").notNull(),
  label:      text("label"),
  metadata:   jsonb("metadata"),
  createdAt:  timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Worker Memories (persistent per-agent long-term memory) ────────────
// Each agent saves a rolling summary of its recent work + key insights.
// Loaded at the start of each tick so agents "remember" previous cycles.
// Note: separate from agent.ts agentMemoriesTable (that's for general AI memories;
// this is per-worker rolling state)

export const agentWorkerMemoriesTable = pgTable("agent_worker_memories", {
  id:          serial("id").primaryKey(),
  agentId:     text("agent_id").notNull().unique(),
  memory:      text("memory").notNull().default(""),         // rolling prose summary
  insights:    jsonb("insights"),                            // structured key findings []
  cycleCount:  integer("cycle_count").notNull().default(0),  // total ticks completed
  lastUpdated: timestamp("last_updated", { mode: "date" }).defaultNow().notNull(),
});

// ─── System Context Board (shared state readable by all agents) ───────────────
// Key-value store. Agents write findings; all agents read before thinking.
// Examples: "system_health", "active_incidents", "training_progress", "kb_freshness"

export const systemContextTable = pgTable("system_context", {
  id:        serial("id").primaryKey(),
  key:       text("key").notNull().unique(),
  value:     text("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Subtasks (Orchestrator-assigned priority tasks) ────────────────────
// Orchestrator (or any agent) can spawn a concrete task for another agent.
// The recipient agent checks this table at tick start and works on it first.

export const agentSubtasksTable = pgTable("agent_subtasks", {
  id:          serial("id").primaryKey(),
  assignedTo:  text("assigned_to").notNull(),
  assignedBy:  text("assigned_by").notNull().default("orchestrator"),
  task:        text("task").notNull(),
  context:     text("context"),                              // extra context for the agent
  priority:    text("priority", { enum: ["low", "normal", "high", "critical"] }).notNull().default("normal"),
  status:      text("status", { enum: ["pending", "working", "done", "failed"] }).notNull().default("pending"),
  result:      text("result"),
  createdAt:   timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { mode: "date" }),
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertAgentMailSchema     = createInsertSchema(agentMailTable).omit({ id: true, createdAt: true });
export const insertAgentTaskSchema     = createInsertSchema(agentTasksTable).omit({ id: true, createdAt: true });
export const insertAgentStatusSchema   = createInsertSchema(agentStatusTable).omit({ id: true, createdAt: true });
export const insertAgentMetricSchema   = createInsertSchema(agentMetricsTable).omit({ id: true, createdAt: true });
export const insertAgentWorkerMemorySchema = createInsertSchema(agentWorkerMemoriesTable).omit({ id: true });
export const insertSystemContextSchema     = createInsertSchema(systemContextTable).omit({ id: true });
export const insertAgentSubtaskSchema      = createInsertSchema(agentSubtasksTable).omit({ id: true, createdAt: true });

export type AgentMail          = typeof agentMailTable.$inferSelect;
export type AgentTask          = typeof agentTasksTable.$inferSelect;
export type AgentStatus        = typeof agentStatusTable.$inferSelect;
export type AgentMetric        = typeof agentMetricsTable.$inferSelect;
export type AgentWorkerMemory  = typeof agentWorkerMemoriesTable.$inferSelect;
export type SystemContext       = typeof systemContextTable.$inferSelect;
export type AgentSubtask        = typeof agentSubtasksTable.$inferSelect;

export type InsertAgentMail          = z.infer<typeof insertAgentMailSchema>;
export type InsertAgentTask          = z.infer<typeof insertAgentTaskSchema>;
export type InsertAgentMetric        = z.infer<typeof insertAgentMetricSchema>;
export type InsertAgentWorkerMemory  = z.infer<typeof insertAgentWorkerMemorySchema>;
export type InsertSystemContext      = z.infer<typeof insertSystemContextSchema>;
export type InsertAgentSubtask       = z.infer<typeof insertAgentSubtaskSchema>;
