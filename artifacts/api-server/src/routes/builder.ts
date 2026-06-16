/**
 * DLavie OS — AI Builder System
 *
 * Task board (Draft→Queued→Active→Ready→Done) dimana 12 agent spesialis
 * mengerjakan task sesuai skill masing-masing.
 *
 * Setiap agent punya job tetap — botmaster hanya handle bot,
 * trainer hanya handle training, dll. Jika butuh skill agen lain,
 * mereka request kolaborasi via `request_collab` tool.
 *
 * NO SIMULATION. Semua file ops, shell commands, dan LLM calls nyata.
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { builderTasksTable, agentMemoriesTable } from "@workspace/db";
import { eq, desc, asc, or, like } from "drizzle-orm";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, relative, extname } from "path";
import { execSync, exec } from "child_process";
import {
  generateGroqResponse,
  isGroqConfigured,
  GROQ_MODELS,
} from "../groq.js";
import {
  generateOpenRouterResponse,
  isOpenRouterConfigured,
} from "../openrouter.js";
import {
  chatCompletionHFWithFallback,
  isHFConfigured,
  type ChatMessage,
} from "../huggingface.js";
import { generateOllamaResponse } from "../ollama.js";

const router = Router();
const WORKSPACE = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";

// ─── LLM call ─────────────────────────────────────────────────────────────────

let hfUnavailableUntil = 0;

async function builderLLM(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<{ text: string; model: string }> {
  if (isHFConfigured() && Date.now() > hfUnavailableUntil) {
    try {
      return await chatCompletionHFWithFallback(messages, {
        maxTokens: opts.maxTokens ?? 3000,
        temperature: opts.temperature ?? 0.15,
      });
    } catch (e) {
      const s = String(e);
      if (s.includes("401") || s.includes("Invalid username")) {
        hfUnavailableUntil = Date.now() + 30 * 60_000;
      }
    }
  }
  if (isGroqConfigured()) {
    const groqOrder = [
      "llama-3.3-70b-versatile", "qwen/qwen3-32b",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "llama-3.1-8b-instant",
      ...GROQ_MODELS.map((m) => m.id).filter((id) => ![
        "llama-3.3-70b-versatile", "qwen/qwen3-32b",
        "meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.1-8b-instant",
      ].includes(id)),
    ];
    for (const model of groqOrder) {
      try {
        const text = await generateGroqResponse(
          messages as Parameters<typeof generateGroqResponse>[0],
          model,
          opts
        );
        if (text) return { text, model: `groq/${model}` };
      } catch (e) {
        const s = String(e);
        if (s.includes("429")) await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  if (isOpenRouterConfigured()) {
    for (const model of [
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen3-coder:free",
      "google/gemma-4-31b-it:free",
    ]) {
      try {
        const text = await generateOpenRouterResponse(
          messages as Parameters<typeof generateOpenRouterResponse>[0],
          model,
          opts
        );
        if (text) return { text, model: `openrouter/${model}` };
      } catch { continue; }
    }
  }
  const prompt = messages.map((m) =>
    `${m.role === "system" ? "SYSTEM" : m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`
  ).join("\n\n");
  for (const m of ["tinyllama", "qwen2.5:3b", "gemma3:4b"]) {
    try {
      const text = await generateOllamaResponse(prompt, m);
      if (text) return { text, model: `ollama/${m}` };
    } catch { continue; }
  }
  throw new Error("All LLM providers failed for builder task");
}

// ─── Agent skill constraints ──────────────────────────────────────────────────
// Job tiap agent TIDAK bisa diambil alih agent lain.
// Jika butuh skill agen lain → pakai request_collab.

const AGENT_ALLOWED_TOOLS: Record<string, string[]> = {
  orchestrator: ["think", "read_file", "list_files", "search_code", "read_project_context", "plan_task", "request_collab", "finish"],
  engineer:     ["think", "read_file", "write_file", "list_files", "search_code", "run_shell", "generate_code", "analyze_code", "read_project_context", "request_collab", "finish"],
  reviewer:     ["think", "read_file", "list_files", "search_code", "analyze_code", "read_project_context", "request_collab", "finish"],
  deployer:     ["think", "run_shell", "read_file", "list_files", "read_project_context", "request_collab", "finish"],
  researcher:   ["think", "web_search", "read_file", "execute_python", "read_project_context", "request_collab", "finish"],
  trainer:      ["think", "read_file", "write_file", "execute_python", "read_project_context", "request_collab", "finish"],
  librarian:    ["think", "read_file", "write_file", "run_shell", "list_files", "read_project_context", "request_collab", "finish"],
  guardian:     ["think", "read_file", "search_code", "analyze_code", "read_project_context", "request_collab", "finish"],
  analyst:      ["think", "read_file", "execute_python", "search_code", "read_project_context", "request_collab", "finish"],
  botmaster:    ["think", "read_file", "write_file", "run_shell", "read_project_context", "request_collab", "finish"],
  curator:      ["think", "read_file", "write_file", "generate_code", "read_project_context", "request_collab", "finish"],
  mandor:       ["think", "read_file", "list_files", "plan_task", "search_code", "read_project_context", "request_collab", "finish"],
};

const AGENT_ROLE_DESCRIPTIONS: Record<string, string> = {
  orchestrator: "Master coordinator. Decomposes tasks, assigns to other agents, routes work. Reads project context but does NOT write code. If task needs code writing, use request_collab to assign to engineer.",
  engineer:     "Backend/frontend engineer. Writes code, edits files, runs builds (pnpm install, pnpm run build, pnpm typecheck). Fixes TypeScript errors. Creates new components, routes, schemas. Does NOT handle training data, bots, or deployment pipeline.",
  reviewer:     "Code quality reviewer. Reads code and gives structured review. Does NOT modify files — only reads and analyzes. If code needs fixing, use request_collab to assign engineer.",
  deployer:     "Deployment & CI/CD. Runs pnpm build, checks for errors, runs the app. Does NOT write application code — only runs and validates builds.",
  researcher:   "Research & intelligence. Searches web for information, analyzes data with Python. Does NOT write application code. If research findings need to be implemented, use request_collab.",
  trainer:      "AI training & datasets. Works with training data files, writes training scripts (Python/JS). Does NOT touch frontend or backend application routes.",
  librarian:    "Knowledge base & RAG. Manages document files, indexes content. Does NOT write application code or training scripts.",
  guardian:     "Security & quality. Reviews code for vulnerabilities and quality issues. Read-only like reviewer. Uses request_collab if fixes needed.",
  analyst:      "Data analysis. Analyzes logs, metrics, performance data using Python. Does NOT write application code.",
  botmaster:    "Bot operations ONLY. Handles Telegram bot (routes/tg-bot.ts), WhatsApp bot (routes/wa-bot.ts, routes/whatsapp.ts) files exclusively. Does NOT touch other parts of the codebase.",
  curator:      "Prompt engineering & UI content. Writes prompt templates, UI copy, and frontend content. Does NOT touch backend routes or database schema.",
  mandor:       "Project supervisor & planner. Reads codebase, plans tasks, creates subtasks for other agents. Does NOT write code directly.",
};

// ─── Log entry type ───────────────────────────────────────────────────────────

export interface BuilderLogEntry {
  type: "thought" | "tool_call" | "tool_result" | "info" | "error" | "done" | "collab";
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  ok?: boolean;
  ts: number;
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────

const taskStreams = new Map<number, Set<Response>>();

function broadcastTaskLog(taskId: number, entry: BuilderLogEntry): void {
  const clients = taskStreams.get(taskId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of clients) {
    if (!res.writableEnded) res.write(payload);
  }
}

async function appendLog(taskId: number, entry: Omit<BuilderLogEntry, "ts">): Promise<void> {
  const full: BuilderLogEntry = { ...entry, ts: Date.now() };
  broadcastTaskLog(taskId, full);
  try {
    const [task] = await db.select().from(builderTasksTable).where(eq(builderTasksTable.id, taskId)).limit(1);
    if (!task) return;
    const existing: BuilderLogEntry[] = task.agentLog ? JSON.parse(task.agentLog) : [];
    existing.push(full);
    await db.update(builderTasksTable)
      .set({ agentLog: JSON.stringify(existing.slice(-200)), updatedAt: new Date() })
      .where(eq(builderTasksTable.id, taskId));
  } catch { /* ignore */ }
}

// ─── Tool result type ─────────────────────────────────────────────────────────

interface ToolResult { ok: boolean; data?: unknown; error?: string; }

// ─── Builder tools ─────────────────────────────────────────────────────────────
// Semua tool nyata — tidak ada simulasi.

function buildToolSet(allowedTools: string[], taskId: number, agentId: string): Map<string, (args: Record<string, unknown>) => Promise<ToolResult>> {
  const all = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>();

  // think
  all.set("think", async (args) => {
    const q = String(args.question || args.topic || "");
    if (!q) return { ok: false, error: "question required" };
    try {
      const r = await builderLLM([
        { role: "system", content: "You are an expert software architect. Think step by step, be specific and actionable." },
        { role: "user", content: q },
      ], { maxTokens: 1500, temperature: 0.1 });
      return { ok: true, data: { analysis: r.text, model: r.model } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // read_project_context
  all.set("read_project_context", async () => {
    try {
      const replitMd = join(WORKSPACE, "replit.md");
      const context = existsSync(replitMd) ? readFileSync(replitMd, "utf8").slice(0, 4000) : "replit.md not found";
      return { ok: true, data: { context } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // read_file
  all.set("read_file", async (args) => {
    const relPath = String(args.path || "");
    const maxLines = Number(args.maxLines || 200);
    if (!relPath) return { ok: false, error: "path required" };
    try {
      const fp = join(WORKSPACE, relPath);
      if (!existsSync(fp)) return { ok: false, error: `File not found: ${relPath}` };
      const content = readFileSync(fp, "utf8");
      const lines = content.split("\n");
      const offset = Number(args.offset || 0);
      const slice = lines.slice(offset, offset + maxLines);
      return { ok: true, data: { path: relPath, content: slice.join("\n"), totalLines: lines.length, shown: slice.length } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // write_file
  all.set("write_file", async (args) => {
    const relPath = String(args.path || "");
    const content = String(args.content ?? "");
    if (!relPath) return { ok: false, error: "path required" };
    // botmaster can only write bot files
    if (agentId === "botmaster") {
      const allowed = ["routes/tg-bot", "routes/wa-bot", "routes/whatsapp", "routes/telegram"];
      if (!allowed.some((p) => relPath.includes(p))) {
        return { ok: false, error: `botmaster can only write bot files (tg-bot, wa-bot, whatsapp). Use request_collab for other files.` };
      }
    }
    try {
      const fp = join(WORKSPACE, relPath);
      mkdirSync(dirname(fp), { recursive: true });
      if (args.append) {
        const existing = existsSync(fp) ? readFileSync(fp, "utf8") : "";
        writeFileSync(fp, existing + content, "utf8");
      } else {
        writeFileSync(fp, content, "utf8");
      }
      return { ok: true, data: { path: relPath, bytes: content.length, mode: args.append ? "append" : "write" } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // list_files
  all.set("list_files", async (args) => {
    const relPath = String(args.path || ".");
    const maxDepth = Math.min(Number(args.depth || 2), 4);
    try {
      const fp = join(WORKSPACE, relPath);
      if (!existsSync(fp)) return { ok: false, error: `Path not found: ${relPath}` };
      function listDir(dir: string, depth: number): string[] {
        if (depth > maxDepth) return [];
        const entries: string[] = [];
        try {
          const items = readdirSync(dir);
          for (const item of items.slice(0, 80)) {
            if (item.startsWith(".") && item !== ".env") continue;
            if (item === "node_modules" || item === "dist" || item === ".git") continue;
            const fullPath = join(dir, item);
            const rel = relative(WORKSPACE, fullPath);
            try {
              const stat = statSync(fullPath);
              if (stat.isDirectory()) {
                entries.push(`📁 ${rel}/`);
                entries.push(...listDir(fullPath, depth + 1));
              } else {
                entries.push(`📄 ${rel}`);
              }
            } catch { continue; }
          }
        } catch { /* skip */ }
        return entries;
      }
      const entries = listDir(fp, 0);
      return { ok: true, data: { path: relPath, entries: entries.slice(0, 200) } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // search_code
  all.set("search_code", async (args) => {
    const pattern = String(args.pattern || "");
    const searchPath = String(args.path || ".");
    if (!pattern) return { ok: false, error: "pattern required" };
    try {
      const fp = join(WORKSPACE, searchPath);
      const cmd = `grep -r --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" -n "${pattern.replace(/"/g, '\\"')}" "${fp}" 2>/dev/null | head -50`;
      const output = execSync(cmd, { timeout: 10000, encoding: "utf8" }).trim();
      return { ok: true, data: { pattern, path: searchPath, matches: output || "(no matches)" } };
    } catch (e) {
      const err = e as { stdout?: string };
      return { ok: true, data: { pattern, matches: (err.stdout || "").trim() || "(no matches)" } };
    }
  });

  // run_shell
  all.set("run_shell", async (args) => {
    const command = String(args.command || "");
    if (!command) return { ok: false, error: "command required" };
    const blocked = /rm\s+-rf|sudo\s|mkfs|dd\s+if=|wget.*\|\s*bash|curl.*\|\s*bash|>\/dev\/(sd|nvme)|passwd/i;
    if (blocked.test(command)) return { ok: false, error: "Command blocked for safety" };
    try {
      const out = execSync(command, { timeout: 30000, cwd: WORKSPACE, encoding: "utf8" });
      return { ok: true, data: { command, output: out.slice(0, 4000) } };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const output = `${err.stdout || ""}${err.stderr || err.message || String(e)}`.slice(0, 2000);
      return { ok: false, error: output };
    }
  });

  // generate_code
  all.set("generate_code", async (args) => {
    const task = String(args.task || "");
    const language = String(args.language || "typescript");
    const saveAs = args.saveAs ? String(args.saveAs) : null;
    const context = args.context ? String(args.context) : "";
    if (!task) return { ok: false, error: "task required" };
    try {
      const r = await builderLLM([
        { role: "system", content: `You are an expert ${language} engineer for the DLavie OS project. Write complete, production-ready, runnable code. No placeholder stubs. Include all imports.` },
        { role: "user", content: `${context ? `Project context:\n${context}\n\n` : ""}Write complete ${language} code for:\n${task}\n\nRequirements: production-ready, fully typed, follows existing project conventions.` },
      ], { maxTokens: 4000, temperature: 0.1 });
      let savedPath: string | null = null;
      if (saveAs) {
        try {
          const fp = join(WORKSPACE, saveAs);
          mkdirSync(dirname(fp), { recursive: true });
          // Extract code from markdown code block if present
          let code = r.text;
          const m = code.match(/```(?:\w+)?\n([\s\S]*?)```/);
          if (m) code = m[1]!;
          writeFileSync(fp, code, "utf8");
          savedPath = saveAs;
        } catch { /* ignore */ }
      }
      return { ok: true, data: { language, code: r.text, savedPath, model: r.model } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // analyze_code
  all.set("analyze_code", async (args) => {
    const pathOrCode = String(args.path || args.code || "");
    if (!pathOrCode) return { ok: false, error: "path or code required" };
    try {
      let code = pathOrCode;
      if (!pathOrCode.includes("\n") && existsSync(join(WORKSPACE, pathOrCode))) {
        code = readFileSync(join(WORKSPACE, pathOrCode), "utf8").slice(0, 6000);
      }
      const context = args.context ? ` (context: ${args.context})` : "";
      const r = await builderLLM([
        { role: "system", content: "You are a senior code reviewer. Find real bugs, type errors, security issues, performance problems. Be specific with line numbers or patterns." },
        { role: "user", content: `Analyze this code${context}:\n\`\`\`\n${code.slice(0, 5000)}\n\`\`\`\n\nProvide: (1) critical issues, (2) type/runtime errors, (3) improvements, (4) summary verdict.` },
      ], { maxTokens: 2000 });
      return { ok: true, data: { analysis: r.text, model: r.model } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // execute_python
  all.set("execute_python", async (args) => {
    const code = String(args.code || "");
    if (!code) return { ok: false, error: "code required" };
    return new Promise((resolve) => {
      const tmpFile = join("/tmp", `builder_py_${Date.now()}.py`);
      try { writeFileSync(tmpFile, code); } catch (e) { resolve({ ok: false, error: String(e) }); return; }
      exec(`python3 "${tmpFile}" 2>&1`, { timeout: 15000, cwd: WORKSPACE }, (err, stdout) => {
        try { execSync(`rm -f "${tmpFile}"`, { timeout: 2000 }); } catch { /* ignore */ }
        if (err && !stdout) resolve({ ok: false, error: String(err.message).slice(0, 1000) });
        else resolve({ ok: !err, data: { stdout: stdout.slice(0, 3000) } });
      });
    });
  });

  // web_search
  all.set("web_search", async (args) => {
    const q = String(args.query || "");
    if (!q) return { ok: false, error: "query required" };
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
      const resp = await fetch(url, { headers: { "User-Agent": "DLavie-OS/1.0" }, signal: AbortSignal.timeout(8000) });
      const json = await resp.json() as { AbstractText?: string; RelatedTopics?: Array<{ Text?: string }> };
      const results: string[] = [];
      if (json.AbstractText) results.push(json.AbstractText);
      if (json.RelatedTopics) {
        for (const t of json.RelatedTopics.slice(0, 5)) {
          if (t.Text) results.push(t.Text);
        }
      }
      return { ok: true, data: { query: q, results: results.slice(0, 6), source: "DuckDuckGo" } };
    } catch (e) { return { ok: false, error: `Search failed: ${String(e).slice(0, 200)}` }; }
  });

  // plan_task
  all.set("plan_task", async (args) => {
    const goal = String(args.goal || "");
    if (!goal) return { ok: false, error: "goal required" };
    try {
      const r = await builderLLM([
        { role: "system", content: "You are a software project planner. Create concrete, actionable step-by-step plans with specific file paths, function names, and implementation details." },
        { role: "user", content: `Create a detailed implementation plan for:\n${goal}\n\nBreak into numbered steps. Each step should specify: what to do, which file, and expected outcome.` },
      ], { maxTokens: 2000 });
      return { ok: true, data: { plan: r.text, model: r.model } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // request_collab
  all.set("request_collab", async (args) => {
    const targetAgent = String(args.agent || "");
    const title = String(args.title || "");
    const description = String(args.description || "");
    if (!targetAgent || !title || !description) return { ok: false, error: "agent, title, and description required" };
    const validAgents = Object.keys(AGENT_ALLOWED_TOOLS);
    if (!validAgents.includes(targetAgent)) return { ok: false, error: `Unknown agent: ${targetAgent}. Valid: ${validAgents.join(", ")}` };
    if (targetAgent === agentId) return { ok: false, error: "Cannot request collaboration from yourself" };
    try {
      const [current] = await db.select().from(builderTasksTable).where(eq(builderTasksTable.id, taskId)).limit(1);
      const [newTask] = await db.insert(builderTasksTable).values({
        title,
        description,
        status: "draft",
        assignedAgent: targetAgent,
        requestedBy: agentId,
        priority: current?.priority ?? 5,
        parentTaskId: taskId,
      }).returning();
      return { ok: true, data: { newTaskId: newTask!.id, assignedTo: targetAgent, title, status: "draft", note: `Task created for ${targetAgent}. They can execute it from the Builder board.` } };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // finish
  all.set("finish", async (args) => {
    const summary = String(args.summary || "Task completed.");
    const result = String(args.result || summary);
    const insight = args.insight ? String(args.insight) : null;
    if (insight && insight.length > 20) {
      try {
        await db.insert(agentMemoriesTable).values({
          content: insight.slice(0, 2000),
          category: "insight",
          importance: 6,
          tags: JSON.stringify(["builder", agentId]),
          sessionId: String(taskId),
        });
      } catch { /* ignore */ }
    }
    return { ok: true, data: { summary, result } };
  });

  // Return only allowed tools for this agent
  const restricted = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>();
  for (const name of (allowedTools)) {
    const fn = all.get(name);
    if (fn) restricted.set(name, fn);
  }
  return restricted;
}

// ─── System prompt per agent ──────────────────────────────────────────────────

function buildAgentSystemPrompt(agentId: string, allowedTools: string[], task: string): string {
  const roleDesc = AGENT_ROLE_DESCRIPTIONS[agentId] || "AI agent";
  const toolDefs: Record<string, string> = {
    think:               '{"question":"..."} — deep reasoning/analysis',
    read_project_context: '{} — read replit.md for project structure',
    read_file:           '{"path":"relative/path","maxLines":200,"offset":0} — read workspace file',
    write_file:          '{"path":"relative/path","content":"...","append":false} — write/create file',
    list_files:          '{"path":".","depth":2} — list directory tree',
    search_code:         '{"pattern":"searchTerm","path":"."} — grep through codebase',
    run_shell:           '{"command":"pnpm run build"} — run safe shell command (pnpm, node, etc.)',
    generate_code:       '{"task":"...","language":"typescript","saveAs":"path/file.ts","context":"..."} — generate & optionally save code',
    analyze_code:        '{"path":"file.ts","context":"..."} — analyze code for issues',
    execute_python:      '{"code":"..."} — run Python script',
    web_search:          '{"query":"..."} — search the web',
    plan_task:           '{"goal":"..."} — create step-by-step implementation plan',
    request_collab:      '{"agent":"engineer","title":"...","description":"..."} — create subtask for another agent',
    finish:              '{"summary":"...","result":"...","insight":"key learning for memory"} — mark task done',
  };
  const toolList = allowedTools
    .map((t) => `- **${t}**(${toolDefs[t] || "..."}): ${toolDefs[t]?.split(" — ")[1] || ""}`)
    .join("\n");

  return `You are the **${agentId.toUpperCase()}** agent in DLavie OS AI Builder System.

━━ YOUR ROLE ━━
${roleDesc}

━━ YOUR TASK ━━
${task}

━━ YOUR TOOLS (${allowedTools.length} allowed) ━━
${toolList}

━━ RESPONSE FORMAT (STRICT JSON every turn) ━━
{
  "thought": "what I know, what I need to do next and WHY",
  "tool": "tool_name",
  "args": { ...arguments... }
}

━━ EXECUTION RULES ━━
1. Start with read_project_context to understand the project structure.
2. Think before acting on complex decisions.
3. If you need another agent's skills → use request_collab (do NOT attempt their work yourself).
4. Call finish as soon as the task is fully complete. Include an insight for memory.
5. For file edits: read the file first, then write the complete updated version.
6. For code generation: always save to a file with saveAs.
7. If a shell command fails: read the error, fix the issue, try again.
8. NEVER simulate or fake results — all actions must be real.`;
}

// ─── ReAct execution loop ──────────────────────────────────────────────────────

async function executeBuilderTask(taskId: number): Promise<void> {
  const MAX_STEPS = 25;

  const [task] = await db.select().from(builderTasksTable).where(eq(builderTasksTable.id, taskId)).limit(1);
  if (!task) {
    await appendLog(taskId, { type: "error", content: "Task not found in database" });
    return;
  }

  const agentId = task.assignedAgent;
  const allowedTools = AGENT_ALLOWED_TOOLS[agentId] ?? AGENT_ALLOWED_TOOLS["engineer"]!;
  const toolSet = buildToolSet(allowedTools, taskId, agentId);

  await appendLog(taskId, {
    type: "info",
    content: `🤖 ${agentId.toUpperCase()} agent starting task: "${task.title}"`,
  });

  const systemPrompt = buildAgentSystemPrompt(agentId, allowedTools, task.description);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `TASK: ${task.title}\n\nDETAILS: ${task.description}\n\nStart immediately. Use your allowed tools. Respond with valid JSON.` },
  ];

  let step = 0;
  let finalResult = "";
  let done = false;

  try {
    while (step < MAX_STEPS && !done) {
      step++;

      // Sliding window context
      const ctx: ChatMessage[] = [
        messages[0]!,
        ...messages.slice(Math.max(1, messages.length - 18)),
      ];

      let raw = "", usedModel = "unknown";
      try {
        const r = await builderLLM(ctx, { maxTokens: 2500, temperature: 0.15 });
        raw = r.text; usedModel = r.model;
      } catch (e) {
        await appendLog(taskId, { type: "error", content: `LLM error at step ${step}: ${String(e).slice(0, 200)}` });
        await db.update(builderTasksTable).set({ status: "draft", updatedAt: new Date() }).where(eq(builderTasksTable.id, taskId));
        return;
      }

      // Parse JSON
      let parsed: { thought?: string; tool?: string; args?: Record<string, unknown> } = {};
      try {
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        const s = cleaned.indexOf("{"); const e = cleaned.lastIndexOf("}");
        if (s !== -1 && e !== -1) parsed = JSON.parse(cleaned.slice(s, e + 1));
      } catch {
        const toolNames = [...toolSet.keys()].join("|");
        const m = raw.match(new RegExp(`\\b(${toolNames})\\b`, "i"));
        parsed = { thought: raw.slice(0, 400), tool: m?.[1]?.toLowerCase() ?? "finish", args: {} };
      }

      const thought = String(parsed.thought || "");
      const toolName = String(parsed.tool || "finish").toLowerCase().trim();
      const toolArgs = (parsed.args || {}) as Record<string, unknown>;

      if (thought) {
        await appendLog(taskId, { type: "thought", content: thought });
      }

      const toolFn = toolSet.get(toolName);
      if (!toolFn) {
        await appendLog(taskId, {
          type: "error",
          content: `Unknown or disallowed tool "${toolName}". Available for ${agentId}: ${allowedTools.join(", ")}`,
        });
        messages.push({ role: "assistant", content: JSON.stringify(parsed) });
        messages.push({ role: "user", content: `ERROR: Tool "${toolName}" is not in your allowed tool set. Your allowed tools: ${allowedTools.join(", ")}. Respond with valid JSON.` });
        continue;
      }

      await appendLog(taskId, { type: "tool_call", tool: toolName, args: toolArgs });

      let result: ToolResult;
      try { result = await toolFn(toolArgs); }
      catch (e) { result = { ok: false, error: String(e) }; }

      await appendLog(taskId, { type: "tool_result", tool: toolName, ok: result.ok, data: result.ok ? result.data : result.error });

      if (toolName === "finish") {
        const summary = String((result.data as { summary?: string })?.summary || "Task completed.");
        finalResult = String((result.data as { result?: string })?.result || summary);
        await appendLog(taskId, { type: "done", content: summary });
        done = true;
        break;
      }

      if (toolName === "request_collab" && result.ok) {
        const d = result.data as { newTaskId: number; assignedTo: string; title: string };
        await appendLog(taskId, {
          type: "collab",
          content: `📨 Collaboration task #${d.newTaskId} created for **${d.assignedTo}**: "${d.title}"`,
          data: result.data,
        });
      }

      const stepsLeft = MAX_STEPS - step;
      const obs = result.ok
        ? `Tool "${toolName}" succeeded:\n${JSON.stringify(result.data).slice(0, 1800)}`
        : `Tool "${toolName}" FAILED: ${result.error}\nTry a different approach.`;
      const hint = stepsLeft <= 4
        ? `\n⚠️ Only ${stepsLeft} steps left! Call finish NOW.`
        : stepsLeft <= 8
        ? `\n[${stepsLeft} steps remaining] If task is done, call finish.`
        : "";

      messages.push({ role: "assistant", content: JSON.stringify({ thought, tool: toolName, args: toolArgs }) });
      messages.push({ role: "user", content: `${obs}\n\n[Step ${step}/${MAX_STEPS}]${hint} Respond with JSON.` });
    }

    if (!done) {
      finalResult = `Completed ${step} steps. See log for details.`;
      await appendLog(taskId, { type: "done", content: finalResult });
    }

    await db.update(builderTasksTable).set({
      status: "ready",
      result: finalResult.slice(0, 4000),
      updatedAt: new Date(),
    }).where(eq(builderTasksTable.id, taskId));

  } catch (e) {
    const errMsg = String(e);
    await appendLog(taskId, { type: "error", content: `Fatal error: ${errMsg.slice(0, 300)}` });
    await db.update(builderTasksTable).set({ status: "draft", updatedAt: new Date() }).where(eq(builderTasksTable.id, taskId));
  } finally {
    // Close all SSE streams for this task
    const clients = taskStreams.get(taskId);
    if (clients) {
      for (const res of clients) {
        if (!res.writableEnded) res.end();
      }
      taskStreams.delete(taskId);
    }
  }
}

// ─── Task decomposition (orchestrator role) ───────────────────────────────────

async function decomposeRequest(userRequest: string): Promise<Array<{
  title: string;
  description: string;
  assignedAgent: string;
  priority: number;
}>> {
  const agentList = Object.entries(AGENT_ROLE_DESCRIPTIONS)
    .map(([id, desc]) => `- **${id}**: ${desc.split(".")[0]}`)
    .join("\n");

  const r = await builderLLM([
    { role: "system", content: `You are the Orchestrator agent for DLavie OS. Break down user requests into specific tasks for the right specialist agents. Each task must be concrete and actionable.

Available agents and their roles:
${agentList}

RULES:
- Assign tasks ONLY to the appropriate agent based on their specialty
- Each task must be self-contained with clear success criteria
- Don't over-decompose — 2-5 tasks is usually right
- engineer handles all code writing, file editing, TypeScript/React
- reviewer reviews code but doesn't write it
- deployer runs builds and tests
- researcher does research, doesn't write code
- botmaster ONLY handles bot files

Respond with ONLY valid JSON array:
[{"title":"...","description":"detailed description with specific files/APIs to work on","assignedAgent":"agentId","priority":1-10},...]` },
    { role: "user", content: `Break down this request into tasks:\n\n${userRequest}` },
  ], { maxTokens: 3000, temperature: 0.2 });

  try {
    const cleaned = r.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const s = cleaned.indexOf("["); const e = cleaned.lastIndexOf("]");
    if (s !== -1 && e !== -1) {
      const tasks = JSON.parse(cleaned.slice(s, e + 1)) as Array<{
        title: string; description: string; assignedAgent: string; priority: number;
      }>;
      const validAgents = Object.keys(AGENT_ALLOWED_TOOLS);
      return tasks
        .filter((t) => t.title && t.description && validAgents.includes(t.assignedAgent))
        .map((t) => ({ ...t, priority: Math.min(10, Math.max(1, Number(t.priority) || 5)) }));
    }
  } catch { /* fall through */ }
  return [{ title: userRequest.slice(0, 80), description: userRequest, assignedAgent: "engineer", priority: 5 }];
}

// ─── REST API ─────────────────────────────────────────────────────────────────

// GET /api/builder/tasks
router.get("/builder/tasks", async (_req, res) => {
  try {
    const tasks = await db.select().from(builderTasksTable).orderBy(desc(builderTasksTable.updatedAt));
    res.json(tasks);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/builder/tasks/:id
router.get("/builder/tasks/:id", async (req, res) => {
  try {
    const id = Number((req.params['id'] as string));
    const [task] = await db.select().from(builderTasksTable).where(eq(builderTasksTable.id, id)).limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(task);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/builder/tasks
router.post("/builder/tasks", async (req: Request, res: Response) => {
  const { title, description, assignedAgent, priority, status, parentTaskId } = req.body as {
    title?: string; description?: string; assignedAgent?: string;
    priority?: number; status?: string; parentTaskId?: number;
  };
  if (!title?.trim() || !description?.trim()) {
    res.status(400).json({ error: "title and description required" });
    return;
  }
  const validAgents = Object.keys(AGENT_ALLOWED_TOOLS);
  const agent = (assignedAgent && validAgents.includes(assignedAgent)) ? assignedAgent : "engineer";
  try {
    const [task] = await db.insert(builderTasksTable).values({
      title: title.trim(),
      description: description.trim(),
      assignedAgent: agent,
      priority: Math.min(10, Math.max(1, Number(priority) || 5)),
      status: (status as "draft" | "queued" | "active" | "ready" | "done") || "draft",
      ...(parentTaskId ? { parentTaskId } : {}),
    }).returning();
    res.status(201).json(task);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/builder/tasks/:id
router.put("/builder/tasks/:id", async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  const { title, description, assignedAgent, priority, status } = req.body as {
    title?: string; description?: string; assignedAgent?: string;
    priority?: number; status?: string;
  };
  const validAgents = Object.keys(AGENT_ALLOWED_TOOLS);
  const validStatus = ["draft", "queued", "active", "ready", "done"];
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title) updates.title = title.trim();
    if (description) updates.description = description.trim();
    if (assignedAgent && validAgents.includes(assignedAgent)) updates.assignedAgent = assignedAgent;
    if (priority) updates.priority = Math.min(10, Math.max(1, Number(priority)));
    if (status && validStatus.includes(status)) updates.status = status;
    const [updated] = await db.update(builderTasksTable).set(updates).where(eq(builderTasksTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(updated);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/builder/tasks/:id
router.delete("/builder/tasks/:id", async (req, res) => {
  const id = Number((req.params['id'] as string));
  try {
    await db.delete(builderTasksTable).where(eq(builderTasksTable.id, id));
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/builder/decompose — orchestrator decomposes request into tasks
router.post("/builder/decompose", async (req: Request, res: Response) => {
  const { request } = req.body as { request?: string };
  if (!request?.trim()) { res.status(400).json({ error: "request required" }); return; }
  try {
    const subtasks = await decomposeRequest(request.trim());
    const created = await Promise.all(
      subtasks.map((t) =>
        db.insert(builderTasksTable).values({
          title: t.title,
          description: t.description,
          assignedAgent: t.assignedAgent,
          priority: t.priority,
          status: "draft",
          requestedBy: "orchestrator",
        }).returning().then((r) => r[0]!)
      )
    );
    res.status(201).json({ count: created.length, tasks: created });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/builder/tasks/:id/execute — agent picks up and runs the task
router.post("/builder/tasks/:id/execute", async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  try {
    const [task] = await db.select().from(builderTasksTable).where(eq(builderTasksTable.id, id)).limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    if (task.status === "active") { res.status(409).json({ error: "Task already running" }); return; }
    if (task.status === "done") { res.status(409).json({ error: "Task already done" }); return; }

    // Clear old log, set active
    await db.update(builderTasksTable).set({
      status: "active",
      agentLog: JSON.stringify([]),
      result: null,
      updatedAt: new Date(),
    }).where(eq(builderTasksTable.id, id));

    // Start execution in background
    executeBuilderTask(id).catch((e) => {
      console.error(`[Builder] Task ${id} execution error:`, e);
    });

    res.json({ id, status: "active", message: `${task.assignedAgent} agent is now executing this task` });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/builder/tasks/:id/stream — SSE stream of task execution
router.get("/builder/tasks/:id/stream", async (req: Request, res: Response) => {
  const id = Number((req.params['id'] as string));
  const [task] = await db.select().from(builderTasksTable).where(eq(builderTasksTable.id, id)).limit(1).catch(() => [null]);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send existing log entries immediately
  const existing: BuilderLogEntry[] = task.agentLog ? JSON.parse(task.agentLog) : [];
  for (const entry of existing) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  // If task is done/draft, close immediately
  if (task.status !== "active") {
    res.end();
    return;
  }

  // Register as live subscriber
  if (!taskStreams.has(id)) taskStreams.set(id, new Set());
  taskStreams.get(id)!.add(res);

  // Heartbeat
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(hb);
    taskStreams.get(id)?.delete(res);
  });
});

// GET /api/builder/agents — list agents with their allowed tools
router.get("/builder/agents", (_req, res) => {
  const agents = Object.entries(AGENT_ALLOWED_TOOLS).map(([id, tools]) => ({
    id,
    role: AGENT_ROLE_DESCRIPTIONS[id]?.split(".")[0] ?? "",
    allowedTools: tools,
    toolCount: tools.length,
  }));
  res.json(agents);
});

export default router;
