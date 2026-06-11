---
name: Artifact Router Port Fix
description: Why the main URL showed 404 and how the artifact router port conflict was resolved
---

## The Problem

The Replit artifact router (`$REPLIT_ARTIFACT_ROUTER`) intercepts ALL external requests to the repl's public URL (e.g. `-1hg5c729uvcud.sisko.replit.dev`) BEFORE they reach any Express server. It reads `artifact.toml` files and routes traffic to services.

When the artifact router cannot start (due to a port conflict), it returns "404 — This deployment has no previewable artifacts" for every request — even though `curl localhost:8080/` works fine internally.

## Root Cause

`artifacts/api-server/.replit-artifact/artifact.toml` had `localPort = 8080`. The artifact router also needs port 8080 to listen. This conflict prevented the router from starting.

**Why:** The error was: `router listen port 8080 conflicts with artifact service localPort 8080 — change the service's localPort in artifact.toml or set a different PORT`

## Fix Applied

1. Changed API service `localPort` from `8080` → `3000` in `artifact.toml`
2. Updated `dev` script in `artifacts/api-server/package.json` to `export PORT=3000 &&`
3. Created `artifacts/ai-web-app/.replit-artifact/artifact.toml` with `kind = "web"`, `localPort = 5000`, `paths = ["/"]`
4. Updated `vite.config.ts` proxy target from port `8080` → `3000`
5. Removed `http-proxy-middleware` from `app.ts` (no longer needed — artifact router handles routing)

## Final Port Layout

- Port 8080: Artifact router (handles all external traffic)
- Port 3000: API server (`/api/*` routes)
- Port 5000: Vite dev server (`/*` routes, also the webview)

## How to Apply Changes to artifact.toml

Cannot use the `write` tool directly. Must:
1. Write changes to a sibling temp file: `artifact.edit.toml`
2. Call `verifyAndReplaceArtifactToml({ tempFilePath, artifactTomlPath })` with absolute paths
3. The temp file must exist at call time (not deleted by prior failed call)

For NEW artifact.toml files (no existing file), bash `cat >` works to create them. Then `verifyAndReplaceArtifactToml` can update them.
