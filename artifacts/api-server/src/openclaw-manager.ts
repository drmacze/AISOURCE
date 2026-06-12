/**
 * DLavie OS — OpenClaw Multi-Agent Gateway Manager
 *
 * Manages the OpenClaw gateway with 8 specialist agents:
 *  dlavie      — Default orchestrator, general assistant
 *  trainer     — AI training, datasets, model evaluation
 *  librarian   — Knowledge base, RAG pipeline, document health
 *  guardian    — Tickets, user feedback, quality policing
 *  analyst     — Analytics, metrics, anomaly detection
 *  botmaster   — Telegram + WhatsApp bot operations
 *  curator     — Conversations, prompts, training data
 *  engineer    — System health, Ollama, infrastructure
 *
 * Auto-starts on server boot. Auto-restarts on crash.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const WORKSPACE      = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const OPENCLAW_BIN   = join(WORKSPACE, "artifacts/api-server/node_modules/.bin/openclaw");
const OPENCLAW_HOME  = join(WORKSPACE, ".openclaw-dlavie");
const TG_CONFIG_PATH = join(WORKSPACE, ".dlavie-tg-config.json");
const DLAVIE_CONFIG  = join(WORKSPACE, ".dlavie-config.json");

export const OPENCLAW_PORT = 18789;

export interface OpenClawStatus {
  running:  boolean;
  pid?:     number;
  port:     number;
  uptime?:  number;
  channels: { telegram: boolean; whatsapp: boolean };
  provider: string;
  version:  string;
  error?:   string;
  logs:     string[];
  agents:   string[];
}

interface TgConfig  { token?: string; botName?: string; }
interface DLavieConfig { secrets?: Record<string, string>; }

// ─── State ────────────────────────────────────────────────────────────────────
let gatewayProcess: ChildProcess | null = null;
let startTime:      number | null = null;
let lastError:      string | null = null;
const logBuffer:    string[] = [];
const MAX_LOGS = 300;
export const sseClients: Set<{ send: (event: string, data: unknown) => void }> = new Set();

function pushLog(line: string) {
  const entry = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  for (const c of sseClients) {
    try { c.send("log", { line: entry, ts: Date.now() }); } catch { /* ignore */ }
  }
}

function broadcastStatus() {
  const status = getStatus();
  for (const c of sseClients) {
    try { c.send("status", status); } catch { /* ignore */ }
  }
}

// ─── Credential helpers ───────────────────────────────────────────────────────
function readTgToken(): string {
  try {
    if (existsSync(TG_CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(TG_CONFIG_PATH, "utf8")) as TgConfig;
      return cfg.token || "";
    }
  } catch { /* ignore */ }
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

function readSecrets(): Record<string, string> {
  try {
    if (existsSync(DLAVIE_CONFIG)) {
      const cfg = JSON.parse(readFileSync(DLAVIE_CONFIG, "utf8")) as DLavieConfig;
      return cfg.secrets || {};
    }
  } catch { /* ignore */ }
  return {};
}

// ─── Config generation ────────────────────────────────────────────────────────
const AGENTS = [
  { id: "dlavie",    name: "DLavie",    emoji: "🤖", theme: "autonomous AI developer and general assistant for DLavie OS" },
  { id: "trainer",   name: "Trainer",   emoji: "🧠", theme: "AI training specialist — datasets, benchmarks, model quality" },
  { id: "librarian", name: "Librarian", emoji: "📚", theme: "knowledge base and RAG pipeline guardian" },
  { id: "guardian",  name: "Guardian",  emoji: "🛡️", theme: "ticket handler, user feedback, and quality officer" },
  { id: "analyst",   name: "Analyst",   emoji: "📊", theme: "data intelligence officer — metrics, anomalies, insights" },
  { id: "botmaster", name: "Botmaster", emoji: "🤖", theme: "bot operations manager for Telegram and WhatsApp" },
  { id: "curator",   name: "Curator",   emoji: "✨", theme: "conversation curator and prompt library manager" },
  { id: "engineer",  name: "Engineer",  emoji: "⚙️", theme: "system engineer — Ollama, models, infrastructure" },
];

function writeOpenClawConfig(): string {
  mkdirSync(OPENCLAW_HOME, { recursive: true });

  const list = AGENTS.map((a, idx) => {
    const ws = join(OPENCLAW_HOME, "workspaces", a.id);
    mkdirSync(ws, { recursive: true });
    return {
      id:       a.id,
      default:  idx === 0,
      workspace: ws,
      identity: { name: a.name, theme: a.theme, emoji: a.emoji },
    };
  });

  const defaultWs = join(OPENCLAW_HOME, "workspaces", "dlavie");
  const cfg = {
    gateway: { mode: "local", bind: "loopback" },
    agents: {
      defaults: { workspace: defaultWs, skipBootstrap: true },
      list,
    },
    meta: { lastTouchedVersion: "2026.6.12", lastTouchedAt: new Date().toISOString() },
  };

  const configPath = join(OPENCLAW_HOME, "openclaw.json");
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
  return configPath;
}

function writeSkills() {
  const skillsDir = join(OPENCLAW_HOME, "skills");
  mkdirSync(skillsDir, { recursive: true });

  // ── Core DLavie OS skills (all agents) ──────────────────────────────────────
  writeFileSync(join(skillsDir, "dlavie-core.mjs"), `
/**
 * DLavie OS Core Skills — available to all agents
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: \`\${res.status}: \${await res.text()}\` };
}

export const tools = [
  {
    name: "dlavie_system_status",
    description: "Check DLavie OS system: CPU, RAM, disk, AI provider status, Ollama health.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [health, resources, providers] = await Promise.all([
        api("/api/health"),
        api("/api/resources"),
        api("/api/providers"),
      ]);
      return { health, resources, providers };
    },
  },
  {
    name: "dlavie_dashboard",
    description: "Get DLavie OS dashboard statistics: conversations, messages, documents, training.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/dashboard/stats"); },
  },
  {
    name: "dlavie_chat",
    description: "Send a message to the DLavie OS AI (Groq → OpenRouter → Ollama fallback chain).",
    inputSchema: {
      type: "object",
      properties: {
        message:      { type: "string", description: "Message to the AI" },
        systemPrompt: { type: "string", description: "Optional system prompt" },
      },
      required: ["message"],
    },
    async execute({ message, systemPrompt }) {
      const convRes = await api("/api/conversations", "POST", { title: "Agent task" });
      const convId = convRes?.id;
      if (!convId) return { error: "Could not create conversation" };
      return api(\`/api/conversations/\${convId}/messages\`, "POST", {
        role: "user", content: message,
        ...(systemPrompt ? { systemPrompt } : {}),
      });
    },
  },
  {
    name: "dlavie_send_mail",
    description: "Send a mail to another DLavie OS agent or to the boss (human operator).",
    inputSchema: {
      type: "object",
      properties: {
        to:       { type: "string", description: "Recipient agent id (trainer/librarian/guardian/analyst/botmaster/curator/engineer/boss)" },
        subject:  { type: "string", description: "Mail subject" },
        body:     { type: "string", description: "Mail body" },
        priority: { type: "string", enum: ["low", "normal", "high", "critical"], description: "Priority level" },
      },
      required: ["to", "subject", "body"],
    },
    async execute({ to, subject, body, priority = "normal" }) {
      return api("/api/workers/mail/send", "POST", { to, subject, body, priority });
    },
  },
  {
    name: "dlavie_get_logs",
    description: "Get recent DLavie OS system logs and agent activity.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [workerStatus, openclawLogs] = await Promise.all([
        api("/api/workers/status"),
        api("/api/openclaw/logs"),
      ]);
      return { workerStatus, openclawLogs };
    },
  },
];
`, "utf8");

  // ── Training skills ──────────────────────────────────────────────────────────
  writeFileSync(join(skillsDir, "dlavie-training.mjs"), `
/**
 * DLavie OS Training Skills — for trainer agent
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: \`\${res.status}: \${await res.text()}\` };
}

export const tools = [
  {
    name: "training_list_datasets",
    description: "List all training datasets with sample counts and task types.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/training-datasets"); },
  },
  {
    name: "training_create_dataset",
    description: "Create a new training dataset.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string" },
        description: { type: "string" },
        taskType:    { type: "string", description: "chat/instruct/code/classification/summarization" },
      },
      required: ["name", "taskType"],
    },
    async execute({ name, description = "", taskType }) {
      return api("/api/training-datasets", "POST", { name, description, taskType });
    },
  },
  {
    name: "training_add_sample",
    description: "Add a training sample (input/output pair) to a dataset.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId:   { type: "number" },
        input:       { type: "string" },
        output:      { type: "string" },
        instruction: { type: "string" },
        source:      { type: "string" },
      },
      required: ["datasetId", "input", "output"],
    },
    async execute({ datasetId, input, output, instruction = "", source = "agent" }) {
      return api(\`/api/training-datasets/\${datasetId}/samples\`, "POST", { input, output, instruction, source });
    },
  },
  {
    name: "training_start_job",
    description: "Start a new AI model training job.",
    inputSchema: {
      type: "object",
      properties: {
        jobName:      { type: "string" },
        modelName:    { type: "string" },
        datasetId:    { type: "number" },
        epochs:       { type: "number" },
        learningRate: { type: "number" },
      },
      required: ["jobName", "modelName", "datasetId"],
    },
    async execute({ jobName, modelName, datasetId, epochs = 3, learningRate = 0.0001 }) {
      return api("/api/training-jobs", "POST", { jobName, modelName, datasetId, epochs, learningRate });
    },
  },
  {
    name: "training_list_jobs",
    description: "List all training jobs with status and progress.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/training-jobs"); },
  },
  {
    name: "training_list_models",
    description: "List all registered AI models and Ollama models.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [aiModels, ollamaModels] = await Promise.all([
        api("/api/ai-models"),
        api("/api/ollama-models"),
      ]);
      return { aiModels, ollamaModels };
    },
  },
  {
    name: "training_pull_model",
    description: "Download an Ollama model (e.g. llama3.2, phi3, mistral, qwen2.5-coder).",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Ollama model name" } },
      required: ["name"],
    },
    async execute({ name }) { return api("/api/ollama-models/pull", "POST", { name }); },
  },
  {
    name: "training_run_benchmark",
    description: "Run a benchmark on a trained model.",
    inputSchema: {
      type: "object",
      properties: {
        jobId:     { type: "number" },
        modelName: { type: "string" },
      },
      required: ["modelName"],
    },
    async execute({ jobId, modelName }) {
      return api("/api/training/benchmark", "POST", { jobId, modelName, metrics: ["perplexity", "bleu"] });
    },
  },
  {
    name: "training_import_hf_dataset",
    description: "Search and import a dataset from HuggingFace Hub.",
    inputSchema: {
      type: "object",
      properties: {
        query:     { type: "string", description: "Search query (e.g. 'instruction tuning Indonesian')" },
        limit:     { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
    async execute({ query, limit = 5 }) {
      return api(\`/api/hf/datasets/search?q=\${encodeURIComponent(query)}&limit=\${limit}\`);
    },
  },
  {
    name: "training_analytics",
    description: "Get comprehensive training analytics: job history, model performance, dataset stats.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [analytics, benchmarks, queue] = await Promise.all([
        api("/api/training/analytics"),
        api("/api/training/benchmarks"),
        api("/api/training/queue"),
      ]);
      return { analytics, benchmarks, queue };
    },
  },
];
`, "utf8");

  // ── Knowledge Base skills ────────────────────────────────────────────────────
  writeFileSync(join(skillsDir, "dlavie-knowledge.mjs"), `
/**
 * DLavie OS Knowledge Base Skills — for librarian agent
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: \`\${res.status}: \${await res.text()}\` };
}

export const tools = [
  {
    name: "kb_list_documents",
    description: "List all documents in the DLavie OS knowledge base.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/documents"); },
  },
  {
    name: "kb_add_document",
    description: "Add a text document to the knowledge base for RAG.",
    inputSchema: {
      type: "object",
      properties: {
        title:   { type: "string" },
        content: { type: "string" },
        tags:    { type: "string", description: "Comma-separated tags" },
      },
      required: ["title", "content"],
    },
    async execute({ title, content, tags = "" }) {
      return api("/api/documents", "POST", { title, content, tags });
    },
  },
  {
    name: "kb_search",
    description: "Search the knowledge base with hybrid/semantic/keyword search.",
    inputSchema: {
      type: "object",
      properties: {
        query:  { type: "string" },
        method: { type: "string", enum: ["hybrid", "semantic", "keyword"] },
        limit:  { type: "number" },
      },
      required: ["query"],
    },
    async execute({ query, method = "hybrid", limit = 10 }) {
      return api("/api/documents/search", "POST", { query, method, limit });
    },
  },
  {
    name: "kb_import_url",
    description: "Import a web page or URL into the knowledge base.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "URL to import" } },
      required: ["url"],
    },
    async execute({ url }) { return api("/api/documents/import-url", "POST", { url }); },
  },
  {
    name: "kb_delete_document",
    description: "Delete a document from the knowledge base by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Document ID" } },
      required: ["id"],
    },
    async execute({ id }) { return api(\`/api/documents/\${id}\`, "DELETE"); },
  },
  {
    name: "kb_reembed_all",
    description: "Trigger re-embedding of all documents to refresh search index.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/documents/reembed-all", "POST"); },
  },
  {
    name: "kb_scrape_url",
    description: "Scrape a URL and return its text content for processing.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    async execute({ url }) { return api("/api/autotraining/scrape-url", "POST", { url }); },
  },
  {
    name: "kb_autotraining_sources",
    description: "List and manage auto-training data sources.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/autotraining/sources"); },
  },
];
`, "utf8");

  // ── Bot management skills ────────────────────────────────────────────────────
  writeFileSync(join(skillsDir, "dlavie-bots.mjs"), `
/**
 * DLavie OS Bot Management Skills — for botmaster and guardian agents
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: \`\${res.status}: \${await res.text()}\` };
}

export const tools = [
  {
    name: "telegram_status",
    description: "Check Telegram bot connection status.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/tg-bot/status"); },
  },
  {
    name: "telegram_connect",
    description: "Connect/reconnect the Telegram bot.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/tg-bot/connect", "POST", {}); },
  },
  {
    name: "telegram_send_message",
    description: "Send a message to a Telegram user or group.",
    inputSchema: {
      type: "object",
      properties: {
        chatId:  { type: "string", description: "Telegram chat ID" },
        message: { type: "string", description: "Message text" },
      },
      required: ["chatId", "message"],
    },
    async execute({ chatId, message }) {
      return api("/api/tg-bot/send", "POST", { chatId, message });
    },
  },
  {
    name: "whatsapp_status",
    description: "Check WhatsApp bot connection status.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/wa-bot/status"); },
  },
  {
    name: "list_tickets",
    description: "List support tickets from bot users.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in_progress", "resolved", "closed", "all"] },
      },
      required: [],
    },
    async execute({ status = "open" }) {
      const qs = status !== "all" ? \`?status=\${status}\` : "";
      return api(\`/api/tickets\${qs}\`);
    },
  },
  {
    name: "notify_ticket_resolved",
    description: "Send a resolution notification to the user who filed a ticket.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId:   { type: "number" },
        agentNotes: { type: "string" },
      },
      required: ["ticketId"],
    },
    async execute({ ticketId, agentNotes = "Issue resolved." }) {
      return api(\`/api/tg-bot/notify-ticket/\${ticketId}\`, "POST", { agentNotes });
    },
  },
];
`, "utf8");

  // ── Analytics and admin skills ───────────────────────────────────────────────
  writeFileSync(join(skillsDir, "dlavie-analytics.mjs"), `
/**
 * DLavie OS Analytics & Admin Skills — for analyst and engineer agents
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: \`\${res.status}: \${await res.text()}\` };
}

export const tools = [
  {
    name: "analytics_overview",
    description: "Get comprehensive DLavie OS analytics: conversations, messages, training, documents.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/all"); },
  },
  {
    name: "analytics_system_metrics",
    description: "Get system resource metrics: CPU, RAM, disk over time.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/system-metrics"); },
  },
  {
    name: "analytics_models_usage",
    description: "Get AI model usage breakdown.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/models-usage"); },
  },
  {
    name: "analytics_training_jobs",
    description: "Get training job analytics and completion rates.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/training-jobs"); },
  },
  {
    name: "worker_statuses",
    description: "Get status of all 8 DLavie OS agent workers.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/workers/status"); },
  },
  {
    name: "worker_metrics",
    description: "Get metrics recorded by agent workers.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Filter by agent ID (optional)" },
        limit:   { type: "number" },
      },
      required: [],
    },
    async execute({ agentId, limit = 100 }) {
      const qs = agentId ? \`?agent=\${agentId}&limit=\${limit}\` : \`?limit=\${limit}\`;
      return api(\`/api/workers/metrics\${qs}\`);
    },
  },
  {
    name: "nudge_worker",
    description: "Manually trigger a worker agent to run its tick immediately.",
    inputSchema: {
      type: "object",
      properties: {
        workerId: { type: "string", description: "Worker ID (orchestrator/trainer/librarian/guardian/analyst/botmaster/curator/engineer)" },
      },
      required: ["workerId"],
    },
    async execute({ workerId }) {
      return api(\`/api/workers/\${workerId}/nudge\`, "POST");
    },
  },
  {
    name: "read_boss_inbox",
    description: "Read mail sent to the human operator (boss inbox).",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/workers/mail"); },
  },
  {
    name: "generate_brand_asset",
    description: "Generate a brand image asset with DLavie OS branding.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image description/prompt" },
        style:  { type: "string", description: "Style: logo/banner/avatar/illustration" },
      },
      required: ["prompt"],
    },
    async execute({ prompt, style = "logo" }) {
      return api("/api/brand-kit/generate", "POST", { prompt, style });
    },
  },
  {
    name: "web_search",
    description: "Search the web for information.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results" },
      },
      required: ["query"],
    },
    async execute({ query, limit = 5 }) {
      return api(\`/api/search?q=\${encodeURIComponent(query)}&limit=\${limit}\`);
    },
  },
];
`, "utf8");
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function getStatus(): OpenClawStatus {
  const secrets = readSecrets();
  const tgToken = readTgToken();
  const hasGroq = !!(secrets.GROQ_API_KEY || process.env.GROQ_API_KEY);
  const provider = hasGroq
    ? "groq/llama-3.3-70b"
    : secrets.OPENROUTER_API_KEY
    ? "openrouter/auto"
    : "unconfigured";

  return {
    running: gatewayProcess !== null && gatewayProcess.exitCode === null,
    pid:     gatewayProcess?.pid,
    port:    OPENCLAW_PORT,
    uptime:  startTime ? Math.floor((Date.now() - startTime) / 1000) : undefined,
    channels: {
      telegram:  !!tgToken,
      whatsapp:  false,
    },
    provider,
    version: "2026.6.12",
    error:   lastError ?? undefined,
    logs:    logBuffer.slice(-50),
    agents:  AGENTS.map((a) => a.id),
  };
}

export function getLogs(): string[] {
  return [...logBuffer];
}

export async function startGateway(): Promise<void> {
  if (gatewayProcess && gatewayProcess.exitCode === null) {
    pushLog(`Gateway already running (PID ${gatewayProcess.pid})`);
    return;
  }

  const configPath = writeOpenClawConfig();
  writeSkills();
  lastError = null;

  const secrets = readSecrets();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OPENCLAW_STATE_DIR:   OPENCLAW_HOME,
    OPENCLAW_CONFIG_PATH: configPath,
    NODE_ENV: "production",
    ...(secrets.GROQ_API_KEY       ? { GROQ_API_KEY:       secrets.GROQ_API_KEY }       : {}),
    ...(secrets.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: secrets.OPENROUTER_API_KEY } : {}),
    ...(secrets.ANTHROPIC_API_KEY  ? { ANTHROPIC_API_KEY:  secrets.ANTHROPIC_API_KEY }  : {}),
  };

  pushLog(`Starting OpenClaw Gateway — ${AGENTS.length} agents on port ${OPENCLAW_PORT}…`);

  gatewayProcess = spawn(
    OPENCLAW_BIN,
    ["gateway", "--port", String(OPENCLAW_PORT), "--force", "--allow-unconfigured", "--auth", "none"],
    { env, cwd: WORKSPACE, detached: false, stdio: ["ignore", "pipe", "pipe"] }
  );

  startTime = Date.now();

  gatewayProcess.stdout?.on("data", (buf: Buffer) => {
    String(buf).split("\n").filter(Boolean).forEach(pushLog);
  });
  gatewayProcess.stderr?.on("data", (buf: Buffer) => {
    String(buf).split("\n").filter(Boolean).forEach((l) => pushLog("[err] " + l));
  });
  gatewayProcess.on("error", (err) => {
    lastError = err.message;
    pushLog("[fatal] " + err.message);
    broadcastStatus();
  });
  gatewayProcess.on("exit", (code, sig) => {
    const msg = `Gateway exited (code=${code}, signal=${sig})`;
    pushLog(msg);
    lastError = code !== 0 ? msg : null;
    startTime = null;
    broadcastStatus();
    // Auto-restart on unexpected exit
    if (code !== 0) {
      setTimeout(() => {
        pushLog("Auto-restarting gateway…");
        startGateway().catch((e) => pushLog("[restart error] " + String(e)));
      }, 5000);
    }
  });

  broadcastStatus();
  pushLog(`Gateway spawned (PID ${gatewayProcess.pid}) — agents: ${AGENTS.map((a) => a.id).join(", ")}`);
}

export function stopGateway(): void {
  if (gatewayProcess) {
    pushLog("Stopping gateway…");
    gatewayProcess.removeAllListeners("exit");
    gatewayProcess.kill("SIGTERM");
    gatewayProcess = null;
    startTime      = null;
    broadcastStatus();
  }
}

export async function restartGateway(): Promise<void> {
  stopGateway();
  await new Promise<void>((r) => setTimeout(r, 1000));
  await startGateway();
}
