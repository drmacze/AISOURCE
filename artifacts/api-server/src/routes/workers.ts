/**
 * DLavie OS — Worker Status & Control Routes
 *
 * GET  /workers/status           — all worker statuses + agent heartbeats
 * GET  /workers/agents           — agent DB heartbeats
 * GET  /workers/mail             — boss inbox
 * GET  /workers/mail/all         — all inter-agent mail
 * POST /workers/mail/send        — send mail to an agent
 * DELETE /workers/mail/:id       — mark mail read
 * GET  /workers/metrics          — recent agent metrics
 * POST /workers/:id/nudge        — manually trigger a worker tick
 * GET  /workers/events           — SSE live stream
 * GET  /workers/circuit          — circuit breaker status
 * POST /workers/circuit/reset    — reset circuit breaker
 * GET  /workers/threads          — collab threads
 * GET  /workers/heatmap          — 24-hour hourly activity heatmap per agent
 * GET  /workers/scorecard        — performance scorecard per agent
 * GET  /workers/missions         — mission board (in-memory)
 * POST /workers/missions         — create mission
 * PATCH /workers/missions/:id    — update mission status
 * DELETE /workers/missions/:id   — delete mission
 *
 * — New AI Agent Improvement Endpoints —
 * GET  /workers/memories         — all agent persistent memories
 * GET  /workers/memories/:id     — single agent memory
 * GET  /workers/context          — shared system context board (all keys)
 * GET  /workers/subtasks         — all subtasks (recent 50)
 * GET  /workers/subtasks/:agentId— subtasks for a specific agent
 * POST /workers/subtasks         — spawn a new subtask for an agent
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  getWorkers,
  nudgeWorker,
  getAgentStatuses,
  getRecentMail,
  getBossInbox,
  getRecentMetrics,
  workerSSEClients,
  getCircuitStatus,
  resetCircuit,
  getActiveThreads,
  getAgentEmotions,
  getAgentPositions,
  startCollabThread,
  addThreadMsg,
  concludeThread,
  getAllMemories,
  getAllContext,
  getAllSubtasks,
  getSubtasksForAgent,
  spawnSubtask,
} from "../agent-workers.js";
import { db } from "@workspace/db";
import { agentMailTable, agentStatusTable } from "@workspace/db";
import { eq, gte, desc, count } from "drizzle-orm";

// ─── In-Memory Mission Board ──────────────────────────────────────────────────

interface Mission {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  priority: "low" | "normal" | "high" | "critical";
  status: "queue" | "working" | "done";
  createdAt: string;
  updatedAt: string;
}

const MISSIONS = new Map<string, Mission>();
let missionCounter = 0;

// Seed a few starter missions
function seedMissions() {
  const starters: Omit<Mission, "id" | "createdAt" | "updatedAt">[] = [
    { title: "Review and improve RAG chunking pipeline", description: "Analyze current chunk sizes and improve semantic coherence", assignedTo: "librarian", priority: "high", status: "queue" },
    { title: "Generate multilingual training samples", description: "Create 100 training samples in ID, AR, FR, ES", assignedTo: "trainer", priority: "normal", status: "working" },
    { title: "Monitor Telegram bot uptime", description: "Ensure @dlavie_agent_bot stays online 24/7", assignedTo: "botmaster", priority: "normal", status: "working" },
    { title: "Audit API endpoint security", description: "Check all /api routes for missing auth headers", assignedTo: "guardian", priority: "high", status: "done" },
  ];
  starters.forEach(s => {
    const id = `mission_${++missionCounter}_${Date.now()}`;
    const now = new Date().toISOString();
    MISSIONS.set(id, { ...s, id, createdAt: now, updatedAt: now });
  });
}
seedMissions();

// ─── Router ───────────────────────────────────────────────────────────────────

const router: IRouter = Router();

router.get("/workers/status", async (_req, res: Response) => {
  try {
    const [workers, agents] = await Promise.all([getWorkers(), getAgentStatuses()]);
    res.json({ workers, agents, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/agents", async (_req, res: Response) => {
  try {
    const agents = await getAgentStatuses();
    res.json({ agents });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/mail", async (_req, res: Response) => {
  try {
    const mail = await getBossInbox(30);
    res.json({ mail });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/mail/all", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const mail = await getRecentMail(limit);
    res.json({ mail });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/workers/mail/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await db.update(agentMailTable).set({ read: true }).where(eq(agentMailTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/workers/mail/send", async (req: Request, res: Response) => {
  try {
    const { to, subject, body, priority = "normal", from: fromRaw } = req.body as {
      to: string; subject: string; body: string; priority?: string; from?: string;
    };
    const fromAgent = fromRaw || "dlavie";
    const [inserted] = await db.insert(agentMailTable).values({
      fromAgent, toAgent: to, subject, body, priority, read: false,
    }).returning();
    res.json({ ok: true, id: inserted?.id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/metrics", async (req: Request, res: Response) => {
  try {
    const agentId = typeof req.query.agent === "string" ? req.query.agent : undefined;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const metrics = await getRecentMetrics(agentId, limit);
    res.json({ metrics });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/circuit", (_req: Request, res: Response) => {
  res.json(getCircuitStatus());
});

router.post("/workers/circuit/reset", (_req: Request, res: Response) => {
  resetCircuit();
  res.json({ ok: true, circuit: getCircuitStatus() });
});

router.get("/workers/threads", (_req: Request, res: Response) => {
  res.json({ threads: getActiveThreads() });
});

router.post("/workers/:id/nudge", async (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = await nudgeWorker(id);
  if (!ok) { res.status(404).json({ error: `Worker "${id}" not found` }); return; }
  res.json({ ok: true, workerId: id, message: `Worker "${id}" triggered` });
});

router.get("/workers/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client = {
    send(event: string, data: unknown) {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
  workerSSEClients.add(client);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 25_000);
  req.on("close", () => { workerSSEClients.delete(client); clearInterval(heartbeat); });
});

// ─── Heatmap — 24h hourly mail activity per agent ─────────────────────────────

const AGENT_IDS = [
  "orchestrator","trainer","librarian","guardian","analyst",
  "botmaster","curator","engineer","mandor","researcher","deployer","reviewer",
];

router.get("/workers/heatmap", async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const mail = await db
      .select({ fromAgent: agentMailTable.fromAgent, createdAt: agentMailTable.createdAt })
      .from(agentMailTable)
      .where(gte(agentMailTable.createdAt, since));

    const buckets: Record<string, number[]> = {};
    for (const id of AGENT_IDS) buckets[id] = new Array(24).fill(0);
    for (const row of mail) {
      const hour = new Date(row.createdAt).getHours();
      if (buckets[row.fromAgent]) buckets[row.fromAgent][hour]++;
    }
    res.json({ buckets, since: since.toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Scorecard — per-agent performance metrics ────────────────────────────────

router.get("/workers/scorecard", async (_req: Request, res: Response) => {
  try {
    const [agents, mailSentRaw, mailRecvRaw] = await Promise.all([
      getAgentStatuses(),
      db.select({ fromAgent: agentMailTable.fromAgent, c: count() })
        .from(agentMailTable).groupBy(agentMailTable.fromAgent),
      db.select({ toAgent: agentMailTable.toAgent, c: count() })
        .from(agentMailTable).groupBy(agentMailTable.toAgent),
    ]);

    const sentMap: Record<string, number> = {};
    mailSentRaw.forEach(r => { sentMap[r.fromAgent] = Number(r.c); });
    const recvMap: Record<string, number> = {};
    mailRecvRaw.forEach(r => { recvMap[r.toAgent] = Number(r.c); });

    const scores = agents.map(a => ({
      agentId: a.agentId,
      displayName: a.displayName,
      tickCount: a.tickCount ?? 0,
      mailSent: sentMap[a.agentId] ?? 0,
      mailReceived: recvMap[a.agentId] ?? 0,
      status: a.status,
      lastSeen: (a.lastSeen as Date | null)?.toISOString() ?? null,
      currentTask: a.currentTask,
    }));
    res.json({ scores });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Missions CRUD ────────────────────────────────────────────────────────────

router.get("/workers/missions", (_req: Request, res: Response) => {
  const missions = Array.from(MISSIONS.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ missions });
});

router.post("/workers/missions", (req: Request, res: Response) => {
  try {
    const { title, description = "", assignedTo = "orchestrator", priority = "normal" } = req.body as {
      title: string; description?: string; assignedTo?: string; priority?: string;
    };
    if (!title) { res.status(400).json({ error: "title required" }); return; }
    const id = `mission_${++missionCounter}_${Date.now()}`;
    const now = new Date().toISOString();
    const mission: Mission = {
      id, title, description, assignedTo,
      priority: priority as Mission["priority"],
      status: "queue", createdAt: now, updatedAt: now,
    };
    MISSIONS.set(id, mission);
    res.json({ ok: true, mission });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/workers/missions/:id", (req: Request, res: Response) => {
  try {
    const mission = MISSIONS.get(req.params.id!);
    if (!mission) { res.status(404).json({ error: "not found" }); return; }
    const update = req.body as Partial<Mission>;
    if (update.status)      mission.status      = update.status;
    if (update.title)       mission.title       = update.title;
    if (update.description !== undefined) mission.description = update.description;
    if (update.assignedTo)  mission.assignedTo  = update.assignedTo;
    if (update.priority)    mission.priority    = update.priority;
    mission.updatedAt = new Date().toISOString();
    MISSIONS.set(mission.id, mission);
    res.json({ ok: true, mission });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/workers/missions/:id", (req: Request, res: Response) => {
  MISSIONS.delete(req.params.id!);
  res.json({ ok: true });
});

// ─── Real-time Emotions & Positions ───────────────────────────────────────────

/** GET /workers/emotions — current emotion state for all agents */
router.get("/workers/emotions", (_req: Request, res: Response) => {
  const arr = getAgentEmotions();
  const emotions: Record<string, { emoji: string; reason: string }> = {};
  arr.forEach(e => { emotions[e.agentId] = { emoji: e.emoji, reason: e.reason }; });
  res.json({ emotions, ts: Date.now() });
});

/** GET /workers/positions — current spatial position state for all agents */
router.get("/workers/positions", (_req: Request, res: Response) => {
  const arr = getAgentPositions();
  const positions: Record<string, { state: string; target?: string }> = {};
  arr.forEach(p => { positions[p.agentId] = { state: p.state, target: p.target }; });
  res.json({ positions, ts: Date.now() });
});

/**
 * POST /workers/test-collab
 * Immediately start a demo collaboration thread with given participants.
 * Body: { initiator?: string, participants?: string[], topic?: string, durationMs?: number }
 */
router.post("/workers/test-collab", (req: Request, res: Response) => {
  const initiator    = (req.body?.initiator    as string | undefined) ?? "researcher";
  const participants = (req.body?.participants as string[] | undefined) ?? ["trainer", "analyst"];
  const topic        = (req.body?.topic        as string | undefined)  ?? "Live demo: AI capability planning session";
  const durationMs   = Number(req.body?.durationMs ?? 120_000);

  const thread = startCollabThread(initiator, participants, topic);
  addThreadMsg(thread.id, initiator,
    `Opening the floor: ${topic}. Let's align on priorities and next steps for this cycle.`);

  setTimeout(() => {
    addThreadMsg(thread.id, participants[0] ?? "trainer",
      `Great initiative. I have updated task queues ready and standing by for direction from this session.`);
  }, 5_000);

  if (participants[1]) {
    const p1 = participants[1];
    setTimeout(() => {
      addThreadMsg(thread.id, p1,
        `Metrics look solid. No blockers on my end — let's finalize the action items quickly.`);
    }, 12_000);
  }

  // Auto-conclude after durationMs
  const wrapAt = Math.max(durationMs - 10_000, durationMs * 0.8);
  setTimeout(() => {
    addThreadMsg(thread.id, initiator,
      `Wrapping up — consensus reached. Assigning action items and closing this session.`);
  }, wrapAt);
  setTimeout(() => {
    concludeThread(thread.id, `Demo session concluded after ${Math.round(durationMs / 1000)}s. All agents returning to desks.`);
  }, durationMs);

  res.json({ ok: true, threadId: thread.id, topic, participants: thread.participants, durationMs });
});

// ─── Agent Memory Persistence ─────────────────────────────────────────────────

/** GET /workers/memories — all agent persistent memories */
router.get("/workers/memories", async (_req: Request, res: Response) => {
  try {
    const memories = await getAllMemories();
    res.json({ memories, count: memories.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** GET /workers/memories/:agentId — single agent memory */
router.get("/workers/memories/:agentId", async (req: Request, res: Response) => {
  try {
    const memories = await getAllMemories();
    const mem = memories.find(m => m.agentId === req.params.agentId);
    if (!mem) return void res.status(404).json({ error: "No memory found for agent" });
    res.json(mem);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Shared System Context Board ──────────────────────────────────────────────

/** GET /workers/context — full shared context board */
router.get("/workers/context", async (_req: Request, res: Response) => {
  try {
    const items = await getAllContext();
    const board: Record<string, { value: string; updatedBy: string; updatedAt: Date }> = {};
    items.forEach(i => { board[i.key] = { value: i.value, updatedBy: i.updatedBy, updatedAt: i.updatedAt }; });
    res.json({ board, count: items.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Agent Subtask Queue ──────────────────────────────────────────────────────

/** GET /workers/subtasks — all subtasks (recent 50) */
router.get("/workers/subtasks", async (_req: Request, res: Response) => {
  try {
    const subtasks = await getAllSubtasks(50);
    res.json({ subtasks, count: subtasks.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** GET /workers/subtasks/:agentId — subtasks assigned to a specific agent */
router.get("/workers/subtasks/:agentId", async (req: Request, res: Response) => {
  try {
    const subtasks = await getSubtasksForAgent(req.params.agentId!, 20);
    res.json({ agentId: req.params.agentId, subtasks, count: subtasks.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /workers/subtasks
 * Spawn a new subtask for an agent.
 * Body: { assignedBy, assignedTo, task, context?, priority? }
 */
router.post("/workers/subtasks", async (req: Request, res: Response) => {
  const { assignedBy = "boss", assignedTo, task, context, priority = "normal" } = req.body ?? {};
  if (!assignedTo || !task) {
    return void res.status(400).json({ error: "assignedTo and task are required" });
  }
  try {
    const id = await spawnSubtask(assignedBy, assignedTo, task, context, priority);
    if (id === null) {
      return void res.status(409).json({ ok: false, message: `Agent ${assignedTo} already has a pending subtask` });
    }
    res.json({ ok: true, subtaskId: id, assignedTo, task, priority });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
