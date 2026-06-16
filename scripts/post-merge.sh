#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies
pnpm install --frozen-lockfile

# ─── Enable pgvector extension before schema push ─────────────────────────────
# Required because the documents table uses the vector(384) type.
# Safe to run on every merge — CREATE EXTENSION IF NOT EXISTS is idempotent.
echo "Enabling pgvector extension..."
node --input-type=module << 'EOF'
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(join(process.cwd(), 'lib/db/package.json'));
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn('[DB] DATABASE_URL not set — skipping pgvector init');
  process.exit(0);
}

const client = new Client({ connectionString: url });
try {
  await client.connect();
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  console.log("[DB] ✓ pgvector extension ready");
} catch (e) {
  console.warn("[DB] pgvector warning (non-fatal):", e.message);
} finally {
  try { await client.end(); } catch {}
}
EOF

# ─── Push DB schema (idempotent — creates/updates all tables) ─────────────────
echo "Applying database schema..."
pnpm --filter @workspace/db run push

echo "Post-merge setup complete."
