import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq, or } from "drizzle-orm";

const router = Router();
const SALT_ROUNDS = 12;

// ─── Register (DLavie native account) ────────────────────────────────────────
router.post("/auth/register", async (req, res) => {
  try {
    const { email, username, password, firstName, lastName } = req.body as {
      email?: string; username?: string; password?: string;
      firstName?: string; lastName?: string;
    };

    if (!email || !username || !password) {
      return res.status(400).json({ error: "email, username, and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ error: "Username: 3-30 chars, letters/numbers/underscore only" });
    }

    // Check for duplicate email or username
    const existing = await db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(or(eq(users.email, email.toLowerCase()), eq(users.username, username.toLowerCase())))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].email === email.toLowerCase()) {
        return res.status(409).json({ error: "Email already registered" });
      }
      return res.status(409).json({ error: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [user] = await db
      .insert(users)
      .values({
        email:    email.toLowerCase(),
        username: username.toLowerCase(),
        passwordHash,
        firstName: firstName?.trim() || null,
        lastName:  lastName?.trim()  || null,
        provider:  "dlavie",
        role:      "user",
        isAdmin:   false,
      })
      .returning();

    // Auto-login after register
    (req.session as Record<string, unknown>).userId   = user.id;
    (req.session as Record<string, unknown>).provider = "dlavie";
    req.session.save(() => {
      res.status(201).json({
        id:              user.id,
        email:           user.email,
        username:        user.username,
        firstName:       user.firstName,
        lastName:        user.lastName,
        profileImageUrl: user.profileImageUrl,
        role:            user.role,
        isAdmin:         user.isAdmin,
      });
    });
  } catch (err) {
    console.error("[native-auth] register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── Login (DLavie native) ────────────────────────────────────────────────────
router.post("/auth/login/native", async (req, res) => {
  try {
    const { identifier, password } = req.body as { identifier?: string; password?: string };

    if (!identifier || !password) {
      return res.status(400).json({ error: "identifier and password are required" });
    }

    const id = identifier.toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, id), eq(users.username, id)))
      .limit(1);

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    (req.session as Record<string, unknown>).userId   = user.id;
    (req.session as Record<string, unknown>).provider = "dlavie";
    req.session.save(() => {
      res.json({
        id:              user.id,
        email:           user.email,
        username:        user.username,
        firstName:       user.firstName,
        lastName:        user.lastName,
        profileImageUrl: user.profileImageUrl,
        role:            user.role,
        isAdmin:         user.isAdmin,
      });
    });
  } catch (err) {
    console.error("[native-auth] login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;
