import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  fileType: text("file_type"),
  size: integer("size"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  indexed: boolean("indexed").default(false).notNull(),
  chunkCount: integer("chunk_count").default(0).notNull(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, indexed: true, chunkCount: true });

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
