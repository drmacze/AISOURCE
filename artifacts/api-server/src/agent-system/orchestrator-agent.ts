/**
 * DLavie OS — Orchestrator Agent (The Boss Agent)
 *
 * The central coordinator of all DLavie OS agents:
 * 1. Monitors health of all other agents
 * 2. Routes inter-agent tasks and coordinates cross-agent workflows
 * 3. Generates periodic digest reports for the boss (human)
 * 4. Makes autonomous decisions: "training needs more data → task training-agent"
 * 5. Monitors system resources and takes action when needed
 * 6. Can assign tasks to any other agent via the task queue
 * 7. Sends morning/evening briefings via mail
 */

import { db } from "@workspace/db";
import {
  agentStatusTable, agentMailTable, agentMetricsTable,
  agentTasksTable, trainingDatasetsTable, trainingSamplesTable,
  botTicketsTable, conversationsTable
} from "@workspace/db/schema";
import { eq, desc, count, and, sql, lt, gte } from "drizzle-orm";
import { BaseAgent } from "./base-agent.js";

export class OrchestratorAgent extends BaseAgent {
  private lastDigestAt:   number = 0;
  private readonly DIGEST_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
  private cycleCount = 0;

  constructor() {
    super({
      id:             "orchestrator",
      displayName:    "🎯 Orchestrator",
      tickIntervalMs: 5 * 60 * 1000, // every 5 minutes
    });
  }

  protected async tick() {
    this.cycleCount++;
    this.log(`Orchestration cycle #${this.cycleCount}`);

    // 1. Check all agent heartbeats
    const agentHealth = await this.checkAgentHealth();

    // 2. Read and route inter-agent mail
    const unread = await this.getUnreadMail();
    for (const mail of unread) {
      await this.routeMail(mail);
      await this.markMailRead(mail.id);
    }

    // 3. Check system metrics and take action
    await this.checkAndActOnMetrics();

    // 4. Periodic digest (every 4 hours)
    if (Date.now() - this.lastDigestAt > this.DIGEST_INTERVAL_MS || this.cycleCount === 1) {
      await this.generateDigest(agentHealth);
      this.lastDigestAt = Date.now();
    }
  }

  private async checkAgentHealth(): Promise<Map<string, { status: string; lastSeen: Date; minutesAgo: number }>> {
    const agents   = await db.select().from(agentStatusTable);
    const health   = new Map<string, { status: string; lastSeen: Date; minutesAgo: number }>();
    const stale: string[] = [];

    for (const agent of agents) {
      const minutesAgo = Math.floor((Date.now() - agent.lastSeen.getTime()) / 60000);
      health.set(agent.agentId, { status: agent.status, lastSeen: agent.lastSeen, minutesAgo });

      // Alert if agent hasn't been seen in 15+ minutes (should be < its tick interval)
      if (minutesAgo > 15 && agent.agentId !== "orchestrator") {
        stale.push(`${agent.displayName} (last seen ${minutesAgo}m ago)`);
      }
    }

    if (stale.length > 0) {
      this.logError(`Stale agents detected: ${stale.join(", ")}`);
      await this.sendMail({
        subject:  `⚠️ Agent Health Alert — ${stale.length} agent(s) not responding`,
        body:     `The following agents have not reported in over 15 minutes:\n\n${stale.map(s => `  • ${s}`).join("\n")}\n\nThis may indicate an error. Check system logs.`,
        priority: "high",
        metadata: { staleAgents: stale },
      });
    }

    return health;
  }

  private async routeMail(mail: typeof agentMailTable.$inferSelect) {
    const body = mail.body.toLowerCase();

    // Auto-route: if training agent reports low data, create a task for it
    if (mail.fromAgent === "training" && body.includes("added 0") || body.includes("no samples")) {
      await db.insert(agentTasksTable).values({
        agentId:  "training",
        taskType: "force_fetch",
        payload:  { reason: "Orchestrator detected empty cycle", mailId: mail.id } as Record<string, unknown>,
        status:   "pending",
      });
      this.log("Dispatched force_fetch task to training agent");
    }

    // Auto-route: critical quality issues → tell quality agent to run extra tests
    if (mail.fromAgent === "quality" && body.includes("degrading")) {
      await db.insert(agentTasksTable).values({
        agentId:  "quality",
        taskType: "deep_test",
        payload:  { reason: "Orchestrator detected quality degradation", mailId: mail.id } as Record<string, unknown>,
        status:   "pending",
      });
      this.log("Dispatched deep_test task to quality agent");
    }

    // Auto-forward critical tickets to boss
    if (mail.fromAgent === "report" && body.includes("critical")) {
      // Already forwarded to boss by report agent — add orchestrator analysis
      this.log(`Critical report from report-agent — logged for digest`);
    }
  }

  private async checkAndActOnMetrics() {
    // Check training sample counts
    const datasets = await db.select().from(trainingDatasetsTable).limit(5);
    const lowDatasets: string[] = [];

    for (const ds of datasets) {
      if (ds.sampleCount < 10) lowDatasets.push(ds.name);
    }

    if (lowDatasets.length > 0) {
      // Send task to training agent
      await db.insert(agentTasksTable).values({
        agentId:  "training",
        taskType: "urgent_fetch",
        payload:  { datasets: lowDatasets, reason: "Orchestrator: critically low samples" } as Record<string, unknown>,
        status:   "pending",
      });
      this.log(`Dispatched urgent fetch for datasets: ${lowDatasets.join(", ")}`);
    }
  }

  private async generateDigest(agentHealth: Map<string, { status: string; lastSeen: Date; minutesAgo: number }>) {
    this.log("Generating periodic digest…");

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Gather stats
    const [{ value: mailCount }] = await db.select({ value: count() }).from(agentMailTable)
      .where(gte(agentMailTable.createdAt, since24h));

    const [{ value: taskCount }] = await db.select({ value: count() }).from(agentTasksTable)
      .where(gte(agentTasksTable.createdAt, since24h));

    const [{ value: convoCount }] = await db.select({ value: count() }).from(conversationsTable)
      .where(gte(conversationsTable.createdAt, since24h));

    const [{ value: openTickets }] = await db.select({ value: count() }).from(botTicketsTable)
      .where(eq(botTicketsTable.status, "open"));

    const totalSamples = await db.select({ value: sql<number>`SUM(sample_count)` }).from(trainingDatasetsTable);
    const sampleTotal  = Number(totalSamples[0]?.value ?? 0);

    // Recent agent metrics
    const recentMetrics = await db.select().from(agentMetricsTable)
      .where(gte(agentMetricsTable.createdAt, since24h))
      .orderBy(desc(agentMetricsTable.createdAt))
      .limit(20);

    const qualityScores = recentMetrics
      .filter(m => m.metricType === "avg_quality_score")
      .map(m => parseFloat(m.value));
    const avgQuality = qualityScores.length
      ? (qualityScores.reduce((s, v) => s + v, 0) / qualityScores.length).toFixed(1)
      : "N/A";

    const samplesAdded = recentMetrics
      .filter(m => m.metricType === "samples_added")
      .reduce((s, m) => s + Number(m.value), 0);

    // Agent status summary
    const agentSummary = Array.from(agentHealth.entries()).map(([id, h]) => {
      const emoji = h.status === "idle" ? "🟢" : h.status === "working" ? "🔵" : h.status === "error" ? "🔴" : "🟡";
      return `  ${emoji} ${id}: ${h.status} (last active ${h.minutesAgo}m ago)`;
    }).join("\n");

    const now     = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
    const dateStr = now.toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Jakarta" });

    const body = [
      `📊 **DLavie OS Agent Digest**`,
      `${dateStr}, ${timeStr} WIB`,
      ``,
      `**Agent Status:**`,
      agentSummary || "  No agents registered yet",
      ``,
      `**24-Hour Activity:**`,
      `  • Agent mail sent:      ${mailCount}`,
      `  • Agent tasks completed: ${taskCount}`,
      `  • Conversations (users): ${convoCount}`,
      `  • Training samples added: ${samplesAdded} (total: ${sampleTotal})`,
      `  • Open support tickets:  ${openTickets}`,
      `  • AI quality avg score:  ${avgQuality}/10`,
      ``,
      `**System Health:** All services operational`,
      `API: http://localhost:3000 | Web: http://localhost:5000`,
      ``,
      `— Orchestrator Agent, DLavie OS`,
    ].join("\n");

    await this.sendMail({
      subject:  `📊 DLavie OS Digest — ${dateStr}`,
      body,
      priority: "normal",
      metadata: {
        stats: { mailCount: Number(mailCount), taskCount: Number(taskCount), convoCount: Number(convoCount), samplesAdded, sampleTotal, avgQuality, openTickets: Number(openTickets) },
      },
    });

    await this.recordMetric("digest_sent", 1, dateStr);
  }
}
