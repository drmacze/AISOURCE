# DLavie OS — API Connection Guide

Complete reference for connecting to, authenticating with, and using the DLavie OS API.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Authentication](#2-authentication)
3. [Base URLs](#3-base-urls)
4. [Chat API](#4-chat-api)
5. [Model Management API](#5-model-management-api)
6. [Knowledge Base (RAG) API](#6-knowledge-base-rag-api)
7. [Training API](#7-training-api)
8. [Dashboard & System API](#8-dashboard--system-api)
9. [Local Device Mode — Models on Your Own Machine](#9-local-device-mode--models-on-your-own-machine)
10. [Remote Deployment (Vercel + Replit)](#10-remote-deployment-vercel--replit)
11. [Client Examples](#11-client-examples)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Quick Start

### Run Locally (Recommended for Development)

```bash
# 1. Clone / open the project
# 2. Install dependencies
pnpm install

# 3. Set up environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL

# 4. Push DB schema
pnpm --filter @workspace/db run push

# 5. Start API server (port 8080)
pnpm --filter @workspace/api-server run dev

# 6. Start frontend (port 5000)
pnpm --filter @workspace/ai-web-app run dev

# 7. Install Ollama (for local LLM inference)
# macOS/Linux:
curl -fsSL https://ollama.com/install.sh | sh
# Windows: download from https://ollama.com/download

# 8. Pull your first model
ollama pull tinyllama
```

Open `http://localhost:5000` — you're live.

---

## 2. Authentication

All protected endpoints require an API key in the `X-API-Key` header.

**Default dev key** (hardcoded for local use):
```
nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560
```

> **Production**: Set `API_KEY` environment variable to override this key.

### Header format
```http
X-API-Key: nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560
Content-Type: application/json
```

### Endpoints requiring auth
- `POST /api/models/pull`
- `POST /api/models/delete`
- `POST /api/conversations`
- `POST /api/conversations/:id/messages`
- `DELETE /api/conversations/:id`

### Public endpoints (no auth needed)
- `GET /api/v1/health`
- `GET /api/models/list`
- `GET /api/models/catalogue`
- `GET /api/documents`
- `GET /api/dashboard/stats`

---

## 3. Base URLs

| Environment | API Base URL | Frontend URL |
|---|---|---|
| Local dev | `http://localhost:8080` | `http://localhost:5000` |
| Replit (dev) | `https://<repl>.replit.dev` | same origin |
| Vercel deploy | `https://your-api.vercel.app` | `https://your-app.vercel.app` |

### Setting the API URL at runtime

In the frontend, go to **Models → Connected Server → Configure** and enter your API server URL. This is saved in `localStorage` as `nexus_api_url`.

For Vercel deployments, set the env variable:
```bash
VITE_API_URL=https://your-api-server.com
```

---

## 4. Chat API

### OpenAI-compatible endpoint

```bash
curl http://localhost:8080/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560" \
  -d '{
    "model": "tinyllama",
    "messages": [
      { "role": "system",  "content": "You are a helpful assistant." },
      { "role": "user",    "content": "What is machine learning?" }
    ]
  }'
```

**Response:**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "tinyllama",
  "choices": [{
    "message": { "role": "assistant", "content": "Machine learning is..." },
    "finish_reason": "stop"
  }]
}
```

### Conversation management

```bash
# Create conversation
curl -X POST http://localhost:8080/api/conversations \
  -H "Content-Type: application/json" \
  -d '{ "title": "My Chat" }'

# Send message (returns streaming response)
curl -X POST http://localhost:8080/api/conversations/1/messages \
  -H "Content-Type: application/json" \
  -d '{ "content": "Hello!" }'

# List conversations
curl http://localhost:8080/api/conversations

# Delete conversation
curl -X DELETE http://localhost:8080/api/conversations/1
```

---

## 5. Model Management API

### List installed models

```bash
curl http://localhost:8080/api/models/list
```

```json
{
  "models": [
    {
      "name": "tinyllama:latest",
      "label": "TinyLlama",
      "tag": "fast",
      "sizeMB": 637,
      "parameterSize": "1.1B"
    }
  ],
  "count": 1
}
```

### View model catalogue

```bash
curl http://localhost:8080/api/models/catalogue
```

Returns 17 curated models with their install status, size, and tags.

### Pull (download) a model

```bash
curl -X POST http://localhost:8080/api/models/pull \
  -H "Content-Type: application/json" \
  -H "X-API-Key: nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560" \
  -d '{ "model": "qwen2.5:1.5b" }' \
  --no-buffer
```

This is a **Server-Sent Events (SSE)** stream. Each line is:
```
data: {"type":"progress","text":"downloading: 45%","pct":45}
data: {"type":"success","text":"✅ qwen2.5:1.5b ready"}
data: {"type":"done","success":true,"model":"qwen2.5:1.5b"}
```

Event types: `info` | `stdout` | `progress` | `success` | `error` | `done`

### Delete a model

```bash
curl -X POST http://localhost:8080/api/models/delete \
  -H "Content-Type: application/json" \
  -H "X-API-Key: nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560" \
  -d '{ "model": "tinyllama:latest" }'
```

### Search HuggingFace Hub

```bash
curl "http://localhost:8080/api/models/hf-search?q=llama&task=text-generation&limit=10"
```

---

## 6. Knowledge Base (RAG) API

### List documents

```bash
curl http://localhost:8080/api/documents
```

### Upload a document

```bash
curl -X POST http://localhost:8080/api/documents/upload \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Document",
    "content": "The full text content of your document goes here..."
  }'
```

The server automatically **chunks** the content (500 chars, 80-char overlap) and indexes it for BM25 search.

### Import a URL

```bash
curl -X POST http://localhost:8080/api/documents/import-url \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://en.wikipedia.org/wiki/Machine_learning" }'
```

Response:
```json
{ "id": 1, "title": "Machine learning", "chunkCount": 24, "size": 12048 }
```

### BM25 semantic search

```bash
curl -X POST http://localhost:8080/api/documents/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "what is transformer architecture",
    "limit": 5,
    "method": "bm25"
  }'
```

Response:
```json
[
  {
    "id": 1,
    "title": "Attention Is All You Need",
    "score": 8.42,
    "rank": 1,
    "snippet": "The Transformer model relies solely on an attention mechanism...",
    "chunkCount": 18
  }
]
```

### Delete a document

```bash
curl -X DELETE http://localhost:8080/api/documents/1
```

---

## 7. Training API

### List datasets

```bash
curl http://localhost:8080/api/training/datasets
```

### Create a dataset

```bash
curl -X POST http://localhost:8080/api/training/datasets \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer Support QA",
    "description": "Question-answer pairs for support bot",
    "taskType": "qa"
  }'
```

### Add training samples

```bash
curl -X POST http://localhost:8080/api/training/samples \
  -H "Content-Type: application/json" \
  -d '{
    "datasetId": 1,
    "input": "How do I reset my password?",
    "output": "Go to Settings > Security > Reset Password and follow the steps."
  }'
```

### Start a training job

```bash
curl -X POST http://localhost:8080/api/training/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": 1,
    "datasetId": 1,
    "config": { "epochs": 3, "learningRate": 0.0001 }
  }'
```

### Get auto-training status

```bash
curl http://localhost:8080/api/autotraining/status
```

```json
{
  "running": true,
  "totalCyclesCompleted": 4,
  "totalSamplesAdded": 187,
  "lastCycleAt": "2026-06-08T21:49:00.000Z",
  "nextCycleAt": "2026-06-09T00:49:00.000Z",
  "activityLog": [
    { "msg": "⚡ Micro: \"Transformer\" → 1 sample", "type": "success" }
  ]
}
```

---

## 8. Dashboard & System API

### Health check

```bash
curl http://localhost:8080/api/v1/health
```

```json
{
  "status": "ok",
  "ollama": true,
  "engine": "Ollama (local)",
  "ollamaHost": "127.0.0.1:11434",
  "version": "0.9.5",
  "huggingface": true,
  "uptime": 3620
}
```

### Dashboard stats

```bash
curl http://localhost:8080/api/dashboard/stats
```

---

## 9. Local Device Mode — Models on Your Own Machine

By default, when the app runs on Replit, models are downloaded to Replit's server (limited to ~5GB disk). To save models to **your own machine's storage**, set up Local Device Mode.

### Step 1: Install Ollama on your machine

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download from: https://ollama.com/download/windows
```

### Step 2: Enable CORS so the browser can reach your Ollama

```bash
# macOS / Linux — run Ollama with CORS open
OLLAMA_ORIGINS="*" ollama serve

# Windows (PowerShell)
$env:OLLAMA_ORIGINS="*"; ollama serve

# Or set it permanently in your system environment variables
```

### Step 3: In the DLavie OS UI — set Local Ollama URL

1. Open the app → **Models** page
2. In the **Local Device Mode** panel, enter: `http://localhost:11434`
3. Click **Save**
4. The status indicator should turn green (✅ Local Ollama reachable)

### Step 4: Pull a model to YOUR machine

In the **Model Catalogue**, each card now shows a **"Pull to My Device"** button.  
Click it — the download goes straight to your local Ollama, stored on **your disk**.

### Verify locally

```bash
# Check Ollama is running on your machine
curl http://localhost:11434/api/version

# List models on your machine
ollama list

# Test chat
ollama run tinyllama "Hello! Are you there?"
```

### Architecture (Local Device Mode)

```
Browser (your device)
    │
    ├─► localhost:11434/api/pull  ←── download goes directly to YOUR disk
    │
    └─► Replit API server  ←── chat, RAG, training, dashboard
          │
          └─► Replit Ollama  ←── fallback for cloud inference
```

---

## 10. Remote Deployment (Vercel + Replit)

### Deploy API server to a VPS / Railway / Render

```bash
# Environment variables required:
DATABASE_URL=postgresql://...
PORT=8080
HF_TOKEN=hf_...   (optional — for HuggingFace fallback)
API_KEY=your-secret-key
```

### Deploy frontend to Vercel

```bash
# In Vercel project settings, add:
VITE_API_URL=https://your-api-server.com
```

Or set it at runtime in the app under **Models → Connected Server → Configure**.

### CORS

The API server accepts all HTTPS origins by default:
```typescript
// From app.ts
origin: (origin, cb) => {
  if (!origin || origin.startsWith("https://")) cb(null, true);
  else cb(null, false);
}
```

For custom domains or local dev, set:
```bash
CORS_ORIGIN=https://your-frontend.vercel.app
```

---

## 11. Client Examples

### JavaScript / TypeScript

```typescript
const API_BASE = "http://localhost:8080";
const API_KEY  = "nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560";

// Chat completion
const response = await fetch(`${API_BASE}/api/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
  body: JSON.stringify({
    model: "tinyllama",
    messages: [{ role: "user", content: "Explain quantum computing" }],
  }),
});
const data = await response.json();
console.log(data.choices[0].message.content);

// Pull a model (SSE stream)
async function pullModel(model: string) {
  const res = await fetch(`${API_BASE}/api/models/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify({ model }),
  });
  const reader = res.body!.getReader();
  const dec    = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      if (line.startsWith("data:")) {
        const event = JSON.parse(line.slice(5));
        console.log(`[${event.type}] ${event.text}`);
        if (event.type === "done") return event.success;
      }
    }
  }
}
```

### Python

```python
import requests
import json

API_BASE = "http://localhost:8080"
API_KEY  = "nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560"
HEADERS  = {"Content-Type": "application/json", "X-API-Key": API_KEY}

# Chat completion
resp = requests.post(
    f"{API_BASE}/api/v1/chat/completions",
    headers=HEADERS,
    json={
        "model": "tinyllama",
        "messages": [{"role": "user", "content": "Explain machine learning"}],
    },
)
print(resp.json()["choices"][0]["message"]["content"])

# BM25 search
results = requests.post(
    f"{API_BASE}/api/documents/search",
    headers=HEADERS,
    json={"query": "transformer architecture", "limit": 3},
).json()

for r in results:
    print(f"[{r['score']:.2f}] {r['title']}: {r['snippet'][:100]}")

# Pull model (streaming)
def pull_model(model: str):
    with requests.post(
        f"{API_BASE}/api/models/pull",
        headers=HEADERS,
        json={"model": model},
        stream=True,
    ) as r:
        for line in r.iter_lines():
            if line.startswith(b"data:"):
                event = json.loads(line[5:])
                print(f"[{event['type']}] {event.get('text', '')}")
                if event["type"] == "done":
                    return event["success"]

pull_model("qwen2.5:1.5b")
```

### cURL — one-liners

```bash
# Health check
curl http://localhost:8080/api/v1/health | jq

# List installed models
curl http://localhost:8080/api/models/list | jq '.models[].name'

# Search knowledge base
curl -X POST http://localhost:8080/api/documents/search \
  -H "Content-Type: application/json" \
  -d '{"query":"deep learning","limit":3}' | jq '.[].title'

# Import URL to knowledge base
curl -X POST http://localhost:8080/api/documents/import-url \
  -H "Content-Type: application/json" \
  -d '{"url":"https://en.wikipedia.org/wiki/Neural_network_(machine_learning)"}' | jq

# Pull tinyllama and watch progress
curl -sN -X POST http://localhost:8080/api/models/pull \
  -H "Content-Type: application/json" \
  -H "X-API-Key: nxs_d91177d30cd5dc48bc05e34b6c81e9bd68e07070ffce893be47e6447520fd560" \
  -d '{"model":"tinyllama"}' | grep "^data:" | while read line; do
  echo "${line:5}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'[{d[\"type\"]}] {d.get(\"text\",\"\")}')"
done
```

---

## 12. Troubleshooting

### "Download failed (exit code null)"
The model download was killed — usually because:
- **Replit disk is full** (~1–5GB limit). Delete unused models first or use Local Device Mode.
- **OOM**: Model too large for available RAM. Start with `tinyllama` (637 MB) first.

**Fix**: Use Local Device Mode (Section 9) so models go to your local machine.

### "Ollama server not reachable"
```bash
# Restart Ollama
pkill ollama && ollama serve &
# or on the API server, call:
curl -X POST http://localhost:8080/api/autotraining/trigger
```

### CORS errors in browser
If you see `Access-Control-Allow-Origin` errors:
1. Ensure your API URL is HTTPS (not HTTP) when accessing from a browser on HTTPS
2. Or add your origin to `CORS_ORIGIN` env var

### Local Ollama not reachable from browser
```bash
# Start Ollama with CORS enabled
OLLAMA_ORIGINS="*" ollama serve

# Test from terminal on your machine
curl http://localhost:11434/api/version
```

If the app is on HTTPS (Replit/Vercel) and your Ollama is on HTTP localhost, the browser may block the request due to mixed content policy. Solution:
- Use a local reverse proxy with HTTPS (e.g., `mkcert` + nginx)
- Or run the full API server locally and set the Connected Server URL to `http://localhost:8080`

### Database issues
```bash
# Push latest schema
pnpm --filter @workspace/db run push

# Check connection
psql $DATABASE_URL -c "SELECT 1"
```

### Auto-training not running
```bash
curl http://localhost:8080/api/autotraining/status | jq '.running'
# Should be true

# Manually trigger a cycle
curl -X POST http://localhost:8080/api/autotraining/trigger
```

---

## API Endpoint Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET    | `/api/v1/health`                  | No   | System health + Ollama status |
| GET    | `/api/v1/chat/completions`        | Yes  | OpenAI-compatible chat |
| GET    | `/api/conversations`              | No   | List conversations |
| POST   | `/api/conversations`              | Yes  | Create conversation |
| POST   | `/api/conversations/:id/messages` | Yes  | Send message |
| DELETE | `/api/conversations/:id`          | Yes  | Delete conversation |
| GET    | `/api/models/list`                | No   | List installed models |
| GET    | `/api/models/catalogue`           | No   | Curated model catalogue |
| POST   | `/api/models/pull`                | Yes  | Pull/download a model (SSE) |
| POST   | `/api/models/delete`              | Yes  | Delete a model |
| GET    | `/api/models/hf-search`           | No   | Search HuggingFace |
| GET    | `/api/documents`                  | No   | List documents |
| POST   | `/api/documents/upload`           | No   | Upload + index document |
| POST   | `/api/documents/import-url`       | No   | Fetch URL + index |
| POST   | `/api/documents/search`           | No   | BM25 search |
| DELETE | `/api/documents/:id`              | No   | Delete document |
| GET    | `/api/training/datasets`          | No   | List datasets |
| POST   | `/api/training/datasets`          | No   | Create dataset |
| POST   | `/api/training/samples`           | No   | Add training sample |
| GET    | `/api/training/jobs`              | No   | List training jobs |
| POST   | `/api/training/jobs`              | No   | Start training job |
| GET    | `/api/autotraining/status`        | No   | Auto-training status |
| POST   | `/api/autotraining/trigger`       | No   | Trigger manual cycle |
| GET    | `/api/dashboard/stats`            | No   | Dashboard statistics |
