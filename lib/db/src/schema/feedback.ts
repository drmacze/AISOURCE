import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── BLOK A: RLHF-lite Message Feedback ──────────────────────────────────────
// Stores 👍/👎 feedback from Web Chat, Telegram, and WhatsApp

export const messageFeedbackTable = pgTable("message_feedback", {
  id:             serial("id").primaryKey(),
  messageId:      integer("message_id"),
  conversationId: integer("conversation_id"),
  rating:         text("rating", { enum: ["positive", "negative"] }).notNull(),
  source:         text("source", { enum: ["web", "telegram", "whatsapp"] }).notNull().default("web"),
  userId:         text("user_id"),
  messageContent: text("message_content"),
  model:          text("model"),
  notes:          text("notes"),
  createdAt:      timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const insertMessageFeedbackSchema = createInsertSchema(messageFeedbackTable)
  .omit({ id: true, createdAt: true });

export type MessageFeedback = typeof messageFeedbackTable.$inferSelect;
export type InsertMessageFeedback = z.infer<typeof insertMessageFeedbackSchema>;
