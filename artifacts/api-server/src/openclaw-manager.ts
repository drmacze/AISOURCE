/**
 * DLavie OS — OpenClaw Gateway Manager
 *
 * Manages the OpenClaw gateway process lifecycle.
 * - Spawns openclaw gateway on port 18789
 * - Configures provider chain (Groq → OpenRouter → Ollama)
 * - Configures Telegram + WhatsApp channels from existing DLavie credentials
 * - Provides status, restart, and SSE log streaming
 */

import { spawn, execFileSync, type ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const WORKSPACE = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const OPENCLAW_BIN = join(WORKSPACE, "artifacts/api-server/node_modules/.bin/openclaw");
const OPENCLAW_HOME = join(WORKSPACE, ".openclaw-dlavie");
const TG_CONFIG_PATH = join(WORKSPACE, ".dlavie-tg-config.json");
const DLAVIE_CONFIG_PATH = join(WORKSPACE, ".dlavie-config.json");

export const OPENCLAW_PORT = 18789;

export interface OpenClawStatus {
  running: boolean;
  pid?: number;
  port: number;
  uptime?: number;
  channels: { telegram: boolean; whatsapp: boolean };
  provider: string;
  version: string;
  error?: string;
  logs: string[];
}

interface TgConfig {
  token?: string;
  botName?: string;
}

interface DLavieConfig {
  secrets?: Record<string, string>;
}

// ─── State ────────────────────────────────────────────────────────────────────

let gatewayProcess: ChildProcess | null = null;
let startTime: number | null = null;
let lastError: string | null = null;
const logBuffer: string[] = [];
const MAX_LOGS = 200;
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

function readDLavieSecrets(): Record<string, string> {
  try {
    if (existsSync(DLAVIE_CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(DLAVIE_CONFIG_PATH, "utf8")) as DLavieConfig;
      return cfg.secrets || {};
    }
  } catch { /* ignore */ }
  return {};
}

// ─── Config setup ─────────────────────────────────────────────────────────────

function ensureOpenClawHome() {
  mkdirSync(OPENCLAW_HOME, { recursive: true });
  mkdirSync(join(OPENCLAW_HOME, "skills"), { recursive: true });
}

function writeOpenClawConfig() {
  ensureOpenClawHome();
  const agentWorkspace = join(OPENCLAW_HOME, "workspace");
  mkdirSync(agentWorkspace, { recursive: true });

  // Minimal valid config based on actual openclaw schema (--dev generated output)
  const cfg = {
    gateway: {
      mode: "local",
      bind: "loopback",
    },
    agents: {
      defaults: {
        workspace: agentWorkspace,
        skipBootstrap: true,
      },
      list: [
        {
          id: "dlavie",
          default: true,
          workspace: agentWorkspace,
          identity: {
            name: "DLavie",
            theme: "autonomous AI developer for DLavie OS",
            emoji: "🤖",
          },
        },
      ],
    },
    meta: {
      lastTouchedVersion: "2026.6.5",
      lastTouchedAt: new Date().toISOString(),
    },
  };

  const configPath = join(OPENCLAW_HOME, "openclaw.json");
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
  return configPath;
}

function writeDLavieSkills() {
  const skillsDir = join(OPENCLAW_HOME, "skills");
  mkdirSync(skillsDir, { recursive: true });

  const skillCode = `/**
 * DLavie OS Skills for OpenClaw Agent
 * Gives the agent full access to DLavie OS APIs.
 */

const BASE_URL = "http://127.0.0.1:3000";

async function apiCall(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + path, opts);
  return res.json();
}

export const tools = [
  {
    name: "dlavie_system_status",
    description: "Check DLavie OS system health: CPU, RAM, disk, AI provider status, and Ollama model list.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [resources, health] = await Promise.all([
        apiCall("/api/resources"),
        apiCall("/api/health"),
      ]);
      return { resources, health };
    }
  },
  {
    name: "dlavie_list_models",
    description: "List all installed Ollama models and available AI providers.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [models, providers] = await Promise.all([
        apiCall("/api/models"),
        apiCall("/api/providers"),
      ]);
      return { models, providers };
    }
  },
  {
    name: "dlavie_pull_model",
    description: "Download an Ollama model to DLavie OS. Example model names: llama3.2, phi3, mistral, qwen2.5-coder.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Ollama model name, e.g. 'llama3.2' or 'phi3:mini'" }
      },
      required: ["model"]
    },
    async execute({ model }) {
      return apiCall("/api/models/pull", "POST", { name: model });
    }
  },
  {
    name: "dlavie_search_knowledge",
    description: "Search the DLavie OS knowledge base (RAG) for relevant documents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        method: { type: "string", enum: ["hybrid", "semantic", "keyword"], description: "Search method (default: hybrid)" }
      },
      required: ["query"]
    },
    async execute({ query, method = "hybrid" }) {
      return apiCall(\`/api/documents/search?q=\${encodeURIComponent(query)}&method=\${method}\`);
    }
  },
  {
    name: "dlavie_list_training_jobs",
    description: "List all training jobs with their status and progress.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return apiCall("/api/training/jobs");
    }
  },
  {
    name: "dlavie_start_training",
    description: "Start a new AI model training job on DLavie OS.",
    inputSchema: {
      type: "object",
      properties: {
        jobName:    { type: "string", description: "Name for this training job" },
        modelName:  { type: "string", description: "Base Ollama model to fine-tune" },
        datasetId:  { type: "number", description: "ID of the training dataset to use" },
        epochs:     { type: "number", description: "Number of training epochs (default: 3)" },
        learningRate: { type: "number", description: "Learning rate (default: 0.0001)" }
      },
      required: ["jobName", "modelName", "datasetId"]
    },
    async execute(args) {
      return apiCall("/api/training/jobs", "POST", {
        jobName: args.jobName,
        modelName: args.modelName,
        datasetId: args.datasetId,
        epochs: args.epochs ?? 3,
        learningRate: args.learningRate ?? 0.0001,
      });
    }
  },
  {
    name: "dlavie_list_datasets",
    description: "List all training datasets available in DLavie OS.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return apiCall("/api/training/datasets");
    }
  },
  {
    name: "dlavie_create_dataset",
    description: "Create a new training dataset in DLavie OS.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Dataset name" },
        description: { type: "string", description: "What this dataset is for" },
        taskType:    { type: "string", description: "Task type: chat, instruct, code, classification, summarization, etc." }
      },
      required: ["name", "taskType"]
    },
    async execute({ name, description = "", taskType }) {
      return apiCall("/api/training/datasets", "POST", { name, description, taskType });
    }
  },
  {
    name: "dlavie_add_training_sample",
    description: "Add a training sample (input/output pair) to a dataset.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "number", description: "Target dataset ID" },
        input:     { type: "string", description: "Input text / user message" },
        output:    { type: "string", description: "Expected output / assistant response" },
        instruction: { type: "string", description: "Optional system instruction" }
      },
      required: ["datasetId", "input", "output"]
    },
    async execute({ datasetId, input, output, instruction = "" }) {
      return apiCall(\`/api/training/datasets/\${datasetId}/samples\`, "POST", { input, output, instruction });
    }
  },
  {
    name: "dlavie_add_document",
    description: "Add a text document to the DLavie OS knowledge base for RAG search.",
    inputSchema: {
      type: "object",
      properties: {
        title:   { type: "string", description: "Document title" },
        content: { type: "string", description: "Document text content" },
        tags:    { type: "string", description: "Comma-separated tags" }
      },
      required: ["title", "content"]
    },
    async execute({ title, content, tags = "" }) {
      return apiCall("/api/documents", "POST", { title, content, tags });
    }
  },
  {
    name: "dlavie_chat",
    description: "Send a message to DLavie OS AI (uses the full provider chain: Groq → OpenRouter → Ollama). Use this for sub-tasks and reasoning.",
    inputSchema: {
      type: "object",
      properties: {
        message:      { type: "string", description: "Message to send to the AI" },
        systemPrompt: { type: "string", description: "Optional system prompt override" }
      },
      required: ["message"]
    },
    async execute({ message, systemPrompt }) {
      const body = { message, ...(systemPrompt ? { systemPrompt } : {}) };
      const res = await fetch(BASE_URL + "/api/conversations/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.json();
    }
  },
  {
    name: "dlavie_dashboard_stats",
    description: "Get DLavie OS dashboard statistics: conversation count, message count, document count, training sample count.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return apiCall("/api/dashboard");
    }
  }
];
`;

  writeFileSync(join(skillsDir, "dlavie.mjs"), skillCode, "utf8");
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function getStatus(): OpenClawStatus {
  const secrets = readDLavieSecrets();
  const tgToken = readTgToken();
  const hasGroq = !!(secrets.GROQ_API_KEY || process.env.GROQ_API_KEY);
  const provider = hasGroq ? "groq/llama-3.3-70b" : (secrets.OPENROUTER_API_KEY ? "openrouter/auto" : "unconfigured");

  return {
    running: gatewayProcess !== null && gatewayProcess.exitCode === null,
    pid:     gatewayProcess?.pid,
    port:    OPENCLAW_PORT,
    uptime:  startTime ? Math.floor((Date.now() - startTime) / 1000) : undefined,
    channels: {
      telegram: !!tgToken,
      whatsapp: false,
    },
    provider,
    version: "2026.6.5",
    error:   lastError ?? undefined,
    logs:    logBuffer.slice(-50),
  };
}

export function getLogs(): string[] {
  return [...logBuffer];
}

export async function startGateway(): Promise<void> {
  if (gatewayProcess && gatewayProcess.exitCode === null) {
    pushLog("Gateway already running (PID " + gatewayProcess.pid + ")");
    return;
  }

  writeOpenClawConfig();
  writeDLavieSkills();

  const configPath = join(OPENCLAW_HOME, "openclaw.json");
  lastError = null;

  const secrets = readDLavieSecrets();
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OPENCLAW_STATE_DIR:   OPENCLAW_HOME,
    OPENCLAW_CONFIG_PATH: configPath,
    NODE_ENV: "production",
    // Pass AI provider keys so OpenClaw auto-discovers them
    ...(secrets.GROQ_API_KEY       ? { GROQ_API_KEY:            secrets.GROQ_API_KEY }            : {}),
    ...(secrets.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY:       secrets.OPENROUTER_API_KEY }       : {}),
    ...(secrets.ANTHROPIC_API_KEY  ? { ANTHROPIC_API_KEY:        secrets.ANTHROPIC_API_KEY }        : {}),
  };

  pushLog(`Starting OpenClaw Gateway on port ${OPENCLAW_PORT}…`);

  gatewayProcess = spawn(
    OPENCLAW_BIN,
    ["gateway", "--port", String(OPENCLAW_PORT), "--force", "--allow-unconfigured", "--auth", "none"],
    {
      env,
      cwd: WORKSPACE,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    }
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

    // Auto-restart after 5s if it died unexpectedly
    if (code !== 0) {
      setTimeout(() => {
        pushLog("Auto-restarting gateway…");
        startGateway().catch((e) => pushLog("[restart error] " + String(e)));
      }, 5000);
    }
  });

  broadcastStatus();
  pushLog("Gateway spawned (PID " + String(gatewayProcess.pid) + ")");
}

export function stopGateway(): void {
  if (gatewayProcess) {
    pushLog("Stopping gateway…");
    gatewayProcess.removeAllListeners("exit");
    gatewayProcess.kill("SIGTERM");
    gatewayProcess = null;
    startTime = null;
    broadcastStatus();
  }
}

export async function restartGateway(): Promise<void> {
  stopGateway();
  await new Promise<void>((r) => setTimeout(r, 1000));
  await startGateway();
}
