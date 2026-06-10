import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  key: text("key").notNull().unique(),
  permissions: text("permissions", {
    enum: ["read", "write", "admin"],
  })
    .default("write")
    .notNull(),
  active: boolean("active").default(true).notNull(),
  defaultModel: text("default_model"),
  requestCount: integer("request_count").default(0).notNull(),
  lastUsedAt: timestamp("last_used_at", { mode: "date" }),
  expiresAt: timestamp("expires_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({
  id: true,
  key: true,
  requestCount: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type ApiKey = typeof apiKeysTable.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
