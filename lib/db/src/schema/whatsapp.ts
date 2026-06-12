import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whatsappConfigTable = pgTable("whatsapp_config", {
  id: serial("id").primaryKey(),
  phoneNumberId: text("phone_number_id").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  verifyToken: text("verify_token").notNull().default(""),
  businessAccountId: text("business_account_id").default(""),
  aiProvider: text("ai_provider").notNull().default("auto"),
  aiModel: text("ai_model").default(""),
  aiApiKey: text("ai_api_key").default(""),
  systemPrompt: text("system_prompt").default("Kamu adalah asisten AI yang membantu. Jawab dengan singkat dan jelas."),
  enabled: boolean("enabled").notNull().default(false),
  botName: text("bot_name").default("DLavie Bot"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  waMessageId: text("wa_message_id"),
  from: text("from").notNull(),
  to: text("to"),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  body: text("body").notNull(),
  aiProvider: text("ai_provider"),
  status: text("status", { enum: ["received", "processing", "sent", "failed"] }).notNull().default("received"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertWhatsappConfigSchema = createInsertSchema(whatsappConfigTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessagesTable).omit({ id: true, createdAt: true });

export type WhatsappConfig = typeof whatsappConfigTable.$inferSelect;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
export type InsertWhatsappConfig = z.infer<typeof insertWhatsappConfigSchema>;
