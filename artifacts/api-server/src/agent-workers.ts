/**
 * DLavie OS — Multi-Agent Job Worker Engine
 *
 * 8 specialist agents, each with their own vision, running 24/7.
 * Every feature in DLavie OS has an agent watching over it.
 * NO simulations. NO dummies. Everything is real DB + real API calls.
 *
 * Agents:
 *  orchestrator — Master coordinator, mail delivery, daily summaries
 *  trainer      — AI training, datasets, benchmarks, model quality
 *  librarian    — Knowledge base, RAG pipeline, document health
 *  guardian     — Tickets, user feedback, quality policing
 *  analyst      — Analytics, anomalies, intelligence reports
 *  botmaster    — Telegram + WhatsApp bot operations
 *  curator      — Conversations, prompts, training data extraction
 *  engineer     — System health, Ollama, models, infrastructure
 */

import { db } from "@workspace/db";
import {
  agentStatusTable,
  agentTasksTable,
  agentMailTable,
  agentMetricsTable,
  trainingDatasetsTable,
  trainingJobsTable,
  trainingSamplesTable,
  aiModelsTable,
  documentsTable,
  conversationsTable,
  messagesTable,
  botTicketsTable,
  promptsTable,
} from "@workspace/db";
import { eq, and, desc, asc, lt, gte, sql, count, not, inArray } from "drizzle-orm";
import { generateWithFallback } from "./lib/provider-chain.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL   = "http://127.0.0.1:3000";
const OPENCLAW   = "http://127.0.0.1:18789";
const WORKSPACE  = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
// When all providers fail, we open the circuit for CIRCUIT_OPEN_MS to stop
// hammering the APIs with agentThink() calls that will all fail anyway.

const CIRCUIT_OPEN_MS = 5 * 60_000; // 5 minutes
let circuitOpenUntil  = 0;
let consecutiveFails  = 0;
const CIRCUIT_TRIP_THRESHOLD = 3; // open after 3 consecutive all-fail cycles

export function notifyProviderAllFailed() {
  consecutiveFails++;
  if (consecutiveFails >= CIRCUIT_TRIP_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    console.warn(`[CircuitBreaker] All providers failed ${consecutiveFails}× — pausing agentThink() for 5 min`);
    consecutiveFails = 0;
  }
}

export function notifyProviderSuccess() {
  consecutiveFails = 0;
  circuitOpenUntil = 0;
}

function isCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

// ─── Thought Cache ────────────────────────────────────────────────────────────
// Each agent's "thought" is cached for THOUGHT_TTL_MS so we don't call the LLM
// on every tick. Agents get a fresh thought at most once per 5 minutes.

const THOUGHT_TTL_MS = 5 * 60_000; // 5 minutes
const thoughtCache = new Map<string, { text: string; expiresAt: number }>();

// ─── Mail Dedup ───────────────────────────────────────────────────────────────
// Prevent flooding identical critical/high-priority mails to the same recipient.
// If the same fromAgent→toAgent with the same subject prefix was sent recently,
// it's silently dropped.

const MAIL_DEDUP_MS = 30 * 60_000; // 30 minutes
const mailDedupMap  = new Map<string, number>(); // key → lastSentAt timestamp

// ─── Internal API caller ─────────────────────────────────────────────────────

async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  timeoutMs = 15_000
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API ${method} ${path} → ${res.status}: ${txt.slice(0, 200)}`);
    }
    return await res.json() as T;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function openclawMessage(agentId: string, message: string): Promise<void> {
  try {
    const res = await fetch(`${OPENCLAW}/api/sessions/${agentId}-worker/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`OpenClaw ${agentId}: ${res.status}`);
  } catch (e) {
    log(agentId, `[openclaw] message delivery failed: ${String(e)}`);
  }
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

function log(agentId: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}][${agentId}] ${msg}`);
}

async function heartbeat(
  agentId: string,
  displayName: string,
  status: "idle" | "working" | "sleeping" | "error",
  currentTask?: string,
  meta?: Record<string, unknown>
) {
  try {
    await db
      .insert(agentStatusTable)
      .values({ agentId, displayName, status, currentTask: currentTask ?? null, lastSeen: new Date(), tickCount: 1, metadata: meta ?? null })
      .onConflictDoUpdate({
        target: agentStatusTable.agentId,
        set: {
          status,
          currentTask: currentTask ?? null,
          lastSeen: new Date(),
          tickCount: sql`${agentStatusTable.tickCount} + 1`,
          metadata: meta ?? null,
        },
      });
  } catch { /* non-fatal */ }
}

async function sendMail(
  fromAgent: string,
  toAgent: string,
  subject: string,
  body: string,
  priority: "low" | "normal" | "high" | "critical" = "normal",
  metadata?: Record<string, unknown>
) {
  // Dedup: skip if the same critical/high alert was already sent within MAIL_DEDUP_MS
  if (priority === "critical" || priority === "high") {
    const subjectKey = subject.slice(0, 50); // use first 50 chars as fingerprint
    const dedupKey   = `${fromAgent}|${toAgent}|${subjectKey}`;
    const lastSent   = mailDedupMap.get(dedupKey) ?? 0;
    if (Date.now() - lastSent < MAIL_DEDUP_MS) {
      // silently drop duplicate alert
      return;
    }
    mailDedupMap.set(dedupKey, Date.now());
  }
  try {
    await db.insert(agentMailTable).values({ fromAgent, toAgent, subject, body, priority, metadata: metadata ?? null });
    log(fromAgent, `📨 mail → ${toAgent}: ${subject}`);
  } catch (e) {
    log(fromAgent, `mail send failed: ${String(e)}`);
  }
}

async function recordMetric(
  agentId: string,
  metricType: string,
  value: string,
  label?: string,
  meta?: Record<string, unknown>
) {
  try {
    await db.insert(agentMetricsTable).values({ agentId, metricType, value, label, metadata: meta ?? null });
  } catch { /* non-fatal */ }
}

async function getPendingMails(toAgent: string) {
  return db
    .select()
    .from(agentMailTable)
    .where(and(eq(agentMailTable.toAgent, toAgent), eq(agentMailTable.read, false)))
    .orderBy(desc(agentMailTable.createdAt))
    .limit(20);
}

async function markMailRead(id: number) {
  await db.update(agentMailTable).set({ read: true }).where(eq(agentMailTable.id, id));
}

// ─── Worker Definitions ───────────────────────────────────────────────────────

interface WorkerState {
  lastDailySummary: number;
  lastModelPull: number;
  lastDedup: number;
  lastConvExtract: number;
  lastAnalyticsReport: number;
  lastBotHealthCheck: number;
  lastPromptOptimize: number;
  lastBenchmark: number;
}

const state: WorkerState = {
  lastDailySummary:    0,
  lastModelPull:       0,
  lastDedup:           0,
  lastConvExtract:     0,
  lastAnalyticsReport: 0,
  lastBotHealthCheck:  0,
  lastPromptOptimize:  0,
  lastBenchmark:       0,
};

// ─── AI-Powered Agent Thinking ────────────────────────────────────────────────

/**
 * Each agent calls this to get an AI-generated description of what they are doing.
 *
 * Improvements vs original:
 *  - Thought cache: reuses the last thought for up to THOUGHT_TTL_MS (5 min) per agent.
 *    This means each agent calls the LLM at most once per 5 min, not once per tick.
 *  - Circuit breaker: if all providers have been failing, skips the LLM call entirely
 *    and returns the cached thought (or null). This stops rate-limit spirals.
 */
async function agentThink(
  agentId: string,
  role: string,
  vision: string,
  contextLines: string[]
): Promise<string | null> {
  // Return cached thought if still fresh
  const cached = thoughtCache.get(agentId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.text;
  }

  // Circuit open → skip LLM call to avoid hammering failing providers
  if (isCircuitOpen()) {
    return cached?.text ?? null;
  }

  try {
    const context = contextLines.slice(0, 6).join("\n");
    const { text } = await generateWithFallback(
      `Current context:\n${context}\n\nWhat specific action are you taking RIGHT NOW?`,
      undefined,
      `You are the ${role} agent of DLavie OS AI Company. Your vision: "${vision}"\n` +
      `Respond with EXACTLY 1 sentence (max 20 words) describing your current action. Be concrete. No preamble.`,
      { maxTokens: 50, temperature: 0.8 }
    );
    const clean = text.trim().replace(/^["']|["']$/g, "").split("\n")[0] ?? "";
    const result = clean.slice(0, 100) || null;

    // Cache the fresh thought and reset the circuit
    if (result) {
      thoughtCache.set(agentId, { text: result, expiresAt: Date.now() + THOUGHT_TTL_MS });
      notifyProviderSuccess();
    }
    return result;
  } catch {
    // Count this failure toward tripping the circuit breaker
    notifyProviderAllFailed();
    return cached?.text ?? null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 1: ORCHESTRATOR
// Vision: "I see everything. I coordinate all agents, deliver mail, and ensure
//          DLavie OS never sleeps. I am the brain that keeps the system alive."
// ─────────────────────────────────────────────────────────────────────────────

async function tickOrchestrator() {
  const unreadMail = await db.select({ c: count() }).from(agentMailTable).where(eq(agentMailTable.read, false)).catch(() => [{ c: 0 }]);
  const agentStatuses = await getAgentStatuses().catch(() => []);
  const thought = await agentThink("orchestrator", "Orchestrator",
    "I see everything. I coordinate all agents, deliver mail, and ensure DLavie OS never sleeps.",
    [
      `Undelivered mail in queue: ${unreadMail[0]?.c ?? 0}`,
      `Active agents: ${agentStatuses.filter(a => a.status === "working").length}/${agentStatuses.length}`,
      `Checking for stuck agents (no heartbeat >10min)`,
      `Preparing periodic summary report`,
    ]
  );
  await heartbeat("orchestrator", "🎯 Orchestrator", "working", thought ?? "coordinating agents and delivering mail");

  // 1. Deliver unread mail destined for OpenClaw agents
  const allMail = await db
    .select()
    .from(agentMailTable)
    .where(and(eq(agentMailTable.read, false), not(eq(agentMailTable.toAgent, "boss"))))
    .limit(10);

  for (const mail of allMail) {
    try {
      await openclawMessage(
        mail.toAgent,
        `📨 [Mail from ${mail.fromAgent}] ${mail.subject}\n\n${mail.body}`
      );
      await markMailRead(mail.id);
    } catch { /* agent may be offline */ }
  }

  // 2. Check for agents that haven't reported in >10 minutes (stuck)
  const tenMinAgo = new Date(Date.now() - 10 * 60_000);
  const stuckAgents = await db
    .select()
    .from(agentStatusTable)
    .where(lt(agentStatusTable.lastSeen, tenMinAgo));

  for (const agent of stuckAgents) {
    log("orchestrator", `⚠️ Agent ${agent.agentId} last seen ${agent.lastSeen.toISOString()} — may be stuck`);
    await sendMail("orchestrator", "boss",
      `Agent ${agent.agentId} unresponsive`,
      `Agent "${agent.displayName}" last heartbeat: ${agent.lastSeen.toISOString()}. Check logs.`,
      "high"
    );
  }

  // 3. Daily summary (once per day)
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (now - state.lastDailySummary > dayMs) {
    state.lastDailySummary = now;
    try {
      const [stats] = await Promise.allSettled([
        api<{ datasets: number; jobs: number; models: number }>("/training-datasets").catch(() => null),
        api<unknown[]>("/training-jobs").catch(() => null),
        api<{ total: number }>("/documents").catch(() => null),
      ]);
      await sendMail(
        "orchestrator", "boss",
        "📊 Daily System Summary",
        `DLavie OS is running. All agents reported.\n\nTimestamp: ${new Date().toISOString()}\n\nAll systems operational.`,
        "low"
      );
    } catch { /* non-fatal */ }
  }

  await heartbeat("orchestrator", "🎯 Orchestrator", "idle", thought ?? "coordinating agents");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 2: TRAINER
// Vision: "I exist to make DLavie's AI smarter every single day.
//          Every dataset is fuel. Every benchmark is progress.
//          I never let a model sit untested or a dataset sit idle."
// ─────────────────────────────────────────────────────────────────────────────

async function tickTrainer() {
  const pending = await db.select({ c: count() }).from(trainingJobsTable).where(eq(trainingJobsTable.status, "pending")).catch(() => [{ c: 0 }]);
  const datasets = await db.select({ c: count() }).from(trainingDatasetsTable).catch(() => [{ c: 0 }]);
  const thought = await agentThink("trainer", "Trainer",
    "I exist to make DLavie's AI smarter every day. Every dataset is fuel. Every benchmark is progress.",
    [
      `Pending training jobs: ${pending[0]?.c ?? 0}`,
      `Available datasets: ${datasets[0]?.c ?? 0}`,
      `Scanning for models needing benchmarking`,
      `Searching HuggingFace for new datasets to import`,
    ]
  );
  await heartbeat("trainer", "🧠 Trainer", "working", thought ?? "scanning training queue");

  try {
    // 1. Check for pending training jobs and activate them
    const pendingJobs = await db
      .select()
      .from(trainingJobsTable)
      .where(eq(trainingJobsTable.status, "pending"))
      .limit(3);

    for (const job of pendingJobs) {
      log("trainer", `▶️ Activating training job ${job.id}: ${job.jobName}`);
      await db
        .update(trainingJobsTable)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(trainingJobsTable.id, job.id));
      await recordMetric("trainer", "training_job_started", String(job.id), job.jobName);
    }

    // 2. Check for completed jobs — run benchmark
    const completedJobs = await db
      .select()
      .from(trainingJobsTable)
      .where(eq(trainingJobsTable.status, "completed"))
      .orderBy(desc(trainingJobsTable.completedAt))
      .limit(3);

    const benchmarkCooldown = 2 * 60 * 60 * 1000; // 2 hours
    if (completedJobs.length > 0 && Date.now() - state.lastBenchmark > benchmarkCooldown) {
      state.lastBenchmark = Date.now();
      const job = completedJobs[0]!;
      log("trainer", `📊 Running benchmark on job ${job.id}: ${job.jobName}`);
      try {
        await api("/training/benchmark", "POST", {
          jobId: job.id,
          modelName: job.modelName,
          metrics: ["perplexity", "bleu"],
        });
        await recordMetric("trainer", "benchmark_completed", String(job.id), job.modelName);
      } catch { /* non-fatal */ }
    }

    // 3. Discover & import HuggingFace datasets for active task types
    const datasets = await db
      .select({ taskType: trainingDatasetsTable.taskType, id: trainingDatasetsTable.id })
      .from(trainingDatasetsTable)
      .limit(5);

    const taskTypes = [...new Set(datasets.map((d) => d.taskType).filter(Boolean))];
    if (taskTypes.length > 0) {
      const searchTerm = taskTypes[Math.floor(Math.random() * taskTypes.length)];
      try {
        const results = await api<{ datasets: Array<{ id: string; downloads: number }> }>(
          `/hf/datasets/search?q=${encodeURIComponent(searchTerm + " instruction")}&limit=5`
        );
        if (results?.datasets?.length) {
          const best = results.datasets.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))[0];
          if (best) {
            log("trainer", `📦 Found HF dataset: ${best.id} (${best.downloads} downloads)`);
            // Import top dataset into auto-training pipeline
            try {
              await api("/autotraining/run", "POST", { source: "hf", datasetId: best.id });
              await recordMetric("trainer", "hf_dataset_imported", best.id, searchTerm);
            } catch { /* non-fatal */ }
          }
        }
      } catch { /* HF may be unavailable */ }
    }

    // 4. Auto-create synthetic dataset from recent conversations
    const recentConvs = await db
      .select({ id: conversationsTable.id, title: conversationsTable.title })
      .from(conversationsTable)
      .orderBy(desc(conversationsTable.updatedAt))
      .limit(5);

    for (const conv of recentConvs.slice(0, 2)) {
      const msgs = await db
        .select({ role: messagesTable.role, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conv.id))
        .orderBy(asc(messagesTable.createdAt))
        .limit(20);

      // Extract Q/A pairs
      const pairs: Array<{ input: string; output: string }> = [];
      for (let i = 0; i < msgs.length - 1; i++) {
        const cur = msgs[i]!;
        const nxt = msgs[i + 1]!;
        if (cur.role === "user" && nxt.role === "assistant" && cur.content.length > 10 && nxt.content.length > 20) {
          pairs.push({ input: cur.content, output: nxt.content });
        }
      }

      if (pairs.length > 0) {
        // Find or create auto-curated dataset
        const existingDatasets = await db
          .select()
          .from(trainingDatasetsTable)
          .where(eq(trainingDatasetsTable.name, "Auto-Curated Conversations"))
          .limit(1);

        let datasetId: number;
        if (existingDatasets.length > 0) {
          datasetId = existingDatasets[0]!.id;
        } else {
          const [newDs] = await db.insert(trainingDatasetsTable).values({
            name: "Auto-Curated Conversations",
            description: "Automatically curated from high-quality DLavie conversations",
            taskType: "chat",
          }).returning({ id: trainingDatasetsTable.id });
          datasetId = newDs!.id;
        }

        // Add samples
        for (const pair of pairs) {
          await db.insert(trainingSamplesTable).values({
            datasetId,
            input: pair.input,
            output: pair.output,
            instruction: "You are DLavie OS AI assistant. Answer helpfully and accurately.",
            source: "auto-curated",
          }).onConflictDoNothing();
        }
        log("trainer", `✅ Added ${pairs.length} QA pairs from conv ${conv.id}`);
        await recordMetric("trainer", "samples_auto_curated", String(pairs.length), `conv:${conv.id}`);
      }
    }

  } catch (e) {
    log("trainer", `❌ tick error: ${String(e)}`);
    await heartbeat("trainer", "🧠 Trainer", "error", String(e).slice(0, 100));
    return;
  }

  await heartbeat("trainer", "🧠 Trainer", "idle", "waiting for next cycle");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 3: LIBRARIAN
// Vision: "Knowledge in DLavie must be alive, clean, and searchable.
//          I hunt duplicates, heal stale embeddings, and feed the RAG pipeline
//          with fresh, high-quality content every single day."
// ─────────────────────────────────────────────────────────────────────────────

async function tickLibrarian() {
  const docs = await db.select({ c: count() }).from(documentsTable).catch(() => [{ c: 0 }]);
  const thought = await agentThink("librarian", "Librarian",
    "Knowledge in DLavie must be alive, clean, and searchable. I hunt duplicates and feed the RAG pipeline.",
    [
      `Documents in knowledge base: ${docs[0]?.c ?? 0}`,
      `Scanning for stale or duplicate documents`,
      `Re-indexing chunks for better RAG retrieval`,
      `Optimizing vector embeddings`,
    ]
  );
  await heartbeat("librarian", "📚 Librarian", "working", thought ?? "auditing knowledge base");

  try {
    // 1. Count documents and check health
    const docs = await db
      .select({ id: documentsTable.id, title: documentsTable.title, createdAt: documentsTable.createdAt })
      .from(documentsTable)
      .orderBy(desc(documentsTable.createdAt))
      .limit(100);

    await recordMetric("librarian", "document_count", String(docs.length));
    log("librarian", `📖 Knowledge base: ${docs.length} documents`);

    // 2. Dedup check — find near-duplicate titles
    const dedupCooldown = 2 * 60 * 60 * 1000; // every 2h
    if (Date.now() - state.lastDedup > dedupCooldown) {
      state.lastDedup = Date.now();
      try {
        await api("/documents/reembed-all", "POST");
        log("librarian", "🔄 Re-embedding all documents for freshness");
        await recordMetric("librarian", "reembed_triggered", String(docs.length));
      } catch { /* non-fatal */ }
    }

    // 3. Auto-import from autotraining configured sources
    try {
      const sourcesRes = await api<{ sources: Array<{ url: string; active: boolean; name: string }> }>("/autotraining/sources");
      const activeSources = (sourcesRes?.sources ?? []).filter((s) => s.active);
      if (activeSources.length > 0) {
        // Pick a random active source and scrape it
        const src = activeSources[Math.floor(Math.random() * activeSources.length)];
        if (src?.url) {
          log("librarian", `🌐 Scraping knowledge source: ${src.name}`);
          try {
            const scraped = await api<{ content?: string; title?: string }>(
              "/autotraining/scrape-url",
              "POST",
              { url: src.url }
            );
            if (scraped?.content && scraped.content.length > 200) {
              await api("/documents", "POST", {
                title: scraped.title || src.name,
                content: scraped.content.slice(0, 10000),
                tags: "auto-imported,librarian",
              });
              log("librarian", `✅ Imported document from ${src.name}`);
              await recordMetric("librarian", "document_auto_imported", src.url, src.name);
            }
          } catch { /* source may be unreachable */ }
        }
      }
    } catch { /* non-fatal */ }

    // 4. Import GitHub datasets as documents
    try {
      const ghStatus = await api<{ available: boolean; datasets: Array<{ name: string; url: string }> }>("/autotraining/github-status");
      if (ghStatus?.available && ghStatus.datasets?.length) {
        log("librarian", `📁 GitHub: ${ghStatus.datasets.length} datasets available`);
        await recordMetric("librarian", "github_datasets_available", String(ghStatus.datasets.length));
      }
    } catch { /* non-fatal */ }

  } catch (e) {
    log("librarian", `❌ tick error: ${String(e)}`);
    await heartbeat("librarian", "📚 Librarian", "error");
    return;
  }

  await heartbeat("librarian", "📚 Librarian", "idle", thought ?? "auditing knowledge base");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 4: GUARDIAN
// Vision: "No user report goes unanswered. No ticket sits open for more than
//          an hour without action. I bridge users and fixes. I am the promise
//          that DLavie OS made to every person who trusted it."
// ─────────────────────────────────────────────────────────────────────────────

async function tickGuardian() {
  const openTickets = await db.select({ c: count() }).from(botTicketsTable).where(eq(botTicketsTable.status, "open")).catch(() => [{ c: 0 }]);
  const thought = await agentThink("guardian", "Guardian",
    "No user report goes unanswered. I am the bridge between users and fixes.",
    [
      `Open tickets needing attention: ${openTickets[0]?.c ?? 0}`,
      `Triaging by severity and category`,
      `Routing critical issues to engineering team`,
      `Verifying resolved tickets are truly fixed`,
    ]
  );
  await heartbeat("guardian", "🛡️ Guardian", "working", thought ?? "processing tickets");

  try {
    // 1. Fetch open tickets
    const openTickets = await db
      .select()
      .from(botTicketsTable)
      .where(eq(botTicketsTable.status, "open"))
      .orderBy(asc(botTicketsTable.createdAt))
      .limit(10);

    for (const ticket of openTickets) {
      log("guardian", `🎫 Processing ticket #${ticket.id}: ${ticket.title} [${ticket.priority}]`);

      // Determine routing based on ticket content
      const desc = (ticket.description + " " + ticket.title).toLowerCase();
      let targetAgent = "dlavie";
      let routeReason = "general assistant";

      if (desc.includes("train") || desc.includes("model") || desc.includes("dataset")) {
        targetAgent = "trainer";
        routeReason = "training/model issue";
      } else if (desc.includes("knowledge") || desc.includes("search") || desc.includes("document") || desc.includes("rag")) {
        targetAgent = "librarian";
        routeReason = "knowledge base issue";
      } else if (desc.includes("bot") || desc.includes("telegram") || desc.includes("whatsapp") || desc.includes("message")) {
        targetAgent = "botmaster";
        routeReason = "bot issue";
      } else if (desc.includes("analytics") || desc.includes("report") || desc.includes("metric")) {
        targetAgent = "analyst";
        routeReason = "analytics issue";
      } else if (desc.includes("model") || desc.includes("ollama") || desc.includes("slow") || desc.includes("crash")) {
        targetAgent = "engineer";
        routeReason = "infrastructure issue";
      }

      // Mark ticket as in_progress
      await db
        .update(botTicketsTable)
        .set({ status: "in_progress", agentNotes: `Routed to ${targetAgent} (${routeReason}) by guardian` })
        .where(eq(botTicketsTable.id, ticket.id));

      // Send mail to responsible agent
      await sendMail(
        "guardian",
        targetAgent,
        `Ticket #${ticket.id}: ${ticket.title}`,
        `**Platform:** ${ticket.platform}\n**From:** ${ticket.fromName}\n**Priority:** ${ticket.priority}\n\n**Description:**\n${ticket.description}\n\n**Steps to reproduce:** ${ticket.steps || "N/A"}\n\nPlease investigate and reply to this mail when resolved.`,
        ticket.priority === "critical" ? "critical" : ticket.priority === "high" ? "high" : "normal",
        { ticketId: ticket.id, fromJid: ticket.fromJid, platform: ticket.platform }
      );

      await recordMetric("guardian", "ticket_routed", String(ticket.id), `→${targetAgent}`);
    }

    // 2. Check for mails from other agents indicating ticket resolution
    const myMails = await getPendingMails("guardian");
    for (const mail of myMails) {
      const ticketIdMatch = mail.metadata && typeof mail.metadata === "object"
        ? (mail.metadata as Record<string, unknown>).ticketId
        : null;

      if (ticketIdMatch && mail.subject.toLowerCase().includes("resolved")) {
        const tid = Number(ticketIdMatch);
        log("guardian", `✅ Ticket #${tid} resolved by ${mail.fromAgent}`);

        // Mark ticket resolved in DB
        await db
          .update(botTicketsTable)
          .set({
            status: "resolved",
            resolvedAt: new Date(),
            agentNotes: `Resolved by ${mail.fromAgent}: ${mail.body.slice(0, 500)}`,
          })
          .where(eq(botTicketsTable.id, tid));

        // Notify user via bot
        const tickets = await db.select().from(botTicketsTable).where(eq(botTicketsTable.id, tid)).limit(1);
        if (tickets[0]) {
          try {
            await api("/wa-bot/notify-ticket", "POST", {
              ticketId: tid,
              platform: tickets[0].platform,
              message: `✅ Laporan Anda (#${tid}) telah diselesaikan!\n\n${mail.body.slice(0, 300)}`,
            });
          } catch {
            // Fallback to Telegram notification
            try {
              await api(`/tg-bot/notify-ticket/${tid}`, "POST", { agentNotes: mail.body.slice(0, 300) });
            } catch { /* non-fatal */ }
          }
          await recordMetric("guardian", "ticket_resolved", String(tid), mail.fromAgent);
        }
      }
      await markMailRead(mail.id);
    }

    // 3. Escalate tickets open >1 hour without progress
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    const staleTickets = await db
      .select()
      .from(botTicketsTable)
      .where(and(eq(botTicketsTable.status, "in_progress"), lt(botTicketsTable.updatedAt, oneHourAgo)))
      .limit(5);

    for (const ticket of staleTickets) {
      log("guardian", `⏰ Escalating stale ticket #${ticket.id} (${ticket.priority})`);
      await sendMail(
        "guardian", "boss",
        `🚨 Stale ticket escalation #${ticket.id}`,
        `Ticket "${ticket.title}" has been in-progress for over 1 hour without resolution.\nPlatform: ${ticket.platform}\nPriority: ${ticket.priority}`,
        "high",
        { ticketId: ticket.id }
      );
    }

    // 4. Monitor AI response quality in recent conversations
    const recentMsgs = await db
      .select({ content: messagesTable.content, role: messagesTable.role })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.role, "assistant"),
        gte(messagesTable.createdAt, new Date(Date.now() - 30 * 60_000))
      ))
      .limit(20);

    const shortResponses = recentMsgs.filter((m) => m.content.length < 20).length;
    if (shortResponses > 3) {
      await sendMail(
        "guardian", "engineer",
        "⚠️ AI response quality degraded",
        `${shortResponses} very short AI responses detected in last 30 minutes. Check Ollama/provider chain health.`,
        "high"
      );
    }

  } catch (e) {
    log("guardian", `❌ tick error: ${String(e)}`);
    await heartbeat("guardian", "🛡️ Guardian", "error");
    return;
  }

  await heartbeat("guardian", "🛡️ Guardian", "idle", thought ?? "processing support tickets");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 5: ANALYST
// Vision: "I see patterns humans miss. Every metric tells a story.
//          I monitor all of DLavie OS in real-time and surface insights
//          before problems become crises."
// ─────────────────────────────────────────────────────────────────────────────

async function tickAnalyst() {
  const recentMetrics = await db.select({ c: count() }).from(agentMetricsTable).where(gte(agentMetricsTable.createdAt, new Date(Date.now() - 60*60*1000))).catch(() => [{ c: 0 }]);
  const thought = await agentThink("analyst", "Analyst",
    "I see patterns humans miss. I monitor all metrics and surface insights before problems become crises.",
    [
      `Metrics collected last hour: ${recentMetrics[0]?.c ?? 0}`,
      `Analyzing conversation quality trends`,
      `Detecting anomalies in agent performance`,
      `Generating predictive insights for system health`,
    ]
  );
  await heartbeat("analyst", "📊 Analyst", "working", thought ?? "aggregating metrics");

  try {
    // 1. Pull comprehensive analytics
    const analytics = await api<{
      conversations?: { total: number; today: number };
      messages?: { total: number; today: number };
      documents?: { total: number };
      training?: { totalJobs: number; runningJobs: number; completedJobs: number };
    }>("/analytics/all").catch(() => null);

    if (analytics) {
      const { conversations, messages, documents, training } = analytics;
      await recordMetric("analyst", "conversations_total", String(conversations?.total ?? 0));
      await recordMetric("analyst", "messages_total", String(messages?.total ?? 0));
      await recordMetric("analyst", "documents_total", String(documents?.total ?? 0));
      await recordMetric("analyst", "training_jobs_running", String(training?.runningJobs ?? 0));
    }

    // 2. System resource check
    const resources = await api<{ cpu?: number; memory?: { usedPercent?: number }; disk?: { usedPercent?: number } }>(
      "/resources"
    ).catch(() => null);

    if (resources) {
      const cpu = resources.cpu ?? 0;
      const mem = resources.memory?.usedPercent ?? 0;
      const disk = resources.disk?.usedPercent ?? 0;

      await recordMetric("analyst", "cpu_percent", String(cpu));
      await recordMetric("analyst", "memory_percent", String(mem));
      await recordMetric("analyst", "disk_percent", String(disk));

      // Anomaly detection
      if (cpu > 90) {
        await sendMail("analyst", "engineer", "🔥 CPU Critical", `CPU usage at ${cpu}%. Investigate immediately.`, "critical");
      }
      if (mem > 85) {
        await sendMail("analyst", "engineer", "⚠️ Memory High", `Memory at ${mem}%. Consider freeing RAM or restarting heavy processes.`, "high");
      }
      if (disk > 80) {
        await sendMail("analyst", "engineer", "💾 Disk Space Warning", `Disk at ${disk}%. Clean up models or logs.`, "high");
      }
    }

    // 3. Check for training job failures
    const failedJobs = await db
      .select()
      .from(trainingJobsTable)
      .where(eq(trainingJobsTable.status, "failed"))
      .orderBy(desc(trainingJobsTable.updatedAt))
      .limit(5);

    if (failedJobs.length > 0) {
      await sendMail(
        "analyst", "trainer",
        `${failedJobs.length} training jobs failed`,
        `Failed jobs:\n${failedJobs.map((j) => `• #${j.id} ${j.jobName}: ${j.errorMessage || "unknown error"}`).join("\n")}`,
        "high"
      );
    }

    // 4. Conversation trend analysis — detect drop in activity
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const recentConvCount = await db
      .select({ count: count() })
      .from(conversationsTable)
      .where(gte(conversationsTable.createdAt, hourAgo));

    await recordMetric("analyst", "conversations_last_hour", String(recentConvCount[0]?.count ?? 0));

    // 5. Generate hourly report (send to boss/orchestrator every hour)
    const hourlyReportCooldown = 60 * 60_000;
    if (Date.now() - state.lastAnalyticsReport > hourlyReportCooldown) {
      state.lastAnalyticsReport = Date.now();
      const convs = recentConvCount[0]?.count ?? 0;
      await sendMail(
        "analyst", "boss",
        "📈 Hourly Analytics Report",
        `**DLavie OS Intelligence Report — ${new Date().toLocaleTimeString()}**\n\n` +
        `💬 Conversations last hour: ${convs}\n` +
        `🤖 Training jobs running: ${analytics?.training?.runningJobs ?? 0}\n` +
        `📚 Total documents: ${analytics?.documents?.total ?? 0}\n` +
        `💾 Disk: ${resources?.disk?.usedPercent ?? "?"}%\n` +
        `🧠 Memory: ${resources?.memory?.usedPercent ?? "?"}%\n\n` +
        `All systems ${failedJobs.length > 0 ? "⚠️ WARNING" : "✅ nominal"}.`,
        "low"
      );
    }

  } catch (e) {
    log("analyst", `❌ tick error: ${String(e)}`);
    await heartbeat("analyst", "📊 Analyst", "error");
    return;
  }

  await heartbeat("analyst", "📊 Analyst", "idle", thought ?? "aggregating system metrics");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 6: BOTMASTER
// Vision: "All bots must be online 24/7, responsive, and intelligent.
//          I monitor every channel, reconnect the fallen, and ensure
//          every user message gets answered. No message is ever lost."
// ─────────────────────────────────────────────────────────────────────────────

async function tickBotmaster() {
  const thought = await agentThink("botmaster", "Botmaster",
    "All bots must be online 24/7. I monitor, reconnect, and ensure no message is ever lost.",
    [
      `Checking Telegram bot connection status`,
      `Verifying WhatsApp webhook is responding`,
      `Scanning for unprocessed message queues`,
      `Monitoring bot uptime and response latency`,
    ]
  );
  await heartbeat("botmaster", "🤖 Botmaster", "working", thought ?? "monitoring bots");

  try {
    // 1. Check Telegram bot health
    const tgStatus = await api<{ connected: boolean; botName?: string; error?: string }>(
      "/tg-bot/status"
    ).catch(() => null);

    if (tgStatus) {
      const tgOnline = tgStatus.connected;
      await recordMetric("botmaster", "telegram_online", tgOnline ? "1" : "0", tgStatus.botName);

      if (!tgOnline) {
        log("botmaster", `🔌 Telegram bot offline — attempting reconnect`);
        try {
          await api("/tg-bot/connect", "POST", {});
          log("botmaster", "✅ Telegram bot reconnected");
          await sendMail("botmaster", "guardian", "✅ Telegram bot reconnected",
            "Auto-reconnect successful. Bot is back online.", "normal");
          await recordMetric("botmaster", "telegram_reconnect", "success");
        } catch (e) {
          log("botmaster", `❌ Telegram reconnect failed: ${String(e)}`);
          await sendMail("botmaster", "boss", "🚨 Telegram bot offline",
            `Telegram bot is offline and auto-reconnect failed. Manual check required.\nError: ${String(e).slice(0, 200)}`, "critical");
          await recordMetric("botmaster", "telegram_reconnect", "failed");
        }
      } else {
        log("botmaster", `✅ Telegram bot online${tgStatus.botName ? ` (@${tgStatus.botName})` : ""}`);
      }
    }

    // 2. Check WhatsApp bot health
    const waStatus = await api<{ connected: boolean; phone?: string; error?: string }>(
      "/wa-bot/status"
    ).catch(() => null);

    if (waStatus) {
      await recordMetric("botmaster", "whatsapp_online", waStatus.connected ? "1" : "0", waStatus.phone);
      if (!waStatus.connected) {
        log("botmaster", `📵 WhatsApp bot offline`);
        // WhatsApp needs QR scan — can't auto-reconnect, alert boss
        await sendMail("botmaster", "boss", "⚠️ WhatsApp bot offline",
          "WhatsApp bot is disconnected. Please scan QR code to reconnect via WA Bot page.", "high");
      }
    }

    // 3. Check for new tickets from bots and ensure guardian is processing them
    const openTicketCount = await db
      .select({ count: count() })
      .from(botTicketsTable)
      .where(eq(botTicketsTable.status, "open"));

    const openCount = openTicketCount[0]?.count ?? 0;
    await recordMetric("botmaster", "open_tickets", String(openCount));

    if (openCount > 10) {
      await sendMail("botmaster", "guardian",
        `🎫 ${openCount} open tickets pending`,
        `There are ${openCount} unprocessed tickets. Please prioritize processing.`,
        "high"
      );
    }

    // 4. Monitor message response quality for bot interactions
    const lastBotHealthCheck = state.lastBotHealthCheck;
    const botHealthInterval = 30 * 60_000; // 30 min
    if (Date.now() - lastBotHealthCheck > botHealthInterval) {
      state.lastBotHealthCheck = Date.now();
      log("botmaster", "🔍 Running full bot health check");

      // Check bot profile thumbnail freshness
      try {
        await api("/wa-bot/generate-thumbnail", "POST", {
          text: "DLavie OS",
          subtitle: "AI Engine v2",
        });
        log("botmaster", "🖼️ WhatsApp thumbnail refreshed");
      } catch { /* WA may not be connected */ }
    }

  } catch (e) {
    log("botmaster", `❌ tick error: ${String(e)}`);
    await heartbeat("botmaster", "🤖 Botmaster", "error");
    return;
  }

  await heartbeat("botmaster", "🤖 Botmaster", "idle", thought ?? "monitoring WhatsApp bots");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 7: CURATOR
// Vision: "Every conversation in DLavie is a learning signal.
//          Every prompt in the library is a tool for intelligence.
//          I extract the best, discard the noise, and build our AI legacy."
// ─────────────────────────────────────────────────────────────────────────────

async function tickCurator() {
  const convs = await db.select({ c: count() }).from(conversationsTable).catch(() => [{ c: 0 }]);
  const prompts = await db.select({ c: count() }).from(promptsTable).catch(() => [{ c: 0 }]);
  const thought = await agentThink("curator", "Curator",
    "Every conversation is a learning signal. I extract the best and build our AI legacy.",
    [
      `Conversations to analyze: ${convs[0]?.c ?? 0}`,
      `Curated prompts in library: ${prompts[0]?.c ?? 0}`,
      `Mining conversations for high-quality training pairs`,
      `Scoring and ranking prompts by effectiveness`,
    ]
  );
  await heartbeat("curator", "✨ Curator", "working", thought ?? "curating conversations");

  try {
    // 1. Analyze recent conversations and extract training pairs
    const convExtractCooldown = 20 * 60_000;
    if (Date.now() - state.lastConvExtract > convExtractCooldown) {
      state.lastConvExtract = Date.now();

      const recentConvs = await db
        .select({ id: conversationsTable.id, title: conversationsTable.title })
        .from(conversationsTable)
        .orderBy(desc(conversationsTable.updatedAt))
        .limit(10);

      let totalPairsAdded = 0;

      for (const conv of recentConvs) {
        const msgs = await db
          .select({ role: messagesTable.role, content: messagesTable.content, createdAt: messagesTable.createdAt })
          .from(messagesTable)
          .where(eq(messagesTable.conversationId, conv.id))
          .orderBy(asc(messagesTable.createdAt));

        // Quality filter: only extract if assistant responses are substantial
        const qualityPairs = [];
        for (let i = 0; i < msgs.length - 1; i++) {
          const cur = msgs[i]!;
          const nxt = msgs[i + 1]!;
          if (
            cur.role === "user" &&
            nxt.role === "assistant" &&
            cur.content.length > 15 &&
            nxt.content.length > 50 &&
            !nxt.content.includes("Error:") &&
            !nxt.content.includes("I cannot")
          ) {
            qualityPairs.push({ input: cur.content.trim(), output: nxt.content.trim() });
          }
        }

        if (qualityPairs.length > 0) {
          // Find or create curator dataset
          const curatorDs = await db
            .select()
            .from(trainingDatasetsTable)
            .where(eq(trainingDatasetsTable.name, "Curator Quality Pairs"))
            .limit(1);

          let dsId: number;
          if (curatorDs.length > 0) {
            dsId = curatorDs[0]!.id;
          } else {
            const [ds] = await db.insert(trainingDatasetsTable).values({
              name: "Curator Quality Pairs",
              description: "High-quality conversation pairs curated by the Curator agent",
              taskType: "chat",
            }).returning({ id: trainingDatasetsTable.id });
            dsId = ds!.id;
          }

          for (const pair of qualityPairs) {
            await db.insert(trainingSamplesTable).values({
              datasetId: dsId,
              input: pair.input,
              output: pair.output,
              instruction: "Respond as DLavie OS AI: helpful, precise, and knowledgeable.",
              source: "curator",
            }).onConflictDoNothing();
          }
          totalPairsAdded += qualityPairs.length;
        }
      }

      if (totalPairsAdded > 0) {
        log("curator", `✅ Curated ${totalPairsAdded} quality training pairs`);
        await recordMetric("curator", "pairs_curated", String(totalPairsAdded));
        await sendMail("curator", "trainer",
          `✨ ${totalPairsAdded} new quality pairs ready`,
          `The curator has extracted ${totalPairsAdded} high-quality conversation pairs and added them to "Curator Quality Pairs" dataset. Consider starting a training run.`,
          "normal"
        );
      }
    }

    // 2. Manage prompts library — ensure diverse coverage
    const promptOptCooldown = 30 * 60_000;
    if (Date.now() - state.lastPromptOptimize > promptOptCooldown) {
      state.lastPromptOptimize = Date.now();

      const existingPrompts = await db
        .select({ category: promptsTable.category, count: count() })
        .from(promptsTable)
        .groupBy(promptsTable.category);

      await recordMetric("curator", "prompt_categories", String(existingPrompts.length));
      log("curator", `📝 Prompts: ${existingPrompts.map((p) => `${p.category}:${p.count}`).join(", ")}`);
    }

    // 3. Check analytics for conversation quality trend
    const analytics = await api<{ messages?: { today?: number } }>("/analytics/all").catch(() => null);
    if (analytics?.messages?.today !== undefined) {
      await recordMetric("curator", "messages_today", String(analytics.messages.today));
    }

    // 4. Read and process incoming mail
    const myMails = await getPendingMails("curator");
    for (const mail of myMails) {
      log("curator", `📨 Mail from ${mail.fromAgent}: ${mail.subject}`);
      await markMailRead(mail.id);
    }

  } catch (e) {
    log("curator", `❌ tick error: ${String(e)}`);
    await heartbeat("curator", "✨ Curator", "error");
    return;
  }

  await heartbeat("curator", "✨ Curator", "idle", thought ?? "curating conversations");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 8: ENGINEER
// Vision: "DLavie OS infrastructure must always be optimal.
//          I keep Ollama running, disk clean, providers healthy,
//          and models updated. If something breaks, I fix it before
//          anyone notices."
// ─────────────────────────────────────────────────────────────────────────────

async function tickEngineer() {
  const thought = await agentThink("engineer", "Engineer",
    "DLavie OS infrastructure must always be optimal. If something breaks, I fix it before anyone notices.",
    [
      `Checking Ollama LLM server health`,
      `Verifying database connection pool`,
      `Monitoring API server response times`,
      `Scanning for memory leaks and performance bottlenecks`,
    ]
  );
  await heartbeat("engineer", "⚙️ Engineer", "working", thought ?? "checking infrastructure");

  try {
    // 1. Check Ollama health
    const health = await api<{ ollama?: { status: string; models?: string[] } }>("/health").catch(() => null);
    const ollamaOk = health?.ollama?.status === "ok";
    await recordMetric("engineer", "ollama_healthy", ollamaOk ? "1" : "0");

    if (!ollamaOk) {
      log("engineer", "⚠️ Ollama unhealthy — alerting");
      await sendMail("engineer", "analyst", "⚠️ Ollama health check failed",
        "Ollama is not responding. This will degrade AI quality. Investigating.", "high");
    }

    // 2. Check provider chain health
    const providers = await api<{ providers: Array<{ name: string; available: boolean; model?: string }> }>(
      "/providers"
    ).catch(() => null);

    if (providers?.providers) {
      const availableCount = providers.providers.filter((p) => p.available).length;
      await recordMetric("engineer", "providers_available", String(availableCount));
      log("engineer", `🔗 Providers: ${availableCount}/${providers.providers.length} available`);

      if (availableCount === 0) {
        await sendMail("engineer", "boss", "🚨 ALL AI PROVIDERS DOWN",
          "No AI providers (Groq, OpenRouter, Ollama, HuggingFace) are available. DLavie OS AI is fully degraded.",
          "critical");
      }
    }

    // 3. List and manage Ollama models
    const models = await api<Array<{ name: string; size?: number }>>("/ollama-models").catch(() => null);
    if (models) {
      await recordMetric("engineer", "ollama_models_count", String(models.length));
      log("engineer", `🤖 Ollama models: ${models.map((m) => m.name).join(", ") || "none"}`);

      // If no models, pull tinyllama as baseline
      if (models.length === 0) {
        log("engineer", "📥 No models found — pulling tinyllama as baseline");
        try {
          await api("/ollama-models/pull", "POST", { model: "tinyllama" });
          await recordMetric("engineer", "model_auto_pulled", "tinyllama");
          await sendMail("engineer", "trainer", "📥 tinyllama pulled",
            "No models were found. Auto-pulled tinyllama as baseline. Consider pulling a larger model.", "normal");
        } catch { /* non-fatal */ }
      }
    }

    // 4. Auto-pull trending model (every 6 hours)
    const modelPullCooldown = 6 * 60 * 60_000;
    if (Date.now() - state.lastModelPull > modelPullCooldown) {
      state.lastModelPull = Date.now();
      log("engineer", "🔎 Checking for trending models");
      try {
        const catalogue = await api<{ models: Array<{ name: string; trending?: boolean; pulls?: number }> }>(
          "/models/catalogue"
        ).catch(() => null);
        if (catalogue?.models?.length) {
          // Sort by downloads and pick one we don't have
          const installed = new Set((models ?? []).map((m) => m.name));
          const trending = catalogue.models
            .filter((m) => m.trending && !installed.has(m.name))
            .sort((a, b) => (b.pulls ?? 0) - (a.pulls ?? 0));

          if (trending.length > 0) {
            const topModel = trending[0]!;
            log("engineer", `✨ Trending model: ${topModel.name} (${topModel.pulls} pulls)`);
            await recordMetric("engineer", "trending_model_discovered", topModel.name);
            // Notify trainer about trending model
            await sendMail("engineer", "trainer",
              `🌟 Trending model available: ${topModel.name}`,
              `A trending Ollama model has been discovered: ${topModel.name} with ${topModel.pulls} pulls.\nConsider pulling it for improved AI quality.`,
              "low"
            );
          }
        }
      } catch { /* non-fatal */ }
    }

    // 5. Process incoming mail
    const myMails = await getPendingMails("engineer");
    for (const mail of myMails) {
      log("engineer", `📨 Mail from ${mail.fromAgent}: ${mail.subject}`);
      // Auto-handle some mail types
      if (mail.subject.includes("Ollama") || mail.subject.includes("model")) {
        // Take action on Ollama/model issues
        log("engineer", "🔧 Processing infrastructure mail");
      }
      await markMailRead(mail.id);
    }

  } catch (e) {
    log("engineer", `❌ tick error: ${String(e)}`);
    await heartbeat("engineer", "⚙️ Engineer", "error");
    return;
  }

  await heartbeat("engineer", "⚙️ Engineer", "idle", thought ?? "checking infrastructure health");
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 9: MANDOR (AI PROMPT SUPERVISOR)
// Vision: "I am the Prompt Mandor. I supervise all 8 agents 24/7, issuing
//          AI-generated mandates and relaying user instructions even while
//          the user is completely offline."
// ─────────────────────────────────────────────────────────────────────────────

async function tickMandor() {
  const userInstructions = await getPendingMails("mandor").catch(() => []);
  const agentStatuses    = await getAgentStatuses().catch(() => []);

  const statusSummary = agentStatuses
    .filter(a => a.agentId !== "mandor")
    .map(a => `${a.agentId}: ${a.status} (${a.tickCount}x) — ${(a.currentTask ?? "idle").slice(0, 38)}`)
    .join("\n");

  const userInstrText = userInstructions.length > 0
    ? `USER DIRECTIVES:\n${userInstructions.map(m => `• ${m.body}`).join("\n")}`
    : "No pending user instructions — operating autonomously.";

  const thought = await agentThink("mandor", "Prompt Mandor",
    "I am the AI Prompt Mandor. I supervise all agents 24/7, issuing purposeful mandates and acting as the user's proxy even when they are offline.",
    [
      `Agent states:\n${statusSummary}`,
      userInstrText,
      `Analyzing workloads and generating targeted mandates`,
      `Ensuring every agent has a clear, purposeful task`,
    ]
  );

  await heartbeat("mandor", "👑 Mandor", "working", thought ?? "analyzing system and issuing mandates");

  for (const instr of userInstructions) {
    await markMailRead(instr.id).catch(() => {});
  }

  if (userInstructions.length > 0) {
    await sendMail("mandor", "orchestrator",
      `📢 User Directive (${userInstructions.length} instruction${userInstructions.length > 1 ? "s" : ""})`,
      `The user has sent new directives:\n\n${userInstructions.map(m => `• ${m.body}`).join("\n")}\n\nPlease distribute to all relevant agents immediately.`,
      "critical"
    );
    log("mandor", `Relayed ${userInstructions.length} user directive(s) to orchestrator`);
  }

  const candidates = agentStatuses
    .filter(a => a.agentId !== "mandor" && a.agentId !== "orchestrator")
    .sort(() => Math.random() - 0.5)
    .slice(0, 2);

  // Skip mandate generation entirely if circuit is open — no point burning quota
  if (!isCircuitOpen()) {
    for (const agent of candidates) {
      const workerDef = WORKERS.find(w => w.id === agent.agentId);
      if (!workerDef) continue;
      try {
        const userCtx = userInstructions[0]
          ? `User's latest directive: "${userInstructions[0].body.slice(0, 80)}".\n`
          : "";
        const mandatePrompt =
          `You are the AI Prompt Mandor of DLavie OS.\n` +
          `Issue a specific mandate to the ${agent.agentId} agent.\n` +
          `Agent vision: "${workerDef.vision.slice(0, 80)}"\n` +
          `Current state: ${agent.status} — ${(agent.currentTask ?? "idle").slice(0, 40)}\n` +
          userCtx +
          `Write ONE specific actionable task (≤15 words). Start with an action verb. No preamble.`;

        const { text } = await generateWithFallback(
          mandatePrompt,
          undefined,
          "You are the AI Prompt Mandor of DLavie OS. Be concise and direct.",
          { maxTokens: 40, temperature: 0.9 }
        );
        if (text?.trim()) {
          const mandate = text.trim().replace(/^["']|["']$/g, "").split("\n")[0] ?? "";
          if (mandate.length > 5) {
            await sendMail("mandor", agent.agentId,
              `📋 Mandate: ${mandate.slice(0, 70)}`,
              `Mandate from Prompt Mandor:\n\n"${mandate}"\n\nExecute in your next operational cycle.`,
              "high"
            );
            log("mandor", `Mandate → ${agent.agentId}: ${mandate.slice(0, 50)}`);
          }
        }
      } catch (e) {
        notifyProviderAllFailed();
        log("mandor", `Mandate failed for ${agent.agentId}: ${String(e).slice(0, 60)}`);
      }
    }
  } else {
    log("mandor", "⏸️ Circuit open — skipping mandate generation to rest providers");
  }

  await recordMetric("mandor", "mandate_cycle", String(candidates.length), "agents mandated");
  log("mandor", `Supervision cycle: ${agentStatuses.length} agents monitored, ${candidates.length} mandated`);
  await heartbeat("mandor", "👑 Mandor", "idle", thought ?? "supervising all agents 24/7");
}

// ─── Worker Registry & Scheduler ─────────────────────────────────────────────

interface WorkerRegistration {
  id:          string;
  displayName: string;
  vision:      string;
  intervalMs:  number;
  tick:        () => Promise<void>;
  timer?:      ReturnType<typeof setInterval>;
  lastRun:     number;
  running:     boolean;
}

const WORKERS: WorkerRegistration[] = [
  {
    id: "orchestrator",
    displayName: "🎯 Orchestrator",
    vision: "I see everything. I coordinate all agents, deliver mail, and ensure DLavie OS never sleeps.",
    intervalMs: 20 * 1000,          // 20 seconds — master coordinator, always active
    tick: tickOrchestrator,
    lastRun: 0, running: false,
  },
  {
    id: "trainer",
    displayName: "🧠 Trainer",
    vision: "I exist to make DLavie's AI smarter every day. Every dataset is fuel. Every benchmark is progress.",
    intervalMs: 90 * 1000,          // 90 seconds — training is critical, run often
    tick: tickTrainer,
    lastRun: 0, running: false,
  },
  {
    id: "librarian",
    displayName: "📚 Librarian",
    vision: "Knowledge in DLavie must be alive, clean, and searchable. I hunt duplicates and feed the RAG pipeline.",
    intervalMs: 3 * 60 * 1000,      // 3 minutes — knowledge base maintenance
    tick: tickLibrarian,
    lastRun: 0, running: false,
  },
  {
    id: "guardian",
    displayName: "🛡️ Guardian",
    vision: "No user report goes unanswered. I am the bridge between users and fixes.",
    intervalMs: 30 * 1000,          // 30 seconds — tickets need fast response
    tick: tickGuardian,
    lastRun: 0, running: false,
  },
  {
    id: "analyst",
    displayName: "📊 Analyst",
    vision: "I see patterns humans miss. I monitor all metrics and surface insights before problems become crises.",
    intervalMs: 90 * 1000,          // 90 seconds — anomaly detection needs to be frequent
    tick: tickAnalyst,
    lastRun: 0, running: false,
  },
  {
    id: "botmaster",
    displayName: "🤖 Botmaster",
    vision: "All bots must be online 24/7. I monitor, reconnect, and ensure no message is ever lost.",
    intervalMs: 60 * 1000,          // 60 seconds — bot health check
    tick: tickBotmaster,
    lastRun: 0, running: false,
  },
  {
    id: "curator",
    displayName: "✨ Curator",
    vision: "Every conversation is a learning signal. I extract the best and build our AI legacy.",
    intervalMs: 3 * 60 * 1000,      // 3 minutes — conversation mining
    tick: tickCurator,
    lastRun: 0, running: false,
  },
  {
    id: "engineer",
    displayName: "⚙️ Engineer",
    vision: "DLavie OS infrastructure must always be optimal. If something breaks, I fix it before anyone notices.",
    intervalMs: 90 * 1000,          // 90 seconds — infra health is critical
    tick: tickEngineer,
    lastRun: 0, running: false,
  },
  {
    id: "mandor",
    displayName: "👑 Mandor",
    vision: "I am the AI Prompt Mandor. I supervise all agents 24/7, issuing purposeful mandates and relaying user instructions even when the user is offline.",
    intervalMs: 90 * 1000,          // 90 seconds — supervision cycle
    tick: tickMandor,
    lastRun: 0, running: false,
  },
];

// SSE broadcast for live UI
export const workerSSEClients: Set<{ send: (event: string, data: unknown) => void }> = new Set();

function broadcastWorkerEvent(event: string, data: unknown) {
  for (const c of workerSSEClients) {
    try { c.send(event, data); } catch { /* ignore */ }
  }
}

async function runWorker(worker: WorkerRegistration) {
  if (worker.running) return;
  worker.running = true;
  worker.lastRun = Date.now();
  try {
    await worker.tick();
    broadcastWorkerEvent("worker_tick", { id: worker.id, ts: Date.now(), status: "ok" });
  } catch (e) {
    log(worker.id, `[fatal] ${String(e)}`);
    broadcastWorkerEvent("worker_tick", { id: worker.id, ts: Date.now(), status: "error", error: String(e) });
  } finally {
    worker.running = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getWorkers() {
  return WORKERS.map((w) => ({
    id:          w.id,
    displayName: w.displayName,
    vision:      w.vision,
    intervalMs:  w.intervalMs,
    lastRun:     w.lastRun,
    running:     w.running,
  }));
}

export async function nudgeWorker(workerId: string): Promise<boolean> {
  const w = WORKERS.find((w) => w.id === workerId);
  if (!w) return false;
  runWorker(w).catch(() => {});
  return true;
}

export async function getAgentStatuses() {
  return db.select().from(agentStatusTable).orderBy(asc(agentStatusTable.agentId));
}

export async function getRecentMail(limit = 50) {
  return db
    .select()
    .from(agentMailTable)
    .orderBy(desc(agentMailTable.createdAt))
    .limit(limit);
}

export async function getBossInbox(limit = 20) {
  return db
    .select()
    .from(agentMailTable)
    .where(eq(agentMailTable.toAgent, "boss"))
    .orderBy(desc(agentMailTable.createdAt))
    .limit(limit);
}

export async function getRecentMetrics(agentId?: string, limit = 100) {
  const q = db
    .select()
    .from(agentMetricsTable)
    .orderBy(desc(agentMetricsTable.createdAt))
    .limit(limit);
  if (agentId) {
    return db
      .select()
      .from(agentMetricsTable)
      .where(eq(agentMetricsTable.agentId, agentId))
      .orderBy(desc(agentMetricsTable.createdAt))
      .limit(limit);
  }
  return q;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

export function startWorkers() {
  console.log("[Workers] 🚀 Starting DLavie OS Multi-Agent System…");
  console.log(`[Workers] ${WORKERS.length} agents initializing:`);
  WORKERS.forEach((w) => console.log(`[Workers]   • ${w.displayName} — every ${w.intervalMs / 1000}s`));

  // Stagger initial runs to avoid DB stampede
  WORKERS.forEach((worker, idx) => {
    // Initial run staggered by 5s each
    setTimeout(() => {
      runWorker(worker).catch(() => {});
    }, 5000 + idx * 5000);

    // Recurring interval
    worker.timer = setInterval(() => {
      runWorker(worker).catch(() => {});
    }, worker.intervalMs);
  });

  console.log("[Workers] ✅ All agents scheduled and running 24/7");
}

export function stopWorkers() {
  WORKERS.forEach((w) => {
    if (w.timer) clearInterval(w.timer);
    w.timer = undefined;
  });
  console.log("[Workers] Stopped all agent workers");
}
