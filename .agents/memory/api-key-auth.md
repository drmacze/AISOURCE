---
name: API Key Auth System
description: How DB-backed dlv_ key auth works, bootstrap mode, and shared middleware location
---

## Auth flow

1. `artifacts/api-server/src/lib/auth.ts` — shared `requireAuth(minPerm)` middleware
2. Checks `DLAVIE_API_KEY` env var as master/admin key first
3. Falls back to DB lookup in `api_keys` table (`dlv_` prefix required)
4. Increments `request_count` + `last_used_at` on every valid request (fire-and-forget)

## Bootstrap mode

`artifacts/api-server/src/routes/apikeys.ts` `requireAdmin`:
- When `DLAVIE_API_KEY` is not set AND `api_keys` table is empty → allows unauthenticated POST to create the first key
- Once first admin key exists OR master key is set → full auth enforced

**Why:** Chicken-and-egg: can't authenticate to create keys if no keys exist and no env var is set.

## Key format

`dlv_` + 48 hex chars (24 random bytes via `randomBytes(24).toString("hex")`)

## Permissions

- `read` — query, search, RAG
- `write` — chat, generate, inference (default for external integrations)
- `admin` — full access including key management

## Dashboard UI

`artifacts/ai-web-app/src/pages/api-keys.tsx` — stores master key in `localStorage` under `dlavie_master_key`; uses it for all `/api/keys` requests from the browser.
