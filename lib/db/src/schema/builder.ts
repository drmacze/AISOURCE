import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const builderTasksTable = pgTable("builder_tasks", {
  id:           serial("id").primaryKey(),
  title:        text("title").notNull(),
  description:  text("description").notNull(),
  status:       text("status", {
    enum: ["draft", "queued", "active", "ready", "done"],
  }).notNull().default("draft"),
  assignedAgent: text("assigned_agent").notNull().default("engineer"),
  requestedBy:  text("requested_by").notNull().default("user"),
  priority:     integer("priority").notNull().default(5),
  parentTaskId: integer("parent_task_id"),
  result:       text("result"),
  agentLog:     text("agent_log"),
  createdAt:    timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertBuilderTaskSchema = createInsertSchema(builderTasksTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type BuilderTask = typeof builderTasksTable.$inferSelect;
export type InsertBuilderTask = z.infer<typeof insertBuilderTaskSchema>;
