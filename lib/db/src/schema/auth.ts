import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar, text, boolean } from "drizzle-orm/pg-core";

export const sessions = pgTable(
  "sessions",
  {
    sid:    varchar("sid").primaryKey(),
    sess:   jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (t) => [index("IDX_session_expire").on(t.expire)],
);

export const users = pgTable("users", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email:           varchar("email", { length: 255 }).unique(),
  username:        varchar("username", { length: 50 }).unique(),
  passwordHash:    text("password_hash"),
  firstName:       varchar("first_name", { length: 100 }),
  lastName:        varchar("last_name", { length: 100 }),
  profileImageUrl: text("profile_image_url"),
  provider:        varchar("provider", { length: 50 }).default("dlavie"),
  providerId:      varchar("provider_id", { length: 255 }),
  role:            varchar("role", { length: 20 }).default("user"),
  isAdmin:         boolean("is_admin").default(false),
  createdAt:       timestamp("created_at").defaultNow(),
  updatedAt:       timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User       = typeof users.$inferSelect;
