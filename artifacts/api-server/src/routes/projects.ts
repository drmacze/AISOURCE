/**
 * BLOK D — Project System (Goal → Auto Execution)
 * BLOK G — System Events feed
 * BLOK O — Agent Performance
 *
 * Routes:
 *  GET  /api/projects          — list projects
 *  POST /api/projects          — create project
 *  GET  /api/projects/:id      — get project with subtasks
 *  PATCH /api/projects/:id     — update project
 *  DELETE /api/projects/:id    — delete project
 *  GET  /api/events            — list system events (BLOK G)
 *  GET  /api/events/stream     — SSE event feed (BLOK G)
 *  GET  /api/agent-performance — agent performance matrix (BLOK O)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  agentProjectsTable,
  agentSubtasksTable,
  systemEventsTable,
  agentPerformanceTable,
  agentStatusTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { eventBus, eventSSEClients } from "../lib/event-bus.js";

const router = Router();

// ── GET /api/projects ──────────────────────────────────────────────────────────

router.get("/projects", async (_req, res) => {
  try {
    const rows = await db.select().from(agentProjectsTable)
      .orderBy(desc(agentProjectsTable.createdAt))
      .limit(100);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/projects ─────────────────────────────────────────────────────────

router.post("/projects", async (req, res) => {
  try {
    const { title, description, targetCapabilities } = req.body as {
      title: string;
      description?: string;
      targetCapabilities?: string[];
    };

    if (!title) return res.status(400).json({ error: "title required" });

    const [project] = await db.insert(agentProjectsTable).values({
      title,
      description: description ?? null,
      targetCapabilities: targetCapabilities ?? [],
      status: "pending",
      progress: 0,
      estimatedCompletion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week default
    }).returning();

    // Auto-create subtasks based on targetCapabilities (Orchestrator decomposition)
    const subtasks = [
      { assignedTo: "researcher",  task: `Research training data for: ${title}`, priority: "high" as const },
      { assignedTo: "curator",     task: `Filter and curate dataset for: ${title}`, priority: "normal" as const },
      { assignedTo: "trainer",     task: `Train model for: ${title}`, priority: "normal" as const },
      { assignedTo: "analyst",     task: `Benchmark and analyze results for: ${title}`, priority: "normal" as const },
    ];

    for (const st of subtasks) {
      await db.insert(agentSubtasksTable).values({
        ...st,
        assignedBy: "orchestrator",
        context: JSON.stringify({ projectId: project.id, targetCapabilities }),
        status: "pending",
      });
    }

    eventBus.fire("project_milestone", { projectId: project.id, event: "created", title }, "projects_api");

    res.json({ ...project, subtasksCreated: subtasks.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/projects/:id ──────────────────────────────────────────────────────

router.get("/projects/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [project] = await db.select().from(agentProjectsTable).where(eq(agentProjectsTable.id, id));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const subtasks = await db.select().from(agentSubtasksTable)
      .where(and(
        eq(agentSubtasksTable.assignedBy, "orchestrator"),
      ))
      .orderBy(agentSubtasksTable.createdAt)
      .limit(20);

    res.json({ ...project, subtasks });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── PATCH /api/projects/:id ────────────────────────────────────────────────────

router.patch("/projects/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const { status, progress, description } = req.body as {
      status?: "pending" | "running" | "completed" | "failed" | "paused";
      progress?: number;
      description?: string;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status !== undefined) updates["status"] = status;
    if (progress !== undefined) updates["progress"] = progress;
    if (description !== undefined) updates["description"] = description;
    if (status === "completed") updates["completedAt"] = new Date();

    const [updated] = await db.update(agentProjectsTable)
      .set(updates as any)
      .where(eq(agentProjectsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Project not found" });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── DELETE /api/projects/:id ───────────────────────────────────────────────────

router.delete("/projects/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    await db.delete(agentProjectsTable).where(eq(agentProjectsTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/events ────────────────────────────────────────────────────────────

router.get("/events", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const rows = await db.select().from(systemEventsTable)
      .orderBy(desc(systemEventsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/events/stream (SSE) ───────────────────────────────────────────────

router.get("/events/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client = {
    send: (event: string, data: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    },
  };

  eventSSEClients.add(client);
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  req.on("close", () => { eventSSEClients.delete(client); });
});

// ── GET /api/agent-performance ─────────────────────────────────────────────────

router.get("/agent-performance", async (_req, res) => {
  try {
    const perf = await db.select().from(agentPerformanceTable)
      .orderBy(agentPerformanceTable.agentId, agentPerformanceTable.taskType);

    const agents = await db.select().from(agentStatusTable);

    // Build performance matrix
    const matrix: Record<string, Record<string, { success: number; fail: number; rate: number; latency: number }>> = {};
    for (const row of perf) {
      if (!matrix[row.agentId]) matrix[row.agentId] = {};
      const total = row.successCount + row.failCount;
      matrix[row.agentId][row.taskType] = {
        success: row.successCount,
        fail: row.failCount,
        rate: total > 0 ? Math.round((row.successCount / total) * 100) : 0,
        latency: Math.round(row.avgLatencyMs),
      };
    }

    res.json({ matrix, agents: agents.map((a) => ({ id: a.agentId, name: a.displayName, status: a.status })) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
