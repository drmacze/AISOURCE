/**
 * DLavie OS — Auth Storage
 * User CRUD operations backed by PostgreSQL.
 */

import { db } from "@workspace/db";
import { users, type User, type UpsertUser } from "@workspace/db";
import { eq } from "drizzle-orm";

export const authStorage = {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email:           userData.email,
          firstName:       userData.firstName,
          lastName:        userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt:       new Date(),
        },
      })
      .returning();
    return user;
  },

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  },

  async makeAdmin(id: string): Promise<void> {
    await db.update(users).set({ isAdmin: true, role: "admin" }).where(eq(users.id, id));
  },
};
