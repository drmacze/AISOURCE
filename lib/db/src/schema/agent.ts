import { pgTable, serial, text, integer, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Agent Memory — persistent cross-session learning ────────────────────────
export const agentMemoriesTable = pgTable("agent_memories", {
  id: serial("id").primaryKey(),
  category: text("category", {
    enum: ["insight", "pattern", "success", "failure", "knowledge", "plan", "preference"],
  }).notNull().default("insight"),
  content: text("content").notNull(),
  importance: integer("importance").default(5).notNull(), // 1-10
  tags: text("tags"),                // JSON array of strings
  sessionId: text("session_id"),
  usageCount: integer("usage_count").default(0).notNull(),
  lastUsedAt: timestamp("last_used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Skills — registered capabilities and their performance ─────────────
export const agentSkillsTable = pgTable("agent_skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  category: text("category", {
    enum: ["coding", "ml", "data", "research", "planning", "system"],
  }).notNull().default("coding"),
  successRate: real("success_rate").default(1.0).notNull(), // 0-1
  useCount: integer("use_count").default(0).notNull(),
  lastUsedAt: timestamp("last_used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Plans — multi-step plans persisted for continuity ─────────────────
export const agentPlansTable = pgTable("agent_plans", {
  id: serial("id").primaryKey(),
  goal: text("goal").notNull(),
  steps: text("steps").notNull(), // JSON array of {step, status, result}
  status: text("status", {
    enum: ["pending", "in_progress", "completed", "failed", "abandoned"],
  }).default("pending").notNull(),
  priority: integer("priority").default(5).notNull(), // 1-10
  sessionId: text("session_id"),
  result: text("result"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Schemas ──────────────────────────────────────────────────────────────────
export const insertAgentMemorySchema = createInsertSchema(agentMemoriesTable).omit({
  id: true, usageCount: true, lastUsedAt: true, createdAt: true, updatedAt: true,
});
export const insertAgentSkillSchema = createInsertSchema(agentSkillsTable).omit({
  id: true, successRate: true, useCount: true, lastUsedAt: true, createdAt: true, updatedAt: true,
});
export const insertAgentPlanSchema = createInsertSchema(agentPlansTable).omit({
  id: true, result: true, createdAt: true, updatedAt: true,
});

export type AgentMemory = typeof agentMemoriesTable.$inferSelect;
export type AgentSkill = typeof agentSkillsTable.$inferSelect;
export type AgentPlan = typeof agentPlansTable.$inferSelect;
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type InsertAgentPlan = z.infer<typeof insertAgentPlanSchema>;
