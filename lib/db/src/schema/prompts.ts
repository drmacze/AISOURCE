import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const promptsTable = pgTable("prompts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  description: text("description"),
  category: text("category").default("general").notNull(),
  tags: text("tags").default("[]"),
  useCount: integer("use_count").default(0).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export type Prompt = typeof promptsTable.$inferSelect;
export type InsertPrompt = typeof promptsTable.$inferInsert;
