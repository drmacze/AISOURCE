import { pgTable, serial, text, integer, timestamp, boolean, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(384)"; },
  toDriver(val: number[]): string { return "[" + val.join(",") + "]"; },
  fromDriver(val: string): number[] {
    return val.replace(/^\[|\]$/g, "").split(",").map(Number);
  },
});

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  fileType: text("file_type"),
  size: integer("size"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
  indexed: boolean("indexed").default(false).notNull(),
  chunkCount: integer("chunk_count").default(0).notNull(),
  storageUrl: text("storage_url"),
  storageObjectPath: text("storage_object_path"),
  embeddingModel: text("embedding_model"),
  embedding: vector("embedding"),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, indexed: true, chunkCount: true });

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
