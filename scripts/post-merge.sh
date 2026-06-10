#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies
pnpm install --frozen-lockfile

echo "Post-merge setup complete."
