---
name: Replit OAuth + Sessions
description: How Replit OIDC auth is wired into DLavie OS — key constraints and patterns
---

## The Rule
`setupAuth(app)` must be `await`-ed in `app.ts` BEFORE any routes are registered. It is the first middleware after body parsing.

**Why:** express-session middleware must wrap all route handlers. Passport strategy registration happens async (OIDC discovery). If routes load before auth, session context is missing.

## How to Apply
- `artifacts/api-server/src/lib/replit-auth.ts` — OIDC setup with openid-client v5 + passport
- `artifacts/api-server/src/lib/auth-storage.ts` — user CRUD (getUser / upsertUser / makeAdmin)
- `artifacts/api-server/src/routes/oauth.ts` — /api/auth/me, /api/auth/status, /api/auth/users
- DB schema: `lib/db/src/schema/auth.ts` — `users` + `sessions` tables; exported from schema/index.ts
- SESSION_SECRET stored as Replit secret (not env var — already exists as secret)
- `connect-pg-simple` uses `createTableIfMissing: true` to handle cold starts

## openid-client v5 API differences from v4
- Import: `import * as client from "openid-client"` (namespace import)
- Strategy: `import { Strategy, VerifyFunction } from "openid-client/passport"`
- Discovery: `client.discovery(new URL(issuer), clientId)` — returns config object
- `client.buildEndSessionUrl(config, params)` — for logout redirect
- `client.refreshTokenGrant(config, refreshToken)` — for token refresh

## Graceful fallback
When `REPL_ID` is not set (dev without Replit context), setupAuth stubs /api/login → redirect, skips OIDC. Sessions still work for API key-based auth.

## Users table
- `id` — varchar PRIMARY KEY (Replit sub claim, UUID format)
- `provider` — "replit" (can extend with "google", "github")
- `isAdmin` — boolean, promoted via POST /api/auth/admin with master key
