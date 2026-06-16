import { execSync } from "child_process";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

const WORKSPACE_ROOT =
  process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";

// ─── Tables that must exist for the server to function ───────────────────────
const REQUIRED_TABLES = [
  "conversations",
  "messages",
  "documents",
  "training_datasets",
  "training_samples",
  "training_jobs",
  "ai_models",
  "agent_status",
  "agent_mail",
  "prompts",
  "api_keys",
  "bot_tickets",
];

async function getExistingTables(): Promise<Set<string>> {
  try {
    const rows = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    return new Set(rows.rows.map((r) => r.tablename));
  } catch {
    return new Set();
  }
}

async function enablePgVector(): Promise<boolean> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    logger.info("[DB] ✓ pgvector extension ready");
    return true;
  } catch (e) {
    logger.warn({ err: e }, "[DB] ⚠ pgvector extension failed (may already exist or not supported)");
    return false;
  }
}

function runSchemaPush(): boolean {
  try {
    execSync("pnpm --filter @workspace/db run push --force", {
      cwd: WORKSPACE_ROOT,
      stdio: "pipe",
      env: { ...process.env },
      timeout: 60_000,
    });
    logger.info("[DB] ✓ Schema pushed — all tables up to date");
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, "[DB] ⚠ Schema push failed — server will continue with existing tables");
    return false;
  }
}

async function validateTables(existing: Set<string>): Promise<void> {
  const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));
  if (missing.length === 0) {
    logger.info({ count: existing.size }, "[DB] ✓ All required tables present");
  } else {
    logger.warn(
      { missing, existing: existing.size },
      `[DB] ⚠ ${missing.length} required table(s) still missing after push`
    );
  }
}

/**
 * initDatabase() — runs on every server startup.
 *
 * Steps:
 *   1. Enable pgvector extension (needed for document embeddings)
 *   2. Run drizzle-kit push (idempotent — creates / updates all tables)
 *   3. Validate required tables are present and log any gaps
 *
 * Non-blocking on failure — server starts regardless so existing data is accessible.
 */
export async function initDatabase(): Promise<void> {
  logger.info("[DB] Initializing database...");

  await enablePgVector();

  const pushOk = runSchemaPush();

  if (!pushOk) {
    // If push failed, at least validate what's there
    const existing = await getExistingTables();
    await validateTables(existing);
    return;
  }

  const existing = await getExistingTables();
  await validateTables(existing);
  logger.info("[DB] Database initialization complete");
}
