/**
 * DLavie OS — BaseAgent
 *
 * Abstract base for all autonomous worker agents.
 * Each agent runs a tick() loop, updates its heartbeat in DB,
 * can send mail to other agents or "boss" (human inbox),
 * and processes tasks from its own queue.
 */

import { db } from "@workspace/db";
import { agentMailTable, agentStatusTable, agentTasksTable, agentMetricsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain.js";

export interface AgentConfig {
  id: string;
  displayName: string;
  tickIntervalMs: number;
  description?: string;
}

export type AgentStatusEnum = "idle" | "working" | "sleeping" | "error";

// ─── SSE broadcast (set by agent-runner) ──────────────────────────────────────
export const sseBroadcasters: Array<(event: string, data: unknown) => void> = [];

function broadcast(event: string, data: unknown) {
  for (const fn of sseBroadcasters) {
    try { fn(event, data); } catch { /* ignore */ }
  }
}

// ─── BaseAgent ────────────────────────────────────────────────────────────────

export abstract class BaseAgent {
  readonly id: string;
  readonly displayName: string;
  readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  protected currentStatus: AgentStatusEnum = "idle";
  protected currentTask = "";
  protected running = false;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
    this.tickIntervalMs = config.tickIntervalMs;
  }

  // ── To be implemented by each agent ────────────────────────────────────────
  protected abstract tick(): Promise<void>;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start() {
    if (this.running) return;
    this.running = true;
    await this.upsertStatus("idle", "Starting…");
    this.log("🚀 Started");

    // Initial tick after 3s, then on interval
    setTimeout(() => this.safeTick(), 3000);
    this.timer = setInterval(() => this.safeTick(), this.tickIntervalMs);
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.log("🛑 Stopped");
  }

  private async safeTick() {
    if (!this.running) return;
    this.tickCount++;
    try {
      await this.upsertStatus("working", this.currentTask || "Ticking…");
      await this.tick();
      await this.upsertStatus("idle", "Waiting for next cycle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logError("Tick failed: " + msg);
      await this.upsertStatus("error", msg.slice(0, 200));
      // Auto-recover after 30s
      setTimeout(() => this.upsertStatus("idle", "Recovered"), 30000);
    }
  }

  // ── Mail system ──────────────────────────────────────────────────────────────

  protected async sendMail(opts: {
    to?: string;
    subject: string;
    body: string;
    priority?: "low" | "normal" | "high" | "critical";
    metadata?: Record<string, unknown>;
  }) {
    const mail = await db.insert(agentMailTable).values({
      fromAgent: this.id,
      toAgent:   opts.to ?? "boss",
      subject:   opts.subject,
      body:      opts.body,
      priority:  opts.priority ?? "normal",
      metadata:  opts.metadata,
    }).returning();

    broadcast("mail", { ...mail[0], fromDisplay: this.displayName });
    this.log(`📧 Sent mail → ${opts.to ?? "boss"}: "${opts.subject}"`);
    return mail[0];
  }

  protected async getUnreadMail() {
    return db
      .select()
      .from(agentMailTable)
      .where(and(eq(agentMailTable.toAgent, this.id), eq(agentMailTable.read, false)))
      .orderBy(desc(agentMailTable.createdAt));
  }

  protected async markMailRead(id: number) {
    await db.update(agentMailTable).set({ read: true }).where(eq(agentMailTable.id, id));
  }

  // ── Task queue ───────────────────────────────────────────────────────────────

  protected async createTask(taskType: string, payload?: unknown) {
    const [task] = await db.insert(agentTasksTable).values({
      agentId: this.id,
      taskType,
      payload: payload as Record<string, unknown>,
      status: "pending",
    }).returning();
    return task;
  }

  protected async claimNextTask() {
    const [task] = await db
      .select()
      .from(agentTasksTable)
      .where(and(eq(agentTasksTable.agentId, this.id), eq(agentTasksTable.status, "pending")))
      .orderBy(agentTasksTable.createdAt)
      .limit(1);

    if (task) {
      await db.update(agentTasksTable)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(agentTasksTable.id, task.id));
    }
    return task ?? null;
  }

  protected async completeTask(id: number, result?: unknown) {
    await db.update(agentTasksTable)
      .set({ status: "done", result: result as Record<string, unknown>, completedAt: new Date() })
      .where(eq(agentTasksTable.id, id));
  }

  protected async failTask(id: number, error: string) {
    await db.update(agentTasksTable)
      .set({ status: "failed", error, completedAt: new Date() })
      .where(eq(agentTasksTable.id, id));
  }

  // ── Metrics ──────────────────────────────────────────────────────────────────

  protected async recordMetric(metricType: string, value: string | number, label?: string, metadata?: Record<string, unknown>) {
    await db.insert(agentMetricsTable).values({
      agentId: this.id,
      metricType,
      value: String(value),
      label,
      metadata,
    });
    broadcast("metric", { agentId: this.id, metricType, value, label, ts: Date.now() });
  }

  // ── AI reasoning ─────────────────────────────────────────────────────────────

  protected async think(prompt: string, systemPrompt?: string): Promise<string> {
    const { text } = await generateWithFallback(prompt, undefined, systemPrompt);
    return text;
  }

  // ── Status helpers ────────────────────────────────────────────────────────────

  private async upsertStatus(status: AgentStatusEnum, currentTask?: string) {
    this.currentStatus = status;
    this.currentTask   = currentTask ?? "";

    await db
      .insert(agentStatusTable)
      .values({
        agentId:     this.id,
        displayName: this.displayName,
        status,
        currentTask: currentTask ?? null,
        lastSeen:    new Date(),
        tickCount:   this.tickCount,
      })
      .onConflictDoUpdate({
        target: agentStatusTable.agentId,
        set: {
          status,
          currentTask: currentTask ?? null,
          lastSeen: new Date(),
          tickCount: this.tickCount,
        },
      });

    broadcast("status", {
      agentId:     this.id,
      displayName: this.displayName,
      status,
      currentTask: currentTask ?? "",
      tickCount:   this.tickCount,
      ts:          Date.now(),
    });
  }

  // ── Logging ───────────────────────────────────────────────────────────────────

  protected log(msg: string) {
    const line = `[${this.displayName}] ${msg}`;
    console.log(line);
    broadcast("log", { agentId: this.id, line, ts: Date.now() });
  }

  protected logError(msg: string) {
    const line = `[${this.displayName}] ❌ ${msg}`;
    console.error(line);
    broadcast("log", { agentId: this.id, line, level: "error", ts: Date.now() });
  }

  // ── Web fetch helper ─────────────────────────────────────────────────────────

  protected async webGet(url: string, opts?: RequestInit): Promise<string> {
    const res = await fetch(url, {
      headers: { "User-Agent": "DLavie-OS-Agent/1.0", ...opts?.headers },
      signal: AbortSignal.timeout(15000),
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.text();
  }

  protected async webGetJson<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
    const text = await this.webGet(url, opts);
    return JSON.parse(text) as T;
  }

  getInfo() {
    return {
      id:          this.id,
      displayName: this.displayName,
      status:      this.currentStatus,
      currentTask: this.currentTask,
      tickCount:   this.tickCount,
      running:     this.running,
    };
  }
}
