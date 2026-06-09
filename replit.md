# NEXUS_OS — AI Command Center

A fully local, open-source AI workspace with chat, RAG (Retrieval-Augmented Generation), and training pipeline management — no external API keys required.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/ai-web-app run dev` — run the web frontend (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — PostgreSQL connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, Tailwind CSS, Framer Motion, shadcn/ui components
- API: Express 5 with OpenAPI-first contract (Orval codegen)
- DB: PostgreSQL + Drizzle ORM
- AI: Ollama (local LLM) — TinyLlama 1B model running 100% locally
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (ESM bundle)

## Where things live

- **API Contract**: `lib/api-spec/openapi.yaml` — source of truth for all API endpoints
- **DB Schema**: `lib/db/src/schema/` — Drizzle tables for conversations, documents, training
- **API Routes**: `artifacts/api-server/src/routes/` — Express route handlers
- **Ollama Integration**: `artifacts/api-server/src/ollama.ts` — local LLM inference wrapper
- **Frontend Pages**: `artifacts/ai-web-app/src/pages/` — Dashboard, Chat, RAG, Training
- **Generated Hooks**: `lib/api-client-react/src/generated/` — React Query hooks from OpenAPI
- **Generated Zod**: `lib/api-zod/src/generated/` — Validation schemas from OpenAPI
- **Theme**: `artifacts/ai-web-app/src/index.css` — Dark neural theme (deep slate + electric green)

## Architecture decisions

- **Local-first AI**: Chat uses Ollama with TinyLlama (1B parameter) running entirely on the server. No external API keys.
- **OpenAPI-first**: Every API endpoint is defined in `openapi.yaml` first, then codegen generates typed React hooks and Zod schemas.
- **RAG simulation**: Document search uses keyword/semantic overlap scoring without external embedding services.
- **Training simulation**: Jobs simulate epochs with progress updates via background async functions.
- **Ollama auto-start**: API server automatically starts Ollama server on boot with `detached: true` spawn.
- **Dark theme default**: Deep slate backgrounds with electric green accents for a developer-focused AI command center feel.

## Product

- **Dashboard**: System overview with real-time stats, recent activity feed, and system status
- **Chat**: Full conversation management with AI assistant powered by local LLM (TinyLlama via Ollama). Create/delete conversations, send messages with real-time responses.
- **Knowledge Base (RAG)**: Upload documents, view indexed chunks, and search via semantic/keyword/hybrid methods.
- **Training Hub**: Create training datasets, add samples, register AI models, and start/manage simulated training jobs with progress tracking.

## User preferences

- AI system operates entirely locally without external API keys.
- Dark theme is the default; all UI uses the neural green/slate palette.
- Font: Syne for headers, Space Mono for technical data.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before using new hooks.
- Database schema changes via `lib/db/src/schema/` require `pnpm --filter @workspace/db run push` to apply.
- API server port is 8080; frontend port is 5000.
- Ollama server is auto-started by the API server; if it fails, chat falls back to rule-based responses.
- The `training_jobs` table needs `createdAt`/`updatedAt` for dashboard ordering.
- Ollama model `tinyllama` is pulled automatically on first use; other models can be pulled via API.
