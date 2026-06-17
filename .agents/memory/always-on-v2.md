---
name: Always-On Engine v2
description: 14-layer always-on system — critical bug fixes and upgrade patterns
---

## URL Detection Bug (FIXED)
Old broken code in index.ts:
```ts
const replDomain = process.env.REPL_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG
  ? `https://...`  // always evaluates as ternary condition, not OR result
  : `http://localhost`;
```
**Fixed to:**
```ts
const devDomain = process.env.REPL_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN;
const replDomain = devDomain ? `https://${devDomain}` : `http://localhost:${port}`;
```

## 14 Layers
L1+14: Self-pinger (3 min, immediate boot ping at 5s)
L2: Service watchdog (Ollama/DB/TgBot/Workers/Providers, 3 min)
L3: DB keepalive SELECT 1 (10 min)
L4: Process hardener (uncaughtException/unhandledRejection — STAYS ALIVE)
L5: Memory guardian (GC at 85%, OOM restart at 95%×3 consecutive checks)
L6: Provider circuit auto-reset (20 min)
L7: Ollama deep watchdog (15 min)
L8: Heartbeat log (60s)
L9: External ping instructions (UptimeRobot/BetterUptime URLs)
L10: Event loop guard (detect blockage >3 min)
L11: Multi-URL ping (dev URL + REPLIT_APP_URL production, both auto-detected)
L12: DB stats persist to system_config every 5 min (survives restarts)
L13: /api/healthz fast response
L14: Immediate cold-start ping (5s after boot)

## Critical: ping target
Pings `/api/healthz` NOT `/api/health` — the health.ts router has `/healthz` route.

## OOM restart
If heap > 95% for 3 consecutive 5-min checks → `process.exit(1)` (Replit VM auto-restarts).
Passes through graceful flush before exit.

## Package install location
Auth + session packages must be installed in `artifacts/api-server/`:
```
cd artifacts/api-server && pnpm add openid-client memoizee connect-pg-simple express-session passport
```
NOT at workspace root (pnpm will reject with ERR_PNPM_ADDING_TO_ROOT).
