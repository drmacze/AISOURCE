---
name: OpenClaw Integration
description: How OpenClaw gateway is configured and run in DLavie OS — config format, Node version, spawn details, and route architecture.
---

# OpenClaw Integration in DLavie OS

## Config format
- OpenClaw reads `openclaw.json` (JSON5/JSON) — **not YAML**
- YAML comments (`#`) cause JSON5 parse failure
- Point to it via `OPENCLAW_CONFIG_PATH` env var
- `OPENCLAW_STATE_DIR` = workspace directory (logs, lock files, etc.)

## Valid config schema (as of v2026.6.5)
```json
{
  "gateway": { "mode": "local", "bind": "loopback" },
  "agents": {
    "defaults": { "workspace": "/path/to/workspace", "skipBootstrap": true },
    "list": [{ "id": "dlavie", "default": true, "workspace": "/path/to/workspace", "identity": { "name": "DLavie", "theme": "...", "emoji": "🤖" } }]
  },
  "meta": { "lastTouchedVersion": "2026.6.5", "lastTouchedAt": "..." }
}
```

**Invalid in agents.defaults/list**: `systemPrompt`, `provider`, `model`, `auth` in gateway body, `skipBootstrap` in list items (only in defaults).

## Auth
- Do NOT put `auth` in the JSON config — it causes `gateway.auth: Invalid input`
- Pass `--auth none` as a CLI flag to `openclaw gateway`

## Node.js version
- OpenClaw v2026.6.5 requires Node.js **v22+**
- Upgrade: `installProgrammingLanguage({ language: "nodejs-22" })` in code_execution
- After upgrade, restart the `artifacts/api-server: API Server` workflow (not `Start API Server`)
- Verify: `node --version` should show v22.x

## Spawn command
```
openclaw gateway --port 18789 --force --allow-unconfigured --auth none
```
- `--force`: kills any existing listener
- `--allow-unconfigured`: starts without requiring full provider config
- `--auth none`: unauthenticated (loopback-only, safe in dev)

## Files
- Manager: `artifacts/api-server/src/openclaw-manager.ts`
- Routes: `artifacts/api-server/src/routes/openclaw.ts`
- OpenAI-compat: `artifacts/api-server/src/routes/openai-compat.ts`
- Skills: `.openclaw-dlavie/skills/dlavie.mjs` (auto-generated on start)
- Config: `.openclaw-dlavie/openclaw.json` (auto-generated on start)
- Frontend: `artifacts/ai-web-app/src/pages/openclaw.tsx`

## API endpoints (all under /api)
- `GET  /openclaw/status` — gateway status JSON
- `POST /openclaw/start|stop|restart` — lifecycle control
- `GET  /openclaw/events` — SSE live log stream
- `POST /openclaw/agent` — proxy message to gateway
- `GET  /openai/v1/models` — OpenAI-compat model list
- `POST /openai/v1/chat/completions` — OpenAI-compat chat (uses DLavie provider chain)

## Provider keys
Pass via env vars — OpenClaw auto-discovers: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`.
Read from `.dlavie-config.json` secrets and inject into the spawned process env.

## Auto-restart
The manager auto-restarts the gateway after 5s on non-zero exit. This loop stops on clean `stopGateway()`.
