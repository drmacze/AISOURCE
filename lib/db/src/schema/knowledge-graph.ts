import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── BLOK M: Knowledge Graph ──────────────────────────────────────────────────
// Relational entity graph to complement flat RAG chunks

export const kgEntitiesTable = pgTable("kg_entities", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  type:        text("type").notNull(),        // concept, technology, person, place, etc.
  description: text("description"),
  createdAt:   timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const kgRelationsTable = pgTable("kg_relations", {
  id:           serial("id").primaryKey(),
  fromId:       integer("from_id").notNull(),
  toId:         integer("to_id").notNull(),
  relationType: text("relation_type").notNull(), // relates_to, used_for, has_concept, etc.
  weight:       real("weight").default(1.0).notNull(),
  createdAt:    timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const kgEntityChunksTable = pgTable("kg_entity_chunks", {
  id:       serial("id").primaryKey(),
  entityId: integer("entity_id").notNull(),
  chunkId:  integer("chunk_id").notNull(),       // references documents/chunks table
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertKgEntitySchema = createInsertSchema(kgEntitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKgRelationSchema = createInsertSchema(kgRelationsTable).omit({ id: true, createdAt: true });
export const insertKgEntityChunkSchema = createInsertSchema(kgEntityChunksTable).omit({ id: true, createdAt: true });

export type KgEntity = typeof kgEntitiesTable.$inferSelect;
export type KgRelation = typeof kgRelationsTable.$inferSelect;
export type KgEntityChunk = typeof kgEntityChunksTable.$inferSelect;
export type InsertKgEntity = z.infer<typeof insertKgEntitySchema>;
export type InsertKgRelation = z.infer<typeof insertKgRelationSchema>;
export type InsertKgEntityChunk = z.infer<typeof insertKgEntityChunkSchema>;
