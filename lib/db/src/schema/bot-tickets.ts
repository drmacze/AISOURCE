import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botTicketsTable = pgTable("bot_tickets", {
  id:           serial("id").primaryKey(),
  platform:     text("platform", { enum: ["whatsapp", "telegram"] }).notNull(),
  fromJid:      text("from_jid").notNull(),
  fromName:     text("from_name").notNull().default("Unknown"),
  title:        text("title").notNull(),
  description:  text("description").notNull(),
  steps:        text("steps"),
  status:       text("status", { enum: ["open", "in_progress", "resolved", "closed"] }).notNull().default("open"),
  priority:     text("priority", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  agentNotes:   text("agent_notes"),
  resolvedAt:   timestamp("resolved_at", { mode: "date" }),
  createdAt:    timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertBotTicketSchema = createInsertSchema(botTicketsTable).omit({
  id: true, resolvedAt: true, createdAt: true, updatedAt: true,
});

export type BotTicket        = typeof botTicketsTable.$inferSelect;
export type InsertBotTicket  = z.infer<typeof insertBotTicketSchema>;
