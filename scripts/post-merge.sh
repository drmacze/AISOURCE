#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies
pnpm install --frozen-lockfile

# Push DB schema (idempotent — safe to run on every import/merge)
echo "Applying database schema..."
pnpm --filter @workspace/db run push

echo "Post-merge setup complete."
